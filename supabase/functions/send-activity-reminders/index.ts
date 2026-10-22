// supabase/functions/send-activity-reminders/index.ts
// Cron-triggered Edge Function (every 5 min via pg_cron + pg_net).
// Queues reminder notifications for upcoming activities and the morning summary
// into notification_outbox, then asks send-activity-push to deliver everything
// due (which also retries earlier failed rows).
//
// Request body (optional): { mode?: "reminder" | "daily_summary",
//   dry_run?: boolean      -- compute + return payloads, send/log nothing
//   only_user_id?: number  -- restrict recipients to one user (manual testing) }
// When called without a body (or mode="reminder"), it checks both reminders
// and daily summary (based on time-of-day).

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
// Calendar "event" activity types (mirror of notify-on-activity EVENT_TYPES).
const EVENT_TYPES = new Set(["EVENT", "AGENT_MEETING", "AGENT_TRAINING"]);

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

// ---------- Outbox: queue rows, then hand delivery to send-activity-push ----------
// Rows already queued under the same (user_id, dedupe_key) are skipped, so a
// reminder or summary is never queued twice no matter how many runs match.
async function queueRows(rows: any[]): Promise<any[]> {
  return (await pgFetch("notification_outbox?on_conflict=user_id,dedupe_key&select=id,kind,status", {
    method: "POST",
    headers: { "Prefer": "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(rows),
  })) || [];
}

// Deliver every due pending/failed row (new ones + retries) via the one sender.
async function dispatchDue(): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-activity-push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify({ dispatch: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`dispatch ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
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

// ---------- Notification templates (owner-approved 2026-10-15) ----------
//   line 1: "Today 3pm CPS"  /  events: "Today 10pm 特训班"
//   line 2: "Agent | Customer"  (events: agent only). No venue.
// Keep identical to notify-on-activity + the client co-agent pushes.
function fmtShortTime(t: unknown): string {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  const mm = Number.isFinite(m) && m > 0 ? `:${String(m).padStart(2, "0")}` : "";
  return `${h % 12 || 12}${mm}${h >= 12 ? "pm" : "am"}`;
}
const isEventType = (r: any) => EVENT_TYPES.has(String(r?.activity_type ?? "").toUpperCase());
const whatOf = (r: any, eventTitle?: string) => {
  const title = String(eventTitle || r?.activity_title || "").trim();
  return isEventType(r) && title ? title : typeLabel(r?.activity_type);
};
function customerOf(r: any, contact: string): string {
  if (isEventType(r)) return "";
  if (contact) return contact;
  const title = String(r?.activity_title || "").trim();
  return title && title.toUpperCase() !== String(r?.activity_type || "").toUpperCase() ? title : "";
}
const peopleLine = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" | ").slice(0, 200);

// ---------- 每天一智 · Daily Wisdom (same entry as the login popup) ----------
// Read from the site's own chunks/script-daily-note.js (generated by
// build_daily_notes.py) so the push and the popup can never disagree. The
// popup picks by device-local day ordinal; staff are in MYT, so the ordinal is
// floor(MYT-midnight epoch / 1 day) — identical to new Date(y,m,d).getTime().
const DAILY_NOTE_URL = Deno.env.get("DAILY_NOTE_URL") || "https://destinoraclessolution.com/chunks/script-daily-note.js";
let _wisdomSrc: { notes: any[]; hex: string[]; hexpy: string[] } | null = null;
async function dailyWisdom(todayMYT: string): Promise<{ head: string; quote: string } | null> {
  if (!_wisdomSrc) {
    const res = await fetch(DAILY_NOTE_URL);
    if (!res.ok) throw new Error(`daily-note ${res.status}`);
    const js = await res.text();
    const a = js.indexOf("var NOTES = ");
    const b = js.indexOf("\n];", a);
    const notes = JSON.parse(js.slice(a + "var NOTES = ".length, b + 3).replace(/;\s*$/, ""));
    const arr = (name: string) => {
      const m = js.match(new RegExp(`var ${name} = (\\[[^\\]]*\\])`));
      return m ? JSON.parse(m[1].replace(/'/g, '"')) : [];
    };
    _wisdomSrc = { notes, hex: arr("HEX"), hexpy: arr("HEXPY") };
  }
  const { notes, hex } = _wisdomSrc;
  if (!notes.length || hex.length !== 64) return null;
  const ord = Math.floor(Date.parse(`${todayMYT}T00:00:00+08:00`) / 86_400_000);
  const note = notes[((ord % notes.length) + notes.length) % notes.length];
  const hi = ((ord % 64) + 64) % 64;
  const tag = String(note?.section || note?.chapter || "").trim();
  return {
    head: `📖 #${hi + 1} ${hex[hi]}${tag ? ` · ${tag}` : ""}`,
    quote: String(note?.zh || "").trim(),
  };
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

  // ===== 0. DISPATCH-ONLY (every-minute cron "notification-dispatch") =====
  // Delivers held change alerts and retries. One indexed lookup; the sender is
  // only woken when a row is actually due.
  if (mode === "dispatch") {
    try {
      const staleIso = new Date(nowMs - 5 * 60_000).toISOString();
      const dueRows: any[] = await pgSelect("notification_outbox",
        `select=id&due_at=lte.${new Date(nowMs).toISOString()}&attempts=lt.3` +
        `&created_at=gte.${new Date(nowMs - 86_400_000).toISOString()}` +
        `&or=(status.in.(pending,failed),and(status.eq.sending,claimed_at.lt.${staleIso}))&limit=1`);
      const dispatch = dueRows.length ? await dispatchDue() : null;
      return new Response(JSON.stringify({ ok: true, mode, due: dueRows.length, dispatch }), {
        status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (e: any) {
      console.error("[reminders] dispatch:", e?.message || e);
      return new Response(JSON.stringify({ ok: false, mode, error: String(e?.message || e) }), {
        status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  }

  const stats = { reminders_queued: 0, daily_queued: 0, dispatch: null as any, errors: [] as string[], preview: [] as any[] };
  const queue: any[] = [];

  // Staff who can receive anything: active users in the L1–L12 band. Rows are
  // queued for them whether or not they have a phone signed up — the in-app
  // bell (notification_outbox) is the fallback channel.
  let userMap = new Map<number, any>();
  const canReceive = (id: number) => {
    const u = userMap.get(id);
    return isActiveUser(u) && levelOf(u) <= 12 && (onlyUserId == null || id === onlyUserId);
  };
  try {
    const users: any[] = await pgSelect("users", "select=id,full_name,role,status,team,date_of_birth");
    userMap = new Map(users.map((u: any) => [Number(u.id), u]));
  } catch (e: any) {
    stats.errors.push(`users: ${e?.message || e}`);
  }

  // ===== 1. ACTIVITY REMINDERS =====
  // (Before 2026-10-14 this filtered status=eq.scheduled, but activities.status
  // is NULL on ~all rows → no reminder was ever sent. Only users who had saved
  // Settings got any, and only the lead agent was reminded.)
  if ((mode === "auto" || mode === "reminder") && userMap.size > 0) {
    try {
      const allPrefs: any[] = await pgSelect("notification_preferences", "select=user_id,reminder_minutes");
      const prefMap = new Map<number, number[]>();
      for (const p of allPrefs) {
        const mins = Array.isArray(p.reminder_minutes) ? p.reminder_minutes.map(Number).filter((n: number) => n > 0) : [];
        prefMap.set(Number(p.user_id), mins.length ? mins : DEFAULT_REMINDER_MINUTES);
      }
      const windowsFor = (uid: number) => prefMap.get(uid) ?? DEFAULT_REMINDER_MINUTES;
      // Per-activity override (activities.reminder_minutes, set in the activity
      // form) wins over each person's own setting.
      const actWindows = (act: any): number[] | null => {
        const m = Array.isArray(act.reminder_minutes) ? act.reminder_minutes.map(Number).filter((n: number) => n > 0) : [];
        return m.length ? m : null;
      };
      // Widest lead time anyone could use: personal prefs, or up to 1 day when
      // an activity carries its own reminder times.
      let maxWindow = Math.max(1440, ...DEFAULT_REMINDER_MINUTES);
      for (const mins of prefMap.values()) maxWindow = Math.max(maxWindow, ...mins);

      // Bounded to the dates a reminder could fall in (no unbounded scan, no
      // silent 1000-row truncation). activity_date/start_time are MYT wall-clock.
      const toDate = mytDateOf(nowMs + (maxWindow + WINDOW_MIN + 1) * 60_000);
      const activities: any[] = await pgSelectAll("activities",
        "select=id,activity_title,activity_type,activity_date,start_time,lead_agent_id,co_agents,venue,location_address,prospect_id,customer_id,event_id,reminder_minutes" +
        `&activity_date=gte.${todayMYT}&activity_date=lte.${toDate}` +
        "&start_time=not.is.null" +
        "&or=(status.is.null,status.not.in.(completed,cancelled,Completed,Cancelled))");

      // Event registrants: agents attending (attendee_type 'agent') and agents
      // who registered a guest (added_by_agent_id). Open events are NOT
      // reminded to all staff — they see them in the morning summary.
      const isEventRow = (act: any) => act.event_id != null && EVENT_TYPES.has(String(act.activity_type || "").toUpperCase());
      const eventIds = [...new Set(activities.filter(isEventRow).map((a) => a.event_id))];
      const registrants = new Map<string, Set<number>>();
      if (eventIds.length) {
        const att: any[] = await pgSelectAll("event_attendees",
          `select=id,event_id,attendee_type,attendee_id,added_by_agent_id&event_id=in.(${eventIds.join(",")})`);
        for (const r of att) {
          const k = String(r.event_id);
          if (!registrants.has(k)) registrants.set(k, new Set());
          if (r.attendee_type === "agent" && r.attendee_id != null) registrants.get(k)!.add(Number(r.attendee_id));
          if (r.added_by_agent_id != null) registrants.get(k)!.add(Number(r.added_by_agent_id));
        }
      }

      // A reminder is due once the activity is within its lead time, with a
      // catch-up tail so a slow/missed 5-min run still sends it. (A "±3 min of
      // the target" test left gaps: cron starts a hair after the minute, so an
      // activity at hh:02/hh:07/… was 62 then 56.99 min away on consecutive runs
      // and NEVER matched a 60-min reminder.) One push per (subject, user) even
      // if several lead times are due at once — subject = the event for event
      // rows (an agent bringing 3 guests has 3 rows, gets 1 reminder), else the
      // activity. Other due lead times are queued as 'merged' so they never
      // fire later; dedupe_key makes every run idempotent.
      const due = new Map<string, { act: any; subject: string; userId: number; windows: number[]; minutesUntil: number }>();
      for (const act of activities) {
        const actMs = new Date(`${act.activity_date}T${act.start_time}+08:00`).getTime();
        if (isNaN(actMs)) continue;
        const minutesUntil = (actMs - nowMs) / 60_000;
        if (minutesUntil < 0 || minutesUntil > maxWindow + WINDOW_MIN) continue;
        const subject = isEventRow(act) ? `ev:${act.event_id}` : String(act.id);
        const people = new Set<number>(attendeeIds(act));
        if (isEventRow(act)) for (const u of registrants.get(String(act.event_id)) || []) people.add(u);
        const override = actWindows(act);
        for (const userId of people) {
          if (!canReceive(userId)) continue;
          const key = `${subject}:${userId}`;
          if (due.has(key)) continue;
          const windows = (override ?? windowsFor(userId)).filter((w) =>
            minutesUntil <= w + 0.5 && minutesUntil > w - REMINDER_CATCHUP_MIN);
          if (windows.length) due.set(key, { act, subject, userId, windows, minutesUntil });
        }
      }

      if (due.size > 0) {
        const names = await contactNames([...due.values()].map((d) => d.act));
        for (const { act, subject, userId, windows, minutesUntil } of due.values()) {
          const windowMin = Math.min(...windows);
          // Event rows are per guest — name the event, not one agent's guest.
          const customer = subject.startsWith("ev:") ? "" : customerOf(act, contactOf(act, names));
          const lead = userMap.get(Number(act.lead_agent_id));
          const headline = [dayLabel(act.activity_date, nowMs), fmtShortTime(act.start_time), whatOf(act)].filter(Boolean).join(" ");
          // Start date+time in the key: a rescheduled activity gets fresh
          // reminders instead of being blocked by the old time's key.
          const keyOf = (w: number) => `reminder:${subject}:${act.activity_date}T${String(act.start_time).slice(0, 5)}:${w}`;
          const row = {
            user_id: userId, kind: "activity_reminder", priority: "normal",
            title: `⏰ ${headline}`,
            body: peopleLine(lead?.full_name, customer),
            url: "./index.html#calendar", activity_id: act.id,
            dedupe_key: keyOf(windowMin), status: "pending",
            // Start time lets the sender skip a reminder that quiet hours would
            // delay past the start (bell only instead).
            meta: { starts_at: new Date(`${act.activity_date}T${act.start_time}+08:00`).toISOString() },
          };
          if (dryRun) { stats.preview.push({ kind: "reminder", userId, payload: row }); continue; }
          queue.push(row);
          for (const w of windows) {
            if (w !== windowMin) queue.push({ ...row, status: "merged", dedupe_key: keyOf(w) });
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

  if (((mode === "auto" && isDailySummaryWindow) || mode === "daily_summary") && userMap.size > 0) {
    try {
      const todayMMDD = todayMYT.slice(5); // MM-DD for birthday matching

      // Recipients: active staff (L1–L12) unless they switched the summary off.
      // No saved preference row = on (the Settings default).
      const optOut: any[] = await pgSelect("notification_preferences", "select=user_id&daily_summary=eq.false");
      const off = new Set(optOut.map((p: any) => Number(p.user_id)));
      const recipients = [...userMap.keys()].filter((id) => canReceive(id) && !off.has(id));

      // Today's activities. (The pre-2026-10-14 select asked for customer_name,
      // a column that never existed → 400 → no summary. Names come from ids.)
      // Birthday wish/gift logs are history, not the day's plan — dropped.
      const allTodayActs: any[] = (await pgSelectAll("activities",
        "select=id,activity_title,activity_type,start_time,lead_agent_id,co_agents,venue,location_address,prospect_id,customer_id,source" +
        `&activity_date=eq.${todayMYT}` +
        "&activity_type=neq.EVENT" +
        "&or=(status.is.null,status.not.in.(cancelled,Cancelled))"))
        .filter((a: any) => a.source !== "birthday_auto");

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
        // events has `title` (no event_title column — asking for it 400'd and
        // took down the whole summary on any day with an open event). Titles
        // are optional: a failed lookup falls back to the activity title.
        try {
          const evRows: any[] = await pgSelect("events", `select=id,title&id=in.(${eventIds.join(",")})`);
          for (const ev of evRows) eventTitles.set(Number(ev.id), ev.title || "Event");
        } catch (e: any) {
          stats.errors.push(`event_titles: ${e?.message || e}`);
        }
      }
      // One line per event, not per attendee row.
      const seenEventIds = new Set<number>();
      const dedupedEvents: any[] = [];
      for (const e of allTodayEvents) {
        const eid = Number(e.event_id);
        if (!seenEventIds.has(eid)) { seenEventIds.add(eid); dedupedEvents.push(e); }
      }

      // Birthdays. date_of_birth is a DATE column (PostgREST `like` errors on
      // it), so match MM-DD here. Scoped per recipient: own prospects/customers
      // (responsible agent) and same-team colleagues only — never another team's.
      const isToday = (dob: unknown) => typeof dob === "string" && dob.slice(5, 10) === todayMMDD;
      const [bdayProspects, bdayCustomers] = await Promise.all([
        pgSelectAll("prospects", "select=id,full_name,date_of_birth,responsible_agent_id&date_of_birth=not.is.null&or=(status.is.null,status.neq.inactive)"),
        pgSelectAll("customers", "select=id,full_name,date_of_birth,responsible_agent_id&date_of_birth=not.is.null"),
      ]);
      const bdayContacts = [...bdayProspects, ...bdayCustomers].filter((x: any) => isToday(x.date_of_birth) && x.full_name);
      const bdayAgents = [...userMap.values()].filter((u: any) => isActiveUser(u) && levelOf(u) <= 12 && isToday(u.date_of_birth) && u.full_name);

      const names = await contactNames(allTodayActs);

      // Today's Daily Wisdom — same for everyone; tap opens the full popup.
      let wisdom: { head: string; quote: string } | null = null;
      try { wisdom = await dailyWisdom(todayMYT); } catch (e: any) { stats.errors.push(`daily_wisdom: ${e?.message || e}`); }

      // Admin digest (L1–L2): yesterday's company-wide totals, one line.
      const ydayMYT = mytDateOf(nowMs - 86_400_000);
      const ydayStart = new Date(`${ydayMYT}T00:00:00+08:00`).toISOString();
      const todayStart = new Date(`${todayMYT}T00:00:00+08:00`).toISOString();
      let adminLine: string | null = null;
      if (recipients.some((id) => levelOf(userMap.get(id)) <= 2)) {
        try {
          const [made, changed, cancelled] = await Promise.all([
            pgSelectAll("activities", `select=id,activity_type&created_at=gte.${ydayStart}&created_at=lt.${todayStart}`),
            pgSelectAll("notification_outbox", `select=id,activity_id&kind=eq.activity_changed&status=in.(sent,no_device,muted)&created_at=gte.${ydayStart}&created_at=lt.${todayStart}`),
            pgSelectAll("notification_outbox", `select=id,meta&kind=eq.activity_cancelled&created_at=gte.${ydayStart}&created_at=lt.${todayStart}`),
          ]);
          const byType = new Map<string, number>();
          for (const a of made) byType.set(typeLabel(a.activity_type), (byType.get(typeLabel(a.activity_type)) || 0) + 1);
          const top = [...byType.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([t, n]) => `${n} ${t}`).join(", ");
          const nChanged = new Set(changed.map((c: any) => c.activity_id)).size;
          const nCancelled = new Set(cancelled.map((c: any) => c.meta?.subject)).size;
          adminLine = `  ${made.length} new${top ? ` (${top})` : ""} · ${nChanged} changed · ${nCancelled} cancelled`;
        } catch (e: any) {
          stats.errors.push(`admin_digest: ${e?.message || e}`);
        }
      }

      for (const userId of recipients) {
        const me = userMap.get(userId);
        const myActs = allTodayActs.filter((a: any) => attendeeIds(a).includes(userId));
        const myBirthdays = [
          ...bdayContacts.filter((x: any) => Number(x.responsible_agent_id) === userId).map((x: any) => x.full_name),
          ...bdayAgents
            .filter((u: any) => Number(u.id) !== userId && isRealTeam(me?.team) && String(u.team ?? "") === String(me?.team ?? ""))
            .map((u: any) => `${u.full_name} (Agent)`),
        ];

        const myAdminLine = levelOf(me) <= 2 ? adminLine : null;
        if (myActs.length === 0 && dedupedEvents.length === 0 && myBirthdays.length === 0 && !myAdminLine && !wisdom) continue;

        const bodyLines: string[] = [];
        // Wisdom first so it shows in the collapsed notification; the rest follows.
        if (wisdom) {
          bodyLines.push(wisdom.head);
          if (wisdom.quote) bodyLines.push(wisdom.quote);
        }
        if (myActs.length > 0) {
          const sortedActs = myActs.sort((a: any, b: any) => (a.start_time || "").localeCompare(b.start_time || ""));
          for (const a of sortedActs.slice(0, 4)) {
            const head = [fmtShortTime(a.start_time) || "Anytime", whatOf(a)].join(" ");
            bodyLines.push(peopleLine(head, customerOf(a, contactOf(a, names))));
          }
          if (myActs.length > 4) bodyLines.push(`+${myActs.length - 4} more`);
        }
        if (dedupedEvents.length > 0) {
          for (const e of dedupedEvents.slice(0, 3)) {
            const title = eventTitles.get(Number(e.event_id)) || e.activity_title || "Event";
            bodyLines.push([fmtShortTime(e.start_time), title].filter(Boolean).join(" "));
          }
          if (dedupedEvents.length > 3) bodyLines.push(`+${dedupedEvents.length - 3} more events`);
        }
        if (myAdminLine) {
          bodyLines.push(`📊 Yesterday: ${myAdminLine.trim()}`);
        }
        if (myBirthdays.length > 0) {
          bodyLines.push(`🎂 ${myBirthdays.slice(0, 4).join(", ")}${myBirthdays.length > 4 ? ` +${myBirthdays.length - 4} more` : ""}`);
        }

        // Birthdays lead the title — a long title is cut off on the lock screen.
        const titleParts: string[] = [];
        if (myBirthdays.length > 0) titleParts.push(`${myBirthdays.length} birthday${myBirthdays.length > 1 ? "s" : ""}`);
        if (myActs.length > 0) titleParts.push(`${myActs.length} activit${myActs.length > 1 ? "ies" : "y"}`);
        if (dedupedEvents.length > 0) titleParts.push(`${dedupedEvents.length} event${dedupedEvents.length > 1 ? "s" : ""}`);

        const row = {
          user_id: userId, kind: "daily_summary", priority: "normal",
          title: titleParts.length ? `Today: ${titleParts.join(", ")}` : (myAdminLine ? "Yesterday's numbers" : "每天一智 · Daily Wisdom"),
          body: bodyLines.join("\n").slice(0, 1000),
          // ?wisdom=1 → the app opens the Daily Wisdom popup (build_daily_notes.py).
          url: "./index.html?wisdom=1",
          activity_id: null, meta: null,
          // One summary per user per day, however many runs match the window.
          dedupe_key: `daily:${todayMYT}`, status: "pending",
        };
        if (dryRun) { stats.preview.push({ kind: "daily_summary", userId, payload: row }); continue; }
        queue.push(row);
      }
    } catch (e: any) {
      stats.errors.push(`daily_summary: ${e?.message || e}`);
    }
  }

  // Every row carries the same keys (PostgREST bulk insert uses the first
  // row's columns). Queue (duplicates silently skipped), then deliver everything due — the new
  // rows plus any earlier row still pending/failed (retry, max 3 attempts).
  if (!dryRun) {
    try {
      if (queue.length) {
        const inserted = await queueRows(queue);
        stats.reminders_queued = inserted.filter((r) => r.kind === "activity_reminder" && r.status === "pending").length;
        stats.daily_queued = inserted.filter((r) => r.kind === "daily_summary").length;
      }
      stats.dispatch = await dispatchDue();
    } catch (e: any) {
      stats.errors.push(`queue/dispatch: ${e?.message || e}`);
    }
  }

  if (stats.errors.length) console.error("[reminders] errors:", stats.errors);
  const { preview, ...rest } = stats;
  return new Response(JSON.stringify({ ok: true, ...rest, ...(dryRun ? { preview } : {}) }), {
    status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
