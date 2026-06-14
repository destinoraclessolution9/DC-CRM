/**
 * Phase 2 (#11) — Customers BFF endpoint (Vercel Serverless Function, web-standard
 * Request→Response handler on Node/Fluid Compute).
 *
 * Flow: browser → GET /api/customers → (1) verify the caller's Supabase JWT →
 * (2) compute the visible agent-id scope SERVER-SIDE (bff_visible_agent_ids RPC)
 * → (3) run the scoped + searched + keyset-paginated query with the SECRET key
 * (bypasses RLS) → { rows, nextCursor }. RLS stays as defense-in-depth.
 *
 * Env (Vercel → Settings → Environment Variables; server-only, NEVER committed):
 *   SUPABASE_SECRET_KEY        REQUIRED — the sb_secret_… key. Without it → 503.
 *   SUPABASE_URL               optional — defaults to the project URL below.
 *   SUPABASE_PUBLISHABLE_KEY   optional — the PUBLIC sb_publishable_… key (used
 *                              only as the apikey when verifying the user JWT).
 *
 * The URL + publishable key are public (already shipped in the browser bundle),
 * so they are safe defaults here. The SECRET key is the only true secret and is
 * read exclusively from the environment.
 *
 * @param {Request} req
 * @returns {Promise<Response>}
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://remuwhxvzkzjtgbzqjaa.supabase.co';
const PUBLISHABLE  = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_XVWyiw5j1lnEErQUTV4XWg_lQcCIAjX';
const SECRET       = process.env.SUPABASE_SECRET_KEY || '';

// Lean listing columns (verified against the live schema 2026-06-14).
const LIST_COLUMNS = 'id,full_name,nickname,phone,email,ming_gua,responsible_agent_id,lifetime_value,customer_since';

export default async function handler(req) {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  if (!SECRET) return json({ error: 'not_configured', detail: 'SUPABASE_SECRET_KEY env var is not set on this deployment' }, 503);

  const url = new URL(req.url);
  const limit  = clampInt(url.searchParams.get('limit'), 50, 1, 100);
  const cursor = clampInt(url.searchParams.get('cursor'), 0, 0, Number.MAX_SAFE_INTEGER);
  const q   = (url.searchParams.get('q')   || '').trim().slice(0, 80);
  const gua = (url.searchParams.get('gua') || '').trim().slice(0, 40);

  // (1) Authn — verify the caller's Supabase access token.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthenticated' }, 401);
  let authId;
  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
    });
    if (!authRes.ok) return json({ error: 'unauthenticated' }, 401);
    const authUser = await authRes.json();
    authId = authUser && authUser.id;
  } catch {
    return json({ error: 'auth_unreachable' }, 502);
  }
  if (!authId) return json({ error: 'unauthenticated' }, 401);

  // (2) Authz — server-side visibility scope (null = all, [] = none, [ids] = scoped).
  let visible;
  try {
    const scopeRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/bff_visible_agent_ids`, {
      method: 'POST',
      headers: svc({ 'content-type': 'application/json' }),
      body: JSON.stringify({ p_auth_id: authId }),
    });
    if (!scopeRes.ok) return json({ error: 'scope_failed', status: scopeRes.status }, 500);
    visible = await scopeRes.json();
  } catch {
    return json({ error: 'scope_unreachable' }, 502);
  }
  if (Array.isArray(visible) && visible.length === 0) {
    return json({ rows: [], nextCursor: null }); // caller sees nothing
  }

  // (3) Service-role query — scoped + searched + keyset-paginated (id asc).
  const params = new URLSearchParams();
  params.set('select', LIST_COLUMNS);
  params.set('order', 'id.asc');
  params.set('limit', String(limit + 1)); // fetch one extra to detect a next page
  if (cursor > 0) params.append('id', `gt.${cursor}`);
  if (Array.isArray(visible)) params.append('responsible_agent_id', `in.(${visible.join(',')})`);
  if (gua) params.append('ming_gua', `eq.${gua}`);
  if (q) {
    const safe = q.replace(/[(),*]/g, ' ').trim();
    if (safe) params.append('or', `(full_name.ilike.*${safe}*,nickname.ilike.*${safe}*,phone.ilike.*${safe}*,email.ilike.*${safe}*)`);
  }

  let rows;
  try {
    const dataRes = await fetch(`${SUPABASE_URL}/rest/v1/customers?${params.toString()}`, { headers: svc() });
    if (!dataRes.ok) return json({ error: 'query_failed', status: dataRes.status }, 502);
    rows = await dataRes.json();
  } catch {
    return json({ error: 'query_unreachable' }, 502);
  }

  let nextCursor = null;
  if (Array.isArray(rows) && rows.length > limit) {
    rows = rows.slice(0, limit);
    nextCursor = rows[rows.length - 1].id;
  }
  return json({ rows: Array.isArray(rows) ? rows : [], nextCursor });
}

// ── helpers ──────────────────────────────────────────────────────────────────
function svc(extra = {}) {
  return { apikey: SECRET, Authorization: `Bearer ${SECRET}`, ...extra };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
function clampInt(v, dflt, min, max) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
