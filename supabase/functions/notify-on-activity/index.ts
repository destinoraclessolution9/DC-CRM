// supabase/functions/notify-on-activity/index.ts
// DB webhook receiver — fires on INSERT into activities via pg_net trigger.
// Notifies: lead agent + co-agents + everyone in the lead agent's reporting chain.
// Does NOT notify all admins org-wide — only the relevant upward hierarchy.

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") || "";
// @ts-ignore
const SERVICE_ROLE: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

// Walk the reporting_to chain upward from startUserId.
// Returns IDs of all managers in the chain (not including startUserId itself).
// Caps at 10 hops to avoid infinite loops from bad data.
async function getReportingChain(
  startUserId: string,
  userMap: Map<string, { id: string; reporting_to: string | null }>,
): Promise<string[]> {
  const chain: string[] = [];
  let current = userMap.get(startUserId);
  let hops = 0;
  while (current && current.reporting_to != null && hops < 10) {
    const managerId = String(current.reporting_to);
    if (chain.includes(managerId)) break; // cycle guard
    chain.push(managerId);
    current = userMap.get(managerId);
    hops++;
  }
  return chain;
}

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
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
    if (!record || !record.id) {
      return new Response(JSON.stringify({ ok: false, reason: "no_record" }), {
        status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Fetch all users once — needed for reporting chain traversal and name lookup.
    let allUsers: any[] = [];
    try {
      allUsers = await pgSelect("users", { select: "id,full_name,name,email,role,reporting_to" });
    } catch (e) {
      console.warn("notify-on-activity: users fetch failed:", e);
    }

    // Build a map for O(1) lookups.
    const userMap = new Map<string, any>();
    allUsers.forEach((u: any) => {
      if (u.id != null) userMap.set(String(u.id), u);
    });

    const targets = new Set<string>();

    // 1. Lead agent
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

    // 3. Reporting chain upward from the lead agent only.
    // e.g. Agent → Team Leader → Manager → Super Admin
    // Other teams' managers are NOT included.
    if (record.lead_agent_id != null) {
      try {
        const chain = await getReportingChain(String(record.lead_agent_id), userMap);
        chain.forEach(id => targets.add(id));
      } catch (e) {
        console.warn("notify-on-activity: reporting chain failed:", e);
      }
    }

    if (targets.size === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: "no_targets" }), {
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
        targetUserIds: Array.from(targets),
        title: `New ${typeLabel} scheduled`,
        body: `${agentName}: ${titleLabel}${dateLabel ? ` (${dateLabel})` : ""}`,
        url: "./index.html#calendar",
      }),
    });

    const data = await pushRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ ok: pushRes.ok, ...data }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("notify-on-activity error:", e);
    return new Response(JSON.stringify({ error: "internal", detail: String(e?.message ?? e) }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
