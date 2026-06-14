/**
 * Phase 4.3 (#11/#13) — Prospects BFF endpoint (Vercel Node Serverless Function).
 * Mirrors api/customers.mjs. The data foundation for the Prospects React island.
 *
 * Flow: browser → GET /api/prospects → (1) verify the caller's Supabase JWT →
 * (2) compute the visible agent-id scope SERVER-SIDE (bff_visible_agent_ids RPC,
 * same as customers) → (3) call the SECURITY DEFINER `prospects_page` RPC with
 * the SECRET key (bypasses RLS) passing that scope as p_visible_agent_ids →
 * { rows, count }. The RPC does dormancy curation + search + ming_gua/agent
 * filter + sort + offset pagination server-side in one round-trip. RLS stays as
 * defense-in-depth; the scope is enforced by the p_visible_agent_ids param
 * (exactly how the in-page client calls it via AppDataStore.prospectsPage).
 *
 * Env (Vercel → Settings → Environment Variables; server-only, NEVER committed):
 *   SUPABASE_SECRET_KEY        REQUIRED — the sb_secret_… key. Without it → 503.
 *   SUPABASE_URL               optional — defaults to the project URL below.
 *   SUPABASE_PUBLISHABLE_KEY   optional — the PUBLIC sb_publishable_… key (used
 *                              only as the apikey when verifying the user JWT).
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://remuwhxvzkzjtgbzqjaa.supabase.co';
const PUBLISHABLE  = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_XVWyiw5j1lnEErQUTV4XWg_lQcCIAjX';
const SECRET       = process.env.SUPABASE_SECRET_KEY || '';

// prospects_page accepts only these sort keys (real columns); anything else → score.
const SORT_KEYS = new Set(['score', 'full_name', 'last_activity_date']);

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };

  if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
  if (!SECRET) return send(503, { error: 'not_configured', detail: 'SUPABASE_SECRET_KEY env var is not set on this deployment' });

  const Q = req.query || {};
  const limit   = clampInt(Q.limit, 50, 1, 100);
  const offset  = clampInt(Q.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const q       = String(Q.q   || '').trim().slice(0, 80);
  const gua     = String(Q.gua || '').trim().slice(0, 40);
  const agentId = Number.isFinite(Number.parseInt(String(Q.agent ?? ''), 10)) ? Number.parseInt(String(Q.agent), 10) : null;
  const dormant = Q.dormant === '1' || Q.dormant === 'true';
  const sort    = SORT_KEYS.has(String(Q.sort || '')) ? String(Q.sort) : 'score';
  const dir     = String(Q.dir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  // (1) Authn — verify the caller's Supabase access token.
  const token = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  if (!token) return send(401, { error: 'unauthenticated' });
  let authId;
  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
    });
    if (!authRes.ok) return send(401, { error: 'unauthenticated' });
    const authUser = await authRes.json();
    authId = authUser && authUser.id;
  } catch {
    return send(502, { error: 'auth_unreachable' });
  }
  if (!authId) return send(401, { error: 'unauthenticated' });

  // (2) Authz — server-side visibility scope (null = all, [] = none, [ids] = scoped).
  let visible;
  try {
    const scopeRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bff_visible_agent_ids`, {
      method: 'POST',
      headers: svc({ 'content-type': 'application/json' }),
      body: JSON.stringify({ p_auth_id: authId }),
    });
    if (!scopeRes.ok) return send(500, { error: 'scope_failed', status: scopeRes.status });
    visible = await scopeRes.json();
  } catch {
    return send(502, { error: 'scope_unreachable' });
  }
  if (Array.isArray(visible) && visible.length === 0) return send(200, { rows: [], count: 0 });

  // (3) Service-role RPC call — dormancy + scope + filter + sort + page in one
  //     round-trip. p_visible_agent_ids: null = unrestricted (admin/manager).
  let rows = [], count = 0;
  try {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/prospects_page`, {
      method: 'POST',
      headers: svc({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        p_visible_agent_ids: Array.isArray(visible) ? visible : null,
        p_search:          q || null,
        p_ming_gua:        gua || null,
        p_agent_id:        agentId,
        p_include_dormant: dormant || agentId != null, // agent filter → show full list
        p_dormant_days:    500,
        p_sort:            sort,
        p_sort_dir:        dir,
        p_limit:           limit,
        p_offset:          offset,
      }),
    });
    if (!rpcRes.ok) return send(502, { error: 'query_failed', status: rpcRes.status });
    const data = await rpcRes.json();
    // The RPC returns a single composite row { rows: jsonb[], total: bigint }.
    const row = Array.isArray(data) ? data[0] : data;
    rows  = (row && row.rows) || [];
    count = Number(row && row.total) || 0;
  } catch {
    return send(502, { error: 'query_unreachable' });
  }

  return send(200, { rows: Array.isArray(rows) ? rows : [], count });
}

// ── helpers ──────────────────────────────────────────────────────────────────
function svc(extra = {}) {
  return { apikey: SECRET, Authorization: `Bearer ${SECRET}`, ...extra };
}
function clampInt(v, dflt, min, max) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
