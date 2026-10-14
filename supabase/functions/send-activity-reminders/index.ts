// supabase/functions/send-activity-reminders/index.ts
// Cron-triggered Edge Function (every 5 min via pg_cron + pg_net).
// Sends reminder push notifications for upcoming activities and a daily summary.
//
// Request body (optional): { mode?: "reminder" | "daily_summary",
//   dry_run?: boolean      -- compute + return payloads, send/log nothing
//   only_user_id?: number  -- restrict recipients to one user (manual testing) }
// When called without a body (or mode="reminder"), it checks both reminders
// and daily summary (based on time-of-day).

// @ts-ignore
const VAPID_PUBLIC  = Deno.env.get("VAPID_PUBLIC_KEY")  || "";
// @ts-ignore
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || "";
// @ts-ignore
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")     || "mailto:admin@destinoraclessolution.com";
// @ts-ignore
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")      || "";
// @ts-ignore
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// MYT = UTC+8 (Malaysia timezone for daily summary hour check)
const MYT_OFFSET_HOURS = 8;

// Users who never saved Settings -> Reminder Timing get these. Keep in sync with
// the Settings checkbox default in chunks/script-settings.js (loadNotificationPreferences).
const DEFAULT_REMINDER_MINUTES = [30];
// Morning summary time (MYT). The Settings label in script-settings.js says the same.
const DAILY_SUMMARY_MINUTE_OF_DAY = 8 * 60 + 30; // 08:30 MYT = 00:30 UTC

// How many minutes before/after a target window we still fire (window = ±WINDOW_MIN)
// Edge function runs every 5 min, window = 3 min gives safe overlap without double-fire.
const WINDOW_MIN = 3;
// Reminders: send on the first run after the activity is within its lead time,
// or up to this many minutes later if a run was slow/missed (dedupe log stops repeats).
const REMINDER_CATCHUP_MIN = 10;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------- PostgREST helpers ----------
async function pgFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Prefer": "return=minimal",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`pgFetch ${path} ${res.status}: ${txt.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json") && res.status !== 204) return res.json();
  return null;
}

async function pgSelect(table: string, qs: string): Promise<any[]> {
  return (await pgFetch(`${table}?${qs}`)) || [];
}

async function pgUpsert(table: string, rows: any[], onConflict: string): Promise<void> {
  await pgFetch(`${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { "Prefer": "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
}

// ---------- base64url helpers ----------
function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}
function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}

// ---------- VAPID JWT ----------
async function importVapidKey(): Promise<CryptoKey> {
  const d   = b64urlDecode(VAPID_PRIVATE);
  const pub = b64urlDecode(VAPID_PUBLIC);
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256",
      d: b64urlEncode(d),
      x: b64urlEncode(pub.slice(1, 33)),
      y: b64urlEncode(pub.slice(33, 65)), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false, ["sign"],
  );
}

async function makeVapidJwt(audience: string): Promise<string> {
  const key = await importVapidKey();
  const enc  = new TextEncoder();
  const h    = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p    = b64urlEncode(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  })));
  const sig  = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${h}.${p}`),
  ));
  return `${h}.${p}.${b64urlEncode(sig)}`;
}

// ---------- HKDF ----------
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, base, len * 8,
  ));
}

// ---------- aes128gcm encrypt (RFC 8291) ----------
async function encryptPayload(
  payload: Uint8Array, recvP256dh: Uint8Array, recvAuth: Uint8Array,
): Promise<Uint8Array> {
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asJwk  = await crypto.subtle.exportKey("jwk", asKeys.publicKey);
  const asPub  = concat(new Uint8Array([0x04]), b64urlDecode(asJwk.x!), b64urlDecode(asJwk.y!));

  const recipPub = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256",
      x: b64urlEncode(recvP256dh.slice(1, 33)),
      y: b64urlEncode(recvP256dh.slice(33, 65)), ext: true },
    { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: recipPub }, asKeys.privateKey, 256));

  const enc    = new TextEncoder();
  const salt   = crypto.getRandomValues(new Uint8Array(16));
  const ikm    = await hkdf(recvAuth, ecdhSecret, concat(enc.encode("WebPush: info\0"), recvP256dh, asPub), 32);
  const cek    = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce  = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, concat(payload, new Uint8Array([0x02]))));

  return concat(salt, u32be(4096), new Uint8Array([asPub.length]), asPub, cipher);
}

