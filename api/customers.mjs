/**
 * Phase 2 (#11) — Customers BFF endpoint (Vercel Node Serverless Function /
 * Fluid Compute). Uses the canonical Vercel Node `(req, res)` signature for
 * broad runtime compatibility.
 *
 * Flow: browser → GET /api/customers → (1) verify the caller's Supabase JWT →
 * (2) compute the visible agent-id scope SERVER-SIDE (bff_visible_agent_ids RPC)
 * → (3) run the scoped + searched + offset-paginated query with the SECRET key
 * (bypasses RLS) → { rows, count }. RLS stays as defense-in-depth.
 *
 * Env (Vercel → Settings → Environment Variables; server-only, NEVER committed):
 *   SUPABASE_SECRET_KEY        REQUIRED — the sb_secret_… key. Without it → 503.
 *   SUPABASE_URL               optional — defaults to the project URL below.
 *   SUPABASE_PUBLISHABLE_KEY   optional — the PUBLIC sb_publishable_… key (used
 *                              only as the apikey when verifying the user JWT).
 *
 * The URL + publishable key are public (already shipped in the browser bundle),
 * so they are safe defaults. The SECRET key is the only true secret and is read
 * exclusively from the environment.
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://remuwhxvzkzjtgbzqjaa.supabase.co';
const PUBLISHABLE  = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_XVWyiw5j1lnEErQUTV4XWg_lQcCIAjX';
const SECRET       = process.env.SUPABASE_SECRET_KEY || '';

// Lean listing columns (verified against the live schema 2026-06-14).
const LIST_COLUMNS = 'id,full_name,nickname,phone,email,ming_gua,responsible_agent_id,lifetime_value,customer_since';

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };

  if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
  if (!SECRET) return send(503, { error: 'not_configured', detail: 'SUPABASE_SECRET_KEY env var is not set on this deployment' });

  const Q = req.query || {};
  const limit  = clampInt(Q.limit, 50, 1, 100);
  const offset = clampInt(Q.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const q    = String(Q.q    || '').trim().slice(0, 80);
  const gua  = String(Q.gua  || '').trim().slice(0, 40);
  const type = String(Q.type || '').trim().slice(0, 30);

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
  if (Array.isArray(visible) && visible.length === 0) return send(200, { rows: [], nextCursor: null });

  // (3) Service-role query — scoped + searched + offset-paginated (full_name asc,
  //     matching the customers list). count=planned gives a cheap total for the
  //     page-number UI (returned in the Content-Range header).
  const params = new URLSearchParams();
  params.set('select', LIST_COLUMNS);
  params.set('order', 'full_name.asc');
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (Array.isArray(visible)) params.append('responsible_agent_id', `in.(${visible.join(',')})`);
  if (gua) params.append('ming_gua', `eq.${gua}`);
  if (type === 'VIP') params.append('lifetime_value', 'gte.5000');
  if (q) {
    const safe = q.replace(/[(),*]/g, ' ').trim();
    if (safe) params.append('or', `(full_name.ilike.*${safe}*,nickname.ilike.*${safe}*,phone.ilike.*${safe}*,email.ilike.*${safe}*)`);
  }

  let rows, count = 0;
  try {
    const dataRes = await fetch(`${SUPABASE_URL}/rest/v1/customers?${params.toString()}`, {
      headers: svc({ Prefer: 'count=planned' }),
    });
    if (!dataRes.ok) return send(502, { error: 'query_failed', status: dataRes.status });
    rows = await dataRes.json();
    // Content-Range: "0-49/1234"  (the part after '/' is the planned total)
    const cr = dataRes.headers.get('content-range') || '';
    const total = cr.split('/')[1];
    count = (total && total !== '*') ? (parseInt(total, 10) || 0) : (Array.isArray(rows) ? rows.length : 0);
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
