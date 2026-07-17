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
  try { return (JSON.parse(atob(t.split(".")[1] || "")).role) || null; } catch { return null; }
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
    const record = payload.record ?? payload.activity ?? payload;
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
    if (record.activity_date) {
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
        // Owner has no team label — fall back to their upward chain.
        audience = "team_fallback_chain";
        addChain(3, 12);
      }
    } else if (EVENT_TYPES.has(String(record.activity_type ?? ""))) {
      // Closed/private event → organizer's upward hierarchy (no L1–L2 ping).
      audience = "closed_event_chain";
      addChain(3, 12);
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

    // Resolve lead agent name for the notification body.
    const leadUser = record.lead_agent_id != null
      ? userMap.get(String(record.lead_agent_id))
      : null;
    const agentName = leadUser
      ? (leadUser.full_name || leadUser.name || leadUser.email || "Someone")
      : "Someone";

    const typeLabel = record.activity_type || "Activity";
    const titleLabel = record.activity_title || record.title || "";
    const dateLabel = record.activity_date || "";

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
        title: `New ${typeLabel} scheduled`,
        body: `${agentName}: ${titleLabel}${dateLabel ? ` (${dateLabel})` : ""}`,
        url: "./index.html#calendar",
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