// ---------- Send one web push ----------
async function sendWebPush(sub: { endpoint: string; p256dh: string; auth: string }, json: string): Promise<{ ok: boolean; status: number }> {
  try {
    const url  = new URL(sub.endpoint);
    const jwt  = await makeVapidJwt(`${url.protocol}//${url.host}`);
    const body = await encryptPayload(new TextEncoder().encode(json), b64urlDecode(sub.p256dh), b64urlDecode(sub.auth));
    const res  = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "Content-Length": String(body.length),
        "TTL": "86400",
        "Urgency": "high", // Android holds "normal" pushes while the phone dozes
        "Authorization": `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
      },
      body,
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

// ---------- Fan-out push to a list of user IDs ----------
// Returns [sent, toDelete]
async function fanOut(userIds: (string | number)[], payload: object): Promise<[number, string[]]> {
  if (!userIds.length) return [0, []];
  const idList = userIds.map((u) => `"${u}"`).join(",");
  const subs: any[] = await pgSelect("push_subscriptions",
    `select=id,endpoint,p256dh,auth&user_id=in.(${idList})&enabled=eq.true`);
  if (!subs.length) return [0, []];

  const json     = JSON.stringify(payload);
  const results  = await Promise.all(subs.map((s) => sendWebPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, json)));
  let sent = 0;
  const toDelete: string[] = [];
  results.forEach((r, i) => {
    if (r.ok) sent++;
    else if (r.status === 404 || r.status === 410) toDelete.push(subs[i].id);
  });
  if (toDelete.length) {
    await pgFetch(`push_subscriptions?id=in.(${toDelete.map((x) => `"${x}"`).join(",")})`, { method: "DELETE" });
  }
  return [sent, toDelete];
}

// ---------- Paged select (PostgREST caps a response at 1000 rows) ----------
async function pgSelectAll(table: string, qs: string): Promise<any[]> {
  const PAGE = 1000;
  const out: any[] = [];
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const rows = await pgSelect(table, `${qs}&order=id.asc&limit=${PAGE}&offset=${offset}`);
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// ---------- Role level (mirror of notify-on-activity levelOf / script.js _getUserLevel) ----------
function levelOf(u: any): number {
  const role = u?.role;
  if (!role) return 99;
  const m = String(role).match(/Level\s+(\d+)\b/i);
  if (m) return parseInt(m[1], 10);
  const r = String(role).toLowerCase();
  if (r === "super_admin" || r === "admin") return 1;
  if (r === "marketing_manager") return 2;
  if (r === "manager") return 4;
  if (r === "team_leader") return 5;
  if (r === "consultant") return 7;
  if (r === "agent") return 10;
  if (r === "stock_take_staff" || r === "stock_take") return 15;
  if (r === "customer") return 13;
  if (r === "referrer") return 14;
  const raw = String(role).trim();
  if (raw === "传福大使") return 12;
  if (raw === "改命客户") return 13;
  if (raw === "准传福大使") return 14;
  return 99;
}
const isActiveUser = (u: any) => !!u && u.status !== "deleted" && u.status !== "inactive";
const isRealTeam = (t: unknown) => { const v = String(t ?? "").trim().toLowerCase(); return v !== "" && v !== "unassigned"; };

// ---------- Message formatting: "Today 3:00 PM · CPS · Menara Bangkok Bank" ----------
function mytDateOf(ms: number): string {
  return new Date(ms + MYT_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
}
function fmtTime12(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return `${h % 12 || 12}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function dayLabel(dateStr: string, nowMs: number): string {
  if (dateStr === mytDateOf(nowMs)) return "Today";
  if (dateStr === mytDateOf(nowMs + 86_400_000)) return "Tomorrow";
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return dateStr || "";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
function typeLabel(t: unknown): string {
  const s = String(t || "Activity");
  if (/^[A-Z]{2,4}$/.test(s)) return s; // CPS, FTF, CALL
  return s.toLowerCase().split(/[_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}
function venueOf(a: any): string {
  return String(a?.venue || a?.location_address || "").trim().slice(0, 80);
}
// Who an activity is for: the lead agent + co-agents who accepted (or legacy
// co-agents with no status, added before the invite flow existed).
function attendeeIds(a: any): number[] {
  const ids = new Set<number>();
  if (a.lead_agent_id != null) ids.add(Number(a.lead_agent_id));
  let co: any = a.co_agents;
  if (typeof co === "string") { try { co = JSON.parse(co); } catch { co = null; } }
  if (Array.isArray(co)) {
    for (const c of co) {
      if (c?.id == null) continue;
      const st = c.status == null ? "" : String(c.status).toLowerCase();
      if (st === "" || st === "accepted") ids.add(Number(c.id));
    }
  }
  return [...ids].filter((n) => Number.isFinite(n));
}
// Prospect / customer display names for a set of activities, keyed "p:<id>" / "c:<id>".
async function contactNames(acts: any[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const pIds = [...new Set(acts.map((a) => a.prospect_id).filter((x) => x != null))];
  const cIds = [...new Set(acts.map((a) => a.customer_id).filter((x) => x != null))];
  const [ps, cs] = await Promise.all([
    pIds.length ? pgSelect("prospects", `select=id,full_name&id=in.(${pIds.join(",")})`) : Promise.resolve([]),
    cIds.length ? pgSelect("customers", `select=id,full_name&id=in.(${cIds.join(",")})`) : Promise.resolve([]),
  ]);
  for (const p of ps) if (p.full_name) names.set(`p:${p.id}`, p.full_name);
  for (const c of cs) if (c.full_name) names.set(`c:${c.id}`, c.full_name);
  return names;
}
function contactOf(a: any, names: Map<string, string>): string {
  return (a.prospect_id != null && names.get(`p:${a.prospect_id}`)) ||
         (a.customer_id != null && names.get(`c:${a.customer_id}`)) || "";
}

// ---------- Main handler ----------
// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  // Shared-secret guard: only an authorized cron caller may trigger the fan-out.
  // Accept EITHER of two secret-gated paths so the documented pg_cron jobs work:
  //   1. a matching x-reminder-secret header (REMINDER_SECRET), or
  //   2. Authorization: Bearer <SERVICE_ROLE_KEY>.
  // Both are secrets, so we still fail closed (401) for unauthenticated callers.
  const _secret = Deno.env.get("REMINDER_SECRET") || "";
  const _authHeader = req.headers.get("authorization") || "";
  const _secretOk = !!_secret && req.headers.get("x-reminder-secret") === _secret;
  const _serviceOk = !!SERVICE_ROLE && _authHeader === `Bearer ${SERVICE_ROLE}`;
  if (!_secretOk && !_serviceOk) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(JSON.stringify({ error: "vapid_not_configured" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let mode = "auto";
  let dryRun = false;
  let onlyUserId: number | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.mode) mode = body.mode;
    dryRun = body.dry_run === true;
    if (body.only_user_id != null && Number.isFinite(Number(body.only_user_id))) onlyUserId = Number(body.only_user_id);
  } catch { /**/ }

  const nowMs = Date.now();
  const todayMYT = mytDateOf(nowMs);

  const stats = { reminders_sent: 0, daily_sent: 0, errors: [] as string[], preview: [] as any[] };

  // Only users with a live device can receive anything — skip everyone else.
  let devices = new Set<number>();
  try {
    const subRows: any[] = await pgSelect("push_subscriptions", "select=user_id&enabled=eq.true");
    devices = new Set(subRows.map((r) => Number(r.user_id)).filter((n) => Number.isFinite(n)));
    if (onlyUserId != null) devices = new Set(devices.has(onlyUserId) ? [onlyUserId] : []);
  } catch (e: any) {
    stats.errors.push(`devices: ${e?.message || e}`);
  }

  // ===== 1. ACTIVITY REMINDERS =====
  // Previously filtered status=eq.scheduled, but activities.status is NULL on
  // ~all rows (no default) → zero matches → no reminder was ever sent. Also only
  // users who had saved Settings got any, and only the lead agent was reminded.
  if ((mode === "auto" || mode === "reminder") && devices.size > 0) {
    try {
      const allPrefs: any[] = await pgSelect("notification_preferences", "select=user_id,reminder_minutes");
      const prefMap = new Map<number, number[]>();
      for (const p of allPrefs) {
        const mins = Array.isArray(p.reminder_minutes) ? p.reminder_minutes.map(Number).filter((n: number) => n > 0) : [];
        prefMap.set(Number(p.user_id), mins.length ? mins : DEFAULT_REMINDER_MINUTES);
      }
      const windowsFor = (uid: number) => prefMap.get(uid) ?? DEFAULT_REMINDER_MINUTES;
      let maxWindow = Math.max(...DEFAULT_REMINDER_MINUTES);
      for (const uid of devices) maxWindow = Math.max(maxWindow, ...windowsFor(uid));

      // Bounded to the dates a reminder could fall in (no unbounded scan, no
      // silent 1000-row truncation). activity_date/start_time are MYT wall-clock.
      const toDate = mytDateOf(nowMs + (maxWindow + WINDOW_MIN + 1) * 60_000);
      const activities: any[] = await pgSelectAll("activities",
        "select=id,activity_title,activity_type,activity_date,start_time,lead_agent_id,co_agents,venue,location_address,prospect_id,customer_id" +
        `&activity_date=gte.${todayMYT}&activity_date=lte.${toDate}` +
        "&start_time=not.is.null" +
        "&or=(status.is.null,status.not.in.(completed,cancelled,Completed,Cancelled))");

      // A reminder is due once the activity is within its lead time, with a
      // catch-up tail so a slow/missed 5-min run still sends it. (The old
      // "±3 min of the target" test left gaps: cron starts a hair after the
      // minute, so an activity at hh:02/hh:07/… was 62 then 56.99 min away on
      // consecutive runs and NEVER matched a 60-min reminder.)
      // Grouped per (activity, user): only one push even if several lead
      // times are due at once (e.g. a CPS created 8 min before it starts).
      const due = new Map<string, { act: any; userId: number; windows: number[]; minutesUntil: number }>();
      for (const act of activities) {
        const actMs = new Date(`${act.activity_date}T${act.start_time}+08:00`).getTime();
        if (isNaN(actMs)) continue;
        const minutesUntil = (actMs - nowMs) / 60_000;
        if (minutesUntil < 0 || minutesUntil > maxWindow + WINDOW_MIN) continue;
        for (const userId of attendeeIds(act)) {
          if (!devices.has(userId)) continue;
          const windows = windowsFor(userId).filter((w) =>
            minutesUntil <= w + 0.5 && minutesUntil > w - REMINDER_CATCHUP_MIN);
          if (windows.length) due.set(`${act.id}:${userId}`, { act, userId, windows, minutesUntil });
        }
      }

      if (due.size > 0) {
        // One query for the dedupe log instead of one per candidate.
        const actIds = [...new Set([...due.values()].map((d) => d.act.id))];
        const logged: any[] = await pgSelect("notification_reminder_log",
          `select=activity_id,user_id,reminder_minutes&activity_id=in.(${actIds.join(",")})`);
        const sentKeys = new Set(logged.map((l) => `${l.activity_id}:${l.user_id}:${l.reminder_minutes}`));
        const names = await contactNames([...due.values()].map((d) => d.act));

        for (const { act, userId, windows, minutesUntil } of due.values()) {
          const pending = windows.filter((w) => !sentKeys.has(`${act.id}:${userId}:${w}`));
          if (pending.length === 0) continue; // already sent
          const windowMin = Math.min(...pending);

          let label = `${Math.max(1, Math.round(minutesUntil))} min`;
          if (windowMin === 60) label = "1 hour";
          if (windowMin === 1440) label = "1 day";
          const type = typeLabel(act.activity_type);
          const who = contactOf(act, names);
          const whenWhere = [`${dayLabel(act.activity_date, nowMs)} ${fmtTime12(act.start_time)}`.trim(), type, venueOf(act)]
            .filter(Boolean).join(" · ");
          const title = String(act.activity_title || "").trim();
          const extra = !who && title && title !== act.activity_type ? title : "";
          const payload = {
            title: `⏰ ${type} in ${label}${who ? ` — ${who}` : ""}`,
            body: extra ? `${whenWhere}\n${extra}` : whenWhere,
            icon: "icons/icon-192x192.png",
            badge: "icons/icon-72x72.png",
            tag: `reminder_${act.id}_${windowMin}`,
            data: { type: "activity_reminder", activityId: act.id, url: "./index.html#calendar" },
          };

          if (dryRun) { stats.preview.push({ kind: "reminder", userId, payload }); continue; }
          const [sent] = await fanOut([userId], payload);
          if (sent > 0) {
            // Logged only after a successful send, so a failed send retries on
            // the next run while still inside the catch-up tail. Log every lead
            // time that was due so the larger one doesn't fire again next run.
            await pgUpsert("notification_reminder_log",
              pending.map((w) => ({ activity_id: act.id, user_id: userId, reminder_minutes: w })),
              "activity_id,user_id,reminder_minutes");
            pending.forEach((w) => sentKeys.add(`${act.id}:${userId}:${w}`));
            stats.reminders_sent++;
          }
        }
      }
    } catch (e: any) {
      stats.errors.push(`reminders: ${e?.message || e}`);
    }
  }

  // ===== 2. MORNING SUMMARY (08:30 MYT) =====
  const nowMYT = new Date(nowMs + MYT_OFFSET_HOURS * 3600_000);
  const mytMinuteOfDay = nowMYT.getUTCHours() * 60 + nowMYT.getUTCMinutes();
  const isDailySummaryWindow = Math.abs(mytMinuteOfDay - DAILY_SUMMARY_MINUTE_OF_DAY) <= WINDOW_MIN;

  if (((mode === "auto" && isDailySummaryWindow) || mode === "daily_summary") && devices.size > 0) {
    try {
      const todayMMDD = todayMYT.slice(5); // MM-DD for birthday matching

      // Recipients: active staff (L1–L12) with a device, unless they switched
      // the summary off. No saved preference row = on (the Settings default).
      const [users, optOut]: [any[], any[]] = await Promise.all([
        pgSelect("users", "select=id,full_name,role,status,team,date_of_birth"),
        pgSelect("notification_preferences", "select=user_id&daily_summary=eq.false"),
      ]);
      const userMap = new Map<number, any>(users.map((u: any) => [Number(u.id), u]));
      const off = new Set(optOut.map((p: any) => Number(p.user_id)));
      const recipients = [...devices].filter((id) => {
        const u = userMap.get(id);
        return isActiveUser(u) && levelOf(u) <= 12 && !off.has(id);
      });

      // Today's activities. (The old select asked for customer_name, a column
      // that never existed → 400 → no summary. Names come from prospect/customer ids.)
      const allTodayActs: any[] = await pgSelectAll("activities",
        "select=id,activity_title,activity_type,start_time,lead_agent_id,co_agents,venue,location_address,prospect_id,customer_id" +
        `&activity_date=eq.${todayMYT}` +
        "&activity_type=neq.EVENT" +
        "&or=(status.is.null,status.not.in.(cancelled,Cancelled))");

      // Today's company-wide events (open/public only — visible to everyone).
      const allTodayEvents: any[] = await pgSelect("activities",
        `select=id,activity_title,activity_type,start_time,event_id,venue,location_address` +
        `&activity_date=eq.${todayMYT}` +
        `&activity_type=eq.EVENT` +
        `&visibility=in.(open,public)` +
        `&order=start_time.asc&limit=50`);
      const eventTitles = new Map<number, string>();
      const eventIds = [...new Set(allTodayEvents.map((e: any) => e.event_id).filter(Boolean))];
      if (eventIds.length > 0) {
        const evRows: any[] = await pgSelect("events", `select=id,event_title,title&id=in.(${eventIds.join(",")})`);
        for (const ev of evRows) eventTitles.set(Number(ev.id), ev.event_title || ev.title || "Event");
      }
      // One line per event, not per attendee row.
      const seenEventIds = new Set<number>();
      const dedupedEvents: any[] = [];
      for (const e of allTodayEvents) {
        const eid = Number(e.event_id);
        if (!seenEventIds.has(eid)) { seenEventIds.add(eid); dedupedEvents.push(e); }
      }

      // Birthdays. date_of_birth is a DATE column, so PostgREST `like` errored
      // (42883) and took the whole summary down — match MM-DD here instead.
      // Scoped per recipient: own prospects/customers (responsible agent) and
      // same-team colleagues only — never another team's people.
      const isToday = (dob: unknown) => typeof dob === "string" && dob.slice(5, 10) === todayMMDD;
      const [bdayProspects, bdayCustomers] = await Promise.all([
        pgSelectAll("prospects", "select=id,full_name,date_of_birth,responsible_agent_id&date_of_birth=not.is.null&or=(status.is.null,status.neq.inactive)"),
        pgSelectAll("customers", "select=id,full_name,date_of_birth,responsible_agent_id&date_of_birth=not.is.null"),
      ]);
      const bdayContacts = [...bdayProspects, ...bdayCustomers].filter((x: any) => isToday(x.date_of_birth) && x.full_name);
      const bdayAgents = users.filter((u: any) => isActiveUser(u) && levelOf(u) <= 12 && isToday(u.date_of_birth) && u.full_name);

      const names = await contactNames(allTodayActs);

      for (const userId of recipients) {
        const me = userMap.get(userId);
        const myActs = allTodayActs.filter((a: any) => attendeeIds(a).includes(userId));
        const myBirthdays = [
          ...bdayContacts.filter((x: any) => Number(x.responsible_agent_id) === userId).map((x: any) => x.full_name),
          ...bdayAgents
            .filter((u: any) => Number(u.id) !== userId && isRealTeam(me?.team) && String(u.team ?? "") === String(me?.team ?? ""))
            .map((u: any) => `${u.full_name} (Agent)`),
        ];

        if (myActs.length === 0 && dedupedEvents.length === 0 && myBirthdays.length === 0) continue;

        const bodyLines: string[] = [];
        if (myActs.length > 0) {
          const sortedActs = myActs.sort((a: any, b: any) => (a.start_time || "").localeCompare(b.start_time || ""));
          bodyLines.push("📋 Your activities:");
          for (const a of sortedActs.slice(0, 4)) {
            const line = [fmtTime12(a.start_time) || "Anytime", typeLabel(a.activity_type), venueOf(a), contactOf(a, names)]
              .filter(Boolean).join(" · ");
            bodyLines.push(`  ${line}`);
          }
          if (myActs.length > 4) bodyLines.push(`  …+${myActs.length - 4} more`);
        }
        if (dedupedEvents.length > 0) {
          bodyLines.push("📅 Events today:");
          for (const e of dedupedEvents.slice(0, 3)) {
            const title = eventTitles.get(Number(e.event_id)) || e.activity_title || "Event";
            bodyLines.push(`  ${[fmtTime12(e.start_time), title, venueOf(e)].filter(Boolean).join(" · ")}`);
          }
          if (dedupedEvents.length > 3) bodyLines.push(`  …+${dedupedEvents.length - 3} more`);
        }
        if (myBirthdays.length > 0) {
          bodyLines.push("🎂 Birthdays today:");
          bodyLines.push(`  ${myBirthdays.slice(0, 4).join(", ")}${myBirthdays.length > 4 ? ` +${myBirthdays.length - 4} more` : ""}`);
        }

        const titleParts: string[] = [];
        if (myActs.length > 0) titleParts.push(`${myActs.length} activit${myActs.length > 1 ? "ies" : "y"}`);
        if (dedupedEvents.length > 0) titleParts.push(`${dedupedEvents.length} event${dedupedEvents.length > 1 ? "s" : ""}`);
        if (myBirthdays.length > 0) titleParts.push(`${myBirthdays.length} birthday${myBirthdays.length > 1 ? "s" : ""}`);

        const payload = {
          title: `Good morning! Today: ${titleParts.join(", ")} 🌅`,
          body: bodyLines.join("\n"),
          icon: "icons/icon-192x192.png",
          badge: "icons/icon-72x72.png",
          tag: `daily_${todayMYT}_${userId}`,
          data: { type: "daily_summary", url: "./index.html#calendar" },
        };
        if (dryRun) { stats.preview.push({ kind: "daily_summary", userId, payload }); continue; }

        // Server-side dedupe: the ±WINDOW_MIN window can match two consecutive
        // 5-min runs. Mark-before-send on (user_id, summary_date) so each user
        // gets at most one summary a day. Degrade (send without dedupe) if the
        // daily_summary_log table is absent.
        try {
          const sentToday: any[] = await pgSelect("daily_summary_log",
            `select=user_id&user_id=eq.${userId}&summary_date=eq.${todayMYT}&limit=1`);
          if (sentToday.length > 0) continue;
          await pgUpsert("daily_summary_log", [{ user_id: userId, summary_date: todayMYT }], "user_id,summary_date");
        } catch (dedupErr) {
          console.warn("[reminders] daily_summary_log dedupe unavailable — sending without dedup:", (dedupErr as any)?.message);
        }

        const [sent] = await fanOut([userId], payload);
        if (sent > 0) stats.daily_sent++;
      }
    } catch (e: any) {
      stats.errors.push(`daily_summary: ${e?.message || e}`);
    }
  }

  if (stats.errors.length) console.error("[reminders] errors:", stats.errors);
  const { preview, ...rest } = stats;
  return new Response(JSON.stringify({ ok: true, ...rest, ...(dryRun ? { preview } : {}) }), {
    status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
