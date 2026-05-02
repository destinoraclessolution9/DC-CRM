// supabase/functions/send-activity-reminders/index.ts
// Cron-triggered Edge Function (every 5 min via pg_cron + pg_net).
// Sends reminder push notifications for upcoming activities and a daily summary.
//
// Request body (optional): { mode?: "reminder" | "daily_summary" }
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

// How many minutes before/after a target window we still fire (window = ±WINDOW_MIN)
// Edge function runs every 5 min, window = 3 min gives safe overlap without double-fire.
const WINDOW_MIN = 3;

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

// ---------- Format a friendly time string (MYT) ----------
function formatTime(activityDate: string, startTime: string): string {
  try {
    const iso = `${activityDate}T${startTime}+08:00`;
    return new Date(iso).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return startTime || "";
  }
}

// ---------- Main handler ----------
// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(JSON.stringify({ error: "vapid_not_configured" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let mode = "auto";
  try {
    const body = await req.json().catch(() => ({}));
    if (body.mode) mode = body.mode;
  } catch { /**/ }

  const now = new Date();
  const nowMYT = new Date(now.getTime() + MYT_OFFSET_HOURS * 3600_000);
  const nowMinutes = now.getTime() / 60_000; // current time in fractional minutes (UTC)

  const stats = { reminders_sent: 0, daily_sent: 0, errors: [] as string[] };

  // ===== 1. ACTIVITY REMINDERS =====
  if (mode === "auto" || mode === "reminder") {
    try {
      // Fetch all unique reminder_minutes values across all users
      const allPrefs: any[] = await pgSelect("notification_preferences",
        `select=user_id,reminder_minutes`);

      // Collect all distinct reminder window values in use
      const allWindows = new Set<number>();
      for (const pref of allPrefs) {
        for (const m of (pref.reminder_minutes || [15])) allWindows.add(Number(m));
      }

      if (allWindows.size > 0) {
        // Find activities scheduled within the next 1441 minutes (max window = 1 day + 1 min buffer)
        // status='scheduled', date+time in the future up to 1441 minutes away
        const activities: any[] = await pgSelect("activities",
          `select=id,activity_title,activity_type,activity_date,start_time,lead_agent_id` +
          `&status=eq.scheduled` +
          `&activity_date=gte.${now.toISOString().slice(0, 10)}` // today or future
        );

        // Build map: user_id -> reminder_minutes[]
        const prefMap = new Map<number, number[]>();
        for (const p of allPrefs) prefMap.set(Number(p.user_id), p.reminder_minutes || [15]);

        // For each activity, calculate minutes until it starts
        for (const act of activities) {
          if (!act.activity_date || !act.start_time || !act.lead_agent_id) continue;

          // Parse activity datetime in MYT (UTC+8) -> compare to now (UTC)
          let actDatetimeMs: number;
          try {
            actDatetimeMs = new Date(`${act.activity_date}T${act.start_time}+08:00`).getTime();
          } catch {
            continue;
          }
          const minutesUntil = (actDatetimeMs - now.getTime()) / 60_000;
          if (minutesUntil < 0 || minutesUntil > 1441) continue; // past or too far

          const userId = Number(act.lead_agent_id);
          const userWindows = prefMap.get(userId) || [];

          for (const windowMin of userWindows) {
            // Fire if minutesUntil is within ±WINDOW_MIN of the target
            if (Math.abs(minutesUntil - windowMin) > WINDOW_MIN) continue;

            // Deduplicate: check reminder_log
            const existing: any[] = await pgSelect("notification_reminder_log",
              `select=id&activity_id=eq.${act.id}&user_id=eq.${userId}&reminder_minutes=eq.${windowMin}&limit=1`);
            if (existing.length > 0) continue; // already sent

            // Build human-friendly label
            let label = `${windowMin} min`;
            if (windowMin === 60)  label = "1 hour";
            if (windowMin === 1440) label = "1 day";

            const timeStr = formatTime(act.activity_date, act.start_time);
            const payload = {
              title: `Reminder: ${act.activity_title || act.activity_type || "Activity"}`,
              body: `Starts in ${label} — ${timeStr}`,
              icon: "icons/icon-192x192.png",
              badge: "icons/icon-72x72.png",
              tag: `reminder_${act.id}_${windowMin}`,
              data: { type: "activity_reminder", activityId: act.id, url: "./index.html#calendar" },
            };

            const [sent] = await fanOut([userId], payload);
            if (sent > 0) {
              // Log so we don't resend
              await pgUpsert("notification_reminder_log",
                [{ activity_id: act.id, user_id: userId, reminder_minutes: windowMin }],
                "activity_id,user_id,reminder_minutes");
              stats.reminders_sent++;
            }
          }
        }
      }
    } catch (e: any) {
      stats.errors.push(`reminders: ${e?.message || e}`);
    }
  }

  // ===== 2. DAILY SUMMARY (10:00 AM MYT = 02:00 UTC) =====
  // We check within a ±WINDOW_MIN window of 10:00 AM MYT regardless of cron schedule.
  const mytHour   = nowMYT.getUTCHours();
  const mytMinute = nowMYT.getUTCMinutes();
  const mytMinuteOfDay = mytHour * 60 + mytMinute;
  const targetMinuteOfDay = 10 * 60; // 10:00 AM
  const isDailySummaryWindow = Math.abs(mytMinuteOfDay - targetMinuteOfDay) <= WINDOW_MIN;

  if ((mode === "auto" && isDailySummaryWindow) || mode === "daily_summary") {
    try {
      const todayMYT = nowMYT.toISOString().slice(0, 10); // YYYY-MM-DD in MYT
      const todayMMDD = todayMYT.slice(5); // MM-DD for birthday matching

      // Users who want daily summary
      const prefs: any[] = await pgSelect("notification_preferences",
        `select=user_id&daily_summary=eq.true`);

      // --- Shared data fetched once for all users ---

      // Today's activities with customer/prospect names (denormalised customer_name field)
      const allTodayActs: any[] = await pgSelect("activities",
        `select=id,activity_title,activity_type,start_time,lead_agent_id,customer_name,co_agents` +
        `&activity_date=eq.${todayMYT}` +
        `&activity_type=neq.EVENT`);

      // Today's events (shared across all users — open/public visibility)
      const allTodayEvents: any[] = await pgSelect("activities",
        `select=id,activity_title,activity_type,start_time,event_id` +
        `&activity_date=eq.${todayMYT}` +
        `&activity_type=eq.EVENT` +
        `&visibility=in.(open,public)` +
        `&order=start_time.asc&limit=5`);

      // Fetch event titles for today's public events
      let eventTitles: Map<number, string> = new Map();
      if (allTodayEvents.length > 0) {
        const eventIds = [...new Set(allTodayEvents.map((e: any) => e.event_id).filter(Boolean))];
        if (eventIds.length > 0) {
          const evRows: any[] = await pgSelect("events",
            `select=id,event_title,title&id=in.(${eventIds.join(",")})`);
          for (const ev of evRows) {
            eventTitles.set(Number(ev.id), ev.event_title || ev.title || "Event");
          }
        }
      }
      // Deduplicate public events by event_id (one pill per event, not per attendee row)
      const seenEventIds = new Set<number>();
      const dedupedEvents: any[] = [];
      for (const e of allTodayEvents) {
        const eid = Number(e.event_id);
        if (!seenEventIds.has(eid)) { seenEventIds.add(eid); dedupedEvents.push(e); }
      }

      // Today's birthdays from prospects and customers
      const [bdayProspects, bdayCustomers]: [any[], any[]] = await Promise.all([
        pgSelect("prospects", `select=full_name&date_of_birth=like.*-${todayMMDD}&status=neq.inactive`),
        pgSelect("customers", `select=full_name&date_of_birth=like.*-${todayMMDD}`),
      ]);
      const birthdayNames = [
        ...bdayProspects.map((p: any) => p.full_name),
        ...bdayCustomers.map((c: any) => c.full_name),
      ].filter(Boolean);

      // --- Per-user notification ---
      for (const pref of prefs) {
        const userId = Number(pref.user_id);

        // This user's today activities (lead agent OR listed as co-agent)
        const myActs = allTodayActs.filter((a: any) => {
          if (Number(a.lead_agent_id) === userId) return true;
          if (Array.isArray(a.co_agents)) {
            return a.co_agents.some((ca: any) => Number(ca.id) === userId);
          }
          return false;
        });

        const hasAnything = myActs.length > 0 || dedupedEvents.length > 0 || birthdayNames.length > 0;
        if (!hasAnything) continue;

        const bodyLines: string[] = [];

        // Section: Today's activities
        if (myActs.length > 0) {
          const sortedActs = myActs.sort((a: any, b: any) =>
            (a.start_time || "").localeCompare(b.start_time || ""));
          bodyLines.push("📋 Your Activities:");
          for (const a of sortedActs.slice(0, 4)) {
            const t = a.start_time ? a.start_time.slice(0, 5) : "--:--";
            const type = a.activity_type || "Activity";
            const name = a.customer_name || a.activity_title || "";
            bodyLines.push(`  ${t} [${type}]${name ? ` – ${name}` : ""}`);
          }
          if (myActs.length > 4) bodyLines.push(`  …+${myActs.length - 4} more`);
        }

        // Section: Events
        if (dedupedEvents.length > 0) {
          bodyLines.push("📅 Events Today:");
          for (const e of dedupedEvents.slice(0, 3)) {
            const t = e.start_time ? e.start_time.slice(0, 5) : "";
            const title = eventTitles.get(Number(e.event_id)) || e.activity_title || "Event";
            bodyLines.push(`  ${t ? t + " " : ""}${title}`);
          }
          if (dedupedEvents.length > 3) bodyLines.push(`  …+${dedupedEvents.length - 3} more`);
        }

        // Section: Birthdays
        if (birthdayNames.length > 0) {
          bodyLines.push("🎂 Birthdays Today:");
          const shown = birthdayNames.slice(0, 4);
          bodyLines.push(`  ${shown.join(", ")}${birthdayNames.length > 4 ? ` +${birthdayNames.length - 4} more` : ""}`);
        }

        const actCount = myActs.length;
        const titleParts: string[] = [];
        if (actCount > 0) titleParts.push(`${actCount} activit${actCount > 1 ? "ies" : "y"}`);
        if (dedupedEvents.length > 0) titleParts.push(`${dedupedEvents.length} event${dedupedEvents.length > 1 ? "s" : ""}`);
        if (birthdayNames.length > 0) titleParts.push(`${birthdayNames.length} birthday${birthdayNames.length > 1 ? "s" : ""}`);

        const payload = {
          title: `Good morning! Today: ${titleParts.join(", ")} 🌅`,
          body: bodyLines.join("\n"),
          icon: "icons/icon-192x192.png",
          badge: "icons/icon-72x72.png",
          tag: `daily_${todayMYT}_${userId}`,
          data: { type: "daily_summary", url: "./index.html#calendar" },
        };

        const [sent] = await fanOut([userId], payload);
        if (sent > 0) stats.daily_sent++;
      }
    } catch (e: any) {
      stats.errors.push(`daily_summary: ${e?.message || e}`);
    }
  }

  return new Response(JSON.stringify({ ok: true, ...stats }), {
    status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
