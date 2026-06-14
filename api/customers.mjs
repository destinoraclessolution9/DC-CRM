/**
 * Phase 2 (#11) — BFF endpoint SCAFFOLD (ready-to-wire, not yet used by the UI).
 *
 * A Vercel Serverless Function (Fluid Compute). The browser calls this instead
 * of hitting PostgREST directly, so visibility scoping + validation + the
 * service role live SERVER-SIDE and RLS becomes defense-in-depth, not the only
 * guard. The client adapter (lib/api-client — Phase 2) will call:
 *
 *   GET /api/customers?cursor=&limit=50&q=&type=&gua=
 *
 * Required env (Vercel project settings — NOT committed):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (server-only; never shipped to client)
 *
 * @param {Request} req
 * @returns {Promise<Response>}
 */
export default async function handler(req) {
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const url = new URL(req.url);
  const limit = clampInt(url.searchParams.get('limit'), 50, 1, 100);
  const cursor = clampInt(url.searchParams.get('cursor'), 0, 0, 10_000_000);
  const q = (url.searchParams.get('q') || '').slice(0, 80);
  const type = url.searchParams.get('type') || '';
  const gua = url.searchParams.get('gua') || '';

  // 1) Authn: resolve the caller from the session JWT (Authorization: Bearer).
  const user = await resolveUser(req);
  if (!user) return json({ error: 'unauthenticated' }, 401);

  // 2) Authz scoping computed SERVER-SIDE (Phase 2/#6 — role_level + downline).
  const visibleAgentIds = await visibleAgentIdsFor(user);

  // 3) Query Postgres with the service role, scoped + paginated.
  const { rows, nextCursor } = await queryCustomers({ visibleAgentIds, q, type, gua, limit, cursor });
  return json({ rows, nextCursor });
}

// ── helpers (implementations land when the endpoint is wired) ────────────────
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function clampInt(v, dflt, min, max) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

/**
 * @param {Request} _req
 * @returns {Promise<{ id: string, role_level?: number } | null>}
 */
async function resolveUser(_req) {
  // TODO(P2): verify Supabase JWT from Authorization header; return { id, role_level } or null.
  throw new Error('not_wired: resolveUser — implement when /api is provisioned on Vercel');
}
/**
 * @param {{ id: string, role_level?: number }} _user
 * @returns {Promise<string[] | 'all'>}
 */
async function visibleAgentIdsFor(_user) {
  // TODO(P2/#6): role_level <= 2 → 'all'; else the user's id + downline (reporting_to closure).
  throw new Error('not_wired: visibleAgentIdsFor');
}
/**
 * @param {{ visibleAgentIds: string[] | 'all', q: string, type: string, gua: string, limit: number, cursor: number }} _args
 * @returns {Promise<{ rows: object[], nextCursor: number | null }>}
 */
async function queryCustomers(_args) {
  // TODO(P2): supabase-js with SERVICE_ROLE; cursor (keyset on id) + ilike(q) + scope.
  throw new Error('not_wired: queryCustomers');
}
