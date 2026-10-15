// supabase/functions/notify-on-activity/index.ts
// DB webhook receiver — fires on INSERT into activities via pg_net trigger
// (on_activity_insert → trigger_notify_activity_push). SINGLE source of truth
// for "new activity" push audiences: it fires for EVERY insert path (desktop
// save, mobile quick-add, AI, gcal import, order-form OCR, past records), so
// the old client-side org-wide broadcast in script-activities.js was removed
// (2026-07-17) — it pinged every L1–L5 leader across ALL teams for ordinary
// CPS/CALL/FTF saves, leaking cross-team activity (and prospect names).
//
// Audience matrix (owner = lead_agent_id; team = users.team text label,
// normalized; leader band = Level 3–5):
//   visibility open/public          → everyone L1–L12 (staff band, org-wide)
//   visibility team                 → owner + co-agents + same-team L1–L12
//   closed/private EVENT-type       → owner + co-agents + upward reporting
//                                     chain (L3–L12 — admins not pinged)
//   closed/private ordinary (CPS/…) → owner + co-agents + SAME-TEAM leaders
//                                     (L3–L5) ONLY. No other teams. L1–L2
//                                     admins deliberately excluded — they can
//                                     already see everything in-app.
// The owner IS notified (spec: "the own user and the same team leader can
// see"). Activities dated >14 days in the past send nothing (bulk historical
// entry must not spam leaders).
//
// Extra payload flag: { dry_run: true } computes and returns the target list
// WITHOUT sending any push — for diagnostics/verification.

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") || "";
// @ts-ignore
const SERVICE_ROLE: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function callerRole(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const t = h.replace(/^Bearer\s+/i, "");
  if (!t) return null;
  // Exact match on this project's service key first: it is not guaranteed to be
  // a JWT carrying role=service_role (new-format sb_secret_ keys are opaque).
  if (SERVICE_ROLE && t === SERVICE_ROLE) return "service_role";
  // JWT payloads are base64URL without padding; plain atob() throws on '-'/'_'.
  try {
    let p = (t.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    while (p.length % 4) p += "=";
    return (JSON.parse(atob(p)).role) || null;
  } catch { return null; }
}

// ---------- Message formatting: "Today 3:00 PM · CPS · Menara Bangkok Bank" ----------
// Same helpers as send-activity-reminders (keep the wording identical).
function mytDateOf(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}
function fmtTime12(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return `${h % 12 || 12}:${String(Number.isFinite(m) ? m : 0).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function dayLabel(dateStr: string, nowMs: number): string {
  if (!dateStr) return "";
  if (dateStr === mytDateOf(nowMs)) return "Today";
  if (dateStr === mytDateOf(nowMs + 86_400_000)) return "Tomorrow";
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
function typeLabel(t: unknown): string {
  const s = String(t || "Activity");
  if (/^[A-Z]{2,4}$/.test(s)) return s; // CPS, FTF, CALL
  return s.toLowerCase().split(/[_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

async function pgSelect(table: string, params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: {
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`pg_select ${table} ${res.status}: ${await res.text()}`);
  return await res.json();
}

// Mirror of script.js _getUserLevel — parse "Level N" (word boundary), then
// legacy named roles, then Chinese-only role names. 99 = no level (never in
// any notification band). Keep the two in sync.
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

// Mirror of same_team_chain() (own_team_visibility_2026-06-28.sql): a label
// counts as a real team when non-blank and not 'Unassigned' (guard is
// case/space-insensitive), but the equality itself is EXACT (raw `ta = tb` in
// SQL) — keep both layers identical so the push audience never exceeds what
// the RLS 'team' tier lets the recipient read.
function isRealTeam(t: unknown): boolean {
  const s = String(t ?? "").trim().toLowerCase();
  return s !== "" && s !== "unassigned";
}
function sameTeam(a: unknown, b: unknown): boolean {
  return isRealTeam(a) && isRealTeam(b) && String(a ?? "") === String(b ?? "");
}

// Calendar "events" are activities of these types; everything else (CPS,
// CALL, FTF, …) is an ordinary personal activity.
const EVENT_TYPES = new Set(["EVENT", "AGENT_MEETING", "AGENT_TRAINING"]);

// ---------- Outbox writes (change / cancel alerts) ----------
async function pgWrite(method: string, path: string, body: unknown, prefer: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Prefer": prefer,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`pg_${method.toLowerCase()} ${path.split("?")[0]} ${res.status}: ${await res.text()}`);
  return prefer.includes("representation") ? await res.json() : null;
}

async function contactNameOf(r: any): Promise<string> {
  try {
    if (r?.prospect_id != null) {
      const x = await pgSelect("prospects", { select: "full_name", id: `eq.${r.prospect_id}` });
      return x?.[0]?.full_name || "";
    }
    if (r?.customer_id != null) {
      const x = await pgSelect("customers", { select: "full_name", id: `eq.${r.customer_id}` });
      return x?.[0]?.full_name || "";
    }
  } catch (_) { /* name is optional */ }
  return "";
}

const venueOf = (r: any) => String(r?.venue || r?.location_address || "").trim().slice(0, 80);
const whenWhereOf = (r: any) => [
  `${dayLabel(String(r?.activity_date || ""), Date.now())} ${fmtTime12(r?.start_time)}`.trim(),
  typeLabel(r?.activity_type),
  venueOf(r),
].filter(Boolean).join(" · ");

// The fields a change alert reports on. Times compared at minute precision.
const changeFields = (r: any) => ({
  date: r?.activity_date ? String(r.activity_date).slice(0, 10) : null,
  time: r?.start_time ? String(r.start_time).slice(0, 5) : null,
  venue: venueOf(r) || null,
  title: String(r?.activity_title || "").trim().slice(0, 80) || null,
});
type Fields = ReturnType<typeof changeFields>;
function diffLines(from: Fields, to: Fields): { lines: string[]; urgent: boolean } {
  const lines: string[] = [];
  const now = Date.now();
  if (from.date !== to.date) lines.push(`📅 Date: ${from.date ? dayLabel(from.date, now) : "—"} → ${to.date ? dayLabel(to.date, now) : "—"}`);
  if (from.time !== to.time) lines.push(`🕒 Time: ${fmtTime12(from.time) || "—"} → ${fmtTime12(to.time) || "—"}`);
  if (from.venue !== to.venue) lines.push(`📍 Venue: ${from.venue || "—"} → ${to.venue || "—"}`);
  const urgent = lines.length > 0; // date / time / place changes are urgent
  if (from.title !== to.title) lines.push(`📝 Title: ${from.title || "—"} → ${to.title || "—"}`);
  return { lines, urgent };
}

// ---------- Notification templates (owner-approved 2026-10-15) ----------
//   line 1: "Tomorrow 2pm CPS"  /  events: "Fri 16 Oct 10am 特训班"
//   line 2: "Agent | Customer"  (events: agent only)
// One small icon marks the kind (none = new, ⏰ ✏️ 🚫 🤝 ✅). No venue.
// Keep identical to send-activity-reminders + the client co-agent pushes.
function fmtShortTime(t: unknown): string {
  if (!t) return "";
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  const mm = Number.isFinite(m) && m > 0 ? `:${String(m).padStart(2, "0")}` : "";
  return `${h % 12 || 12}${mm}${h >= 12 ? "pm" : "am"}`;
}
const isEventRow = (r: any) => EVENT_TYPES.has(String(r?.activity_type ?? "").toUpperCase());
function headlineOf(r: any): string {
  const title = String(r?.activity_title || "").trim();
  const what = isEventRow(r) && title ? title : typeLabel(r?.activity_type);
  return [dayLabel(String(r?.activity_date || ""), Date.now()), fmtShortTime(r?.start_time), what]
    .filter(Boolean).join(" ").slice(0, 120);
}
// Customer shown on line 2: the prospect/customer, else a meaningful title.
// Events show no customer (the event name is already on line 1).
function customerOf(r: any, contact: string): string {
  if (isEventRow(r)) return "";
  if (contact) return contact;
  const title = String(r?.activity_title || "").trim();
  return title && title.toUpperCase() !== String(r?.activity_type || "").toUpperCase() ? title : "";
}
const peopleLine = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" | ").slice(0, 200);
const agentNameOf = (r: any, userMap: Map<string, any>) => {
  const u = r?.lead_agent_id != null ? userMap.get(String(r.lead_agent_id)) : null;
  return u ? (u.full_name || u.name || u.email || "") : "";
};
// "was 10am" / "was Thu" / "was Thu 10am" / "was Menara…" — the one thing that changed.
function wasPart(from: any, to: any): string {
  const now = Date.now();
  const d = from.date !== to.date, t = from.time !== to.time;
  if (d || t) {
    return "was " + [d && from.date ? dayLabel(from.date, now) : "", t ? (fmtShortTime(from.time) || "no time") : ""]
      .filter(Boolean).join(" ");
  }
  if (from.venue !== to.venue) return `was ${from.venue || "no venue"}`;
  if (from.title !== to.title) return `was ${from.title || "untitled"}`;
  return "";
}

// Hold an edit this long so a burst of edits becomes ONE alert with the net
// change (first "from" → latest "to"). The every-minute dispatcher sends it.
const CHANGE_HOLD_MS = 2 * 60_000;

async function dispatchIds(ids: number[]): Promise<any> {
  if (!ids.length) return { rows: 0 };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-activity-push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify({ dispatch: true, ids }),
  });
  return await res.json().catch(() => ({}));
}

// UPDATE (date/time/venue/title changed, or status → cancelled) and DELETE.
// Audience = the same people the "new activity" alert would reach, minus the
// person who made the change. Event attendee rows share one alert per event
// (subject ev:<event_id>), so deleting/moving an event with 30 attendee rows
// sends each person one alert, not thirty.
async function handleChange(
  op: string, record: any, oldRecord: any, targets: string[],
  userMap: Map<string, any>, editorId: string | null,
): Promise<any> {
  const isCancel = op === "DELETE" || String(record?.status || "").toLowerCase() === "cancelled";
  const isEvent = record?.event_id != null && EVENT_TYPES.has(String(record?.activity_type ?? "").toUpperCase());
  const subject = isEvent ? `ev:${record.event_id}` : `act:${record.id}`;
  const contact = await contactNameOf(record);
  const agent = agentNameOf(record, userMap);
  const customer = customerOf(record, contact);
  const nowIso = new Date().toISOString();
  const recipients = targets.map(Number).filter((n) => Number.isFinite(n));
  // Super Admins (L1) hear about every event being moved or cancelled,
  // company-wide — events affect many people. Ordinary CPS/FTF changes are
  // not pushed to them (they get yesterday's totals in the morning summary).
  if (isEvent) {
    for (const [id, u] of userMap) {
      const n = Number(id);
      if (levelOf(u) === 1 && u.status !== "deleted" && u.status !== "inactive" && id !== editorId && !recipients.includes(n)) recipients.push(n);
    }
  }

  if (isCancel) {
    // The cancel supersedes any edit alert still waiting for this subject.
    await pgWrite("PATCH",
      `notification_outbox?status=eq.pending&kind=eq.activity_changed&meta->>subject=eq.${encodeURIComponent(subject)}`,
      { status: "merged" }, "return=minimal");
    if (!recipients.length) return { ok: true, op, cancelled: 0, reason: "no_targets" };
    const was = op === "DELETE" ? record : (oldRecord || record);
    const rows = recipients.map((uid) => ({
      user_id: uid, kind: "activity_cancelled", priority: "urgent",
      title: `🚫 ${headlineOf(was)}`,
      body: peopleLine(agent, customer),
      url: "./index.html#calendar",
      // A deleted activity can't be opened any more — the tap goes to the calendar.
      activity_id: op === "DELETE" ? null : record.id,
      dedupe_key: `cancelled:${subject}`,
      status: "pending", due_at: nowIso, meta: { subject },
    }));
    const inserted = await pgWrite("POST",
      "notification_outbox?on_conflict=user_id,dedupe_key&select=id",
      rows, "resolution=ignore-duplicates,return=representation");
    const d = await dispatchIds((inserted || []).map((r: any) => r.id));
    return { ok: true, op, subject, cancelled: (inserted || []).length, dispatch: d };
  }

  // UPDATE → merge into a pending alert per recipient (or start one).
  if (!recipients.length) return { ok: true, op, changed: 0, reason: "no_targets" };
  const to = changeFields(record);
  const existing: any[] = await pgSelect("notification_outbox", {
    select: "id,user_id,meta",
    status: "eq.pending",
    kind: "eq.activity_changed",
    "meta->>subject": `eq.${subject}`,
    user_id: `in.(${recipients.join(",")})`,
  });
  const byUser = new Map<number, any>(existing.map((e) => [Number(e.user_id), e]));
  const dueIso = new Date(Date.now() + CHANGE_HOLD_MS).toISOString();
  const sig = [to.date, to.time, to.venue, to.title].join("|");
  const bucket = Math.floor(Date.now() / 600_000); // 10-min bucket: absorbs concurrent duplicate calls
  const inserts: any[] = [];
  let merged = 0, dropped = 0;
  for (const uid of recipients) {
    const prev = byUser.get(uid);
    const from: Fields = prev?.meta?.from ?? changeFields(oldRecord);
    const { lines, urgent } = diffLines(from, to);
    if (!lines.length) {
      // Edited back to how it was — nothing to announce.
      if (prev) { await pgWrite("PATCH", `notification_outbox?id=eq.${prev.id}&status=eq.pending`, { status: "merged" }, "return=minimal"); dropped++; }
      continue;
    }
    const row = {
      title: `✏️ ${headlineOf(record)}`,
      body: peopleLine(agent, customer, wasPart(from, to)),
      priority: urgent ? "urgent" : "normal",
      due_at: dueIso,
      meta: { subject, from },
    };
    if (prev) {
      await pgWrite("PATCH", `notification_outbox?id=eq.${prev.id}&status=eq.pending`, row, "return=minimal");
      merged++;
    } else {
      inserts.push({
        ...row, user_id: uid, kind: "activity_changed", url: "./index.html#calendar",
        activity_id: record.id, status: "pending",
        dedupe_key: `changed:${subject}:${bucket}:${sig}`.slice(0, 200),
      });
    }
  }
  let queued = 0;
  if (inserts.length) {
    const ins = await pgWrite("POST", "notification_outbox?on_conflict=user_id,dedupe_key&select=id",
      inserts, "resolution=ignore-duplicates,return=representation");
    queued = (ins || []).length;
  }
  return { ok: true, op, subject, queued, merged, dropped, due_at: dueIso };
}


// Walk the reporting_to chain upward from startUserId.
// Returns IDs of all managers in the chain (not including startUserId itself).
// Caps at 10 hops to avoid infinite loops from bad data.
function getReportingChain(
  startUserId: string,
  userMap: Map<string, { id: string; reporting_to: string | null }>,
): string[] {
  const chain: string[] = [];
  let current = userMap.get(startUserId);
  let hops = 0;
  while (current && current.reporting_to != null && hops < 10) {
    const managerId = String(current.reporting_to);
    if (chain.includes(managerId)) break; // cycle guard
    // Only add the manager if it resolves to a real user; a dangling/stale
    // reporting_to FK must not be forwarded as a push target. Stop the walk
    // there since we can't continue up a chain we can't resolve.
    const manager = userMap.get(managerId);
    if (!manager) break;
    chain.push(managerId);
    current = manager as any;
    hops++;
  }
  return chain;
}

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (callerRole(req) !== "service_role") {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = await req.json();

    // Accept both DB trigger format {type, record} and a raw activity object.
    // type: INSERT (on_activity_insert) | UPDATE / DELETE (on_activity_change /
    // on_activity_delete — phase 2 change & cancel alerts; DELETE carries only
    // old_record). editor_id = users.id of whoever made the change.
    const op = String(payload.type || "INSERT").toUpperCase();
    const oldRecord = payload.old_record ?? null;
    const editorId = payload.editor_id != null ? String(payload.editor_id) : null;
    const record = op === "DELETE" ? oldRecord : (payload.record ?? payload.activity ?? payload);
    const dryRun = payload.dry_run === true;
    if (!record || !record.id) {
      return new Response(JSON.stringify({ ok: false, reason: "no_record" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Bulk historical entry guard: activities dated well in the past are data
    // entry (e.g. importing last year's CPS records), not news — notify no one.
    // activity_date is a Postgres DATE ("YYYY-MM-DD"), which new Date() parses
    // as UTC midnight — Math.floor makes the age a whole-day count so the
    // exactly-14-days boundary doesn't flip with the org's (UTC+8) wall clock.
    // (UPDATE/DELETE: the trigger already skips past-dated rows.)
    if (op === "INSERT" && record.activity_date) {
      const d = new Date(String(record.activity_date));
      const ageDays = isNaN(d.getTime()) ? 0 : Math.floor((Date.now() - d.getTime()) / 86400000);
      if (ageDays > 14) {
        const skipBody = dryRun
          ? { ok: true, dryRun: true, audience: "historical_backfill", targets: [] }
          : { ok: true, sent: 0, reason: "historical_backfill" };
        return new Response(JSON.stringify(skipBody), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch all users once — needed for audience scoping, reporting chain
    // traversal, and name lookup. If this fetch fails, return 503 so the
    // caller sees a real failure instead of a false success.
    let allUsers: any[] = [];
    try {
      allUsers = await pgSelect("users", { select: "id,full_name,email,role,reporting_to,team,status" });
    } catch (e) {
      console.error("notify-on-activity: users fetch failed:", e);
      return new Response(JSON.stringify({ ok: false, reason: "users_fetch_failed", detail: String((e as any)?.message ?? e) }), {
        status: 503, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Build a map for O(1) lookups.
    const userMap = new Map<string, any>();
    allUsers.forEach((u: any) => {
      if (u.id != null) userMap.set(String(u.id), u);
    });
    const isActiveUser = (u: any) => u && u.status !== "deleted" && u.status !== "inactive";

    const targets = new Set<string>();

    // 1. Owner (lead agent) — always notified, including on-behalf assignees.
    if (record.lead_agent_id != null) targets.add(String(record.lead_agent_id));

    // 2. Co-agents — stored as JSONB [{id, name, co_role, status}]
    if (record.co_agents) {
      try {
        const coAgents = typeof record.co_agents === "string"
          ? JSON.parse(record.co_agents)
          : record.co_agents;
        if (Array.isArray(coAgents)) {
          coAgents.forEach((ca: any) => {
            if (ca?.id != null) targets.add(String(ca.id));
          });
        }
      } catch (_) {}
    }

    // 3. Visibility-scoped audience.
    const vis = String(record.visibility ?? "").toLowerCase();
    const owner = record.lead_agent_id != null ? userMap.get(String(record.lead_agent_id)) : null;
    const ownerHasTeam = isRealTeam(owner?.team);
    const chain = record.lead_agent_id != null
      ? getReportingChain(String(record.lead_agent_id), userMap)
      : [];
    const addChain = (minLvl: number, maxLvl: number) => {
      chain.forEach((id) => {
        const L = levelOf(userMap.get(id));
        if (L >= minLvl && L <= maxLvl) targets.add(id);
      });
    };
    let audience: string;
    if (vis === "open" || vis === "public") {
      // Open to all → the entire staff/agent band, every team.
      audience = "open_all_staff";
      allUsers.forEach((u) => {
        if (isActiveUser(u) && u.id != null && levelOf(u) <= 12) targets.add(String(u.id));
      });
    } else if (vis === "team") {
      if (ownerHasTeam) {
        audience = "own_team";
        allUsers.forEach((u) => {
          if (isActiveUser(u) && u.id != null && levelOf(u) <= 12 && sameTeam(u.team, owner?.team)) {
            targets.add(String(u.id));
          }
        });
      } else {
        // Owner has no team label → same_team_chain RLS matches nobody, so the
        // only readers are the upward reporting chain. Cap at L10: RLS
        // current_user_visible_ids() yields a downline only for L<=10 (L11+ see
        // self only), so an L11/L12 ancestor couldn't open the activity and
        // must not be pinged about it.
        audience = "team_fallback_chain";
        addChain(3, 10);
      }
    } else if (EVENT_TYPES.has(String(record.activity_type ?? "").toUpperCase())) {
      // Closed/private event → organizer's upward reporting chain. Cap at L10
      // (not L12): RLS only lets an ancestor read a closed activity via its
      // downline (current_user_visible_ids), which is self-only for L11+, so a
      // higher ancestor would be notified about something they can't open.
      // activity_type is upper-cased before the EVENT_TYPES test to match the
      // lower-cased visibility handling above (the column is free-text).
      audience = "closed_event_chain";
      addChain(3, 10);
    } else {
      // Ordinary activity (CPS/CALL/FTF/…): the owner's team leader(s) ONLY —
      // resolved via the upward reporting_to chain filtered to the leader band
      // (L3–5). We deliberately use the reporting chain, NOT the users.team
      // label: RLS on a closed activity (activities_scoped_select) grants read
      // to the owner's upward chain (current_user_visible_ids downline), NOT to
      // same-team peers. Scoping the push to chain leaders guarantees every
      // recipient can actually open the record — no "notified about a CPS you
      // can't see" — and still excludes other teams (a different team's leader
      // is never in this owner's chain) and L1–L2 admins (filtered out by the
      // L>=3 floor). In this org a member's team leader IS their chain leader,
      // so this matches the intended "own team leader sees it" exactly.
      audience = "ordinary_chain_leaders";
      addChain(3, 5);
    }

    // Drop any target that doesn't resolve to a real, active user — dangling
    // ids, deleted or deactivated accounts must never receive pushes.
    for (const id of targets) {
      if (!isActiveUser(userMap.get(id))) targets.delete(id);
    }
    // Never alert people about their own edit / delete.
    if (op !== "INSERT" && editorId) targets.delete(editorId);

    const targetList = Array.from(targets);
    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, dryRun: true, audience, targets: targetList }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (targetList.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no_targets", audience }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    if (op === "UPDATE" || op === "DELETE") {
      const res = await handleChange(op, record, oldRecord, targetList, userMap, editorId);
      return new Response(JSON.stringify({ audience, ...res }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Resolve lead agent name for the notification body.
    const leadUser = record.lead_agent_id != null
      ? userMap.get(String(record.lead_agent_id))
      : null;
    const agentName = leadUser
      ? (leadUser.full_name || leadUser.name || leadUser.email || "Someone")
      : "Someone";

    // Prospect / customer name for line 2 (best-effort).
    const contact = await contactNameOf(record);

    // Delegate push delivery to the existing send-activity-push function.
    const pushRes = await fetch(`${SUPABASE_URL}/functions/v1/send-activity-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        activity: record,
        targetUserIds: targetList,
        title: headlineOf(record),
        body: peopleLine(leadUser ? agentName : "", customerOf(record, contact)),
        url: "./index.html#calendar",
        // Outbox metadata: member-created activity → leader alert is High
        // priority; the dedupe key makes a re-fired trigger a no-op.
        kind: "activity_created",
        priority: "high",
        dedupe_key: `created:${record.id}`,
      }),
    });

    const data = await pushRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ ok: pushRes.ok, audience, ...data }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("notify-on-activity error:", e);
    return new Response(JSON.stringify({ error: "internal", detail: String(e?.message ?? e) }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
