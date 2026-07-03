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
const LIST_COLUMNS = 'id,full_name,nickname,phone,email,ming_gua,responsible_agent_id,lifetime_value,customer_since,converted_from_prospect_id';

// Best-effort per-IP rate limit (defense-in-depth; the real control is the
// Vercel WAF). INERT unless RATE_LIMIT_PER_MIN is set to a positive integer.
// In-memory + per-instance: with Fluid Compute each warm instance keeps its
// own window, so the effective global limit is (limit × live instances) — a
// backstop against a single-instance hammer, not a distributed-flood control.
const RL_MAX = Math.max(0, parseInt(process.env.RATE_LIMIT_PER_MIN || '0', 10) || 0);
const RL_WINDOW_MS = 60000;
const _rlHits = new Map(); // ip -> number[] (recent hit timestamps)

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  // Observability only — single-line JSON log per terminal return (Vercel Log
  // Drain ingest/alerting). Wraps send() so it logs once, centrally, classifying
  // level by status; the returned value is byte-identical to before.
  const _t0 = Date.now();
  const _reqId = String((req.headers && req.headers['x-vercel-id']) || '') || undefined;
  const send = (status, body) => {
    const level = status >= 500 ? 'error' : (status >= 400 ? 'warn' : 'info');
    const event = (body && body.error) || 'ok';
    logEvent(level, event, {
      status,
      ms: Date.now() - _t0,
      ...(_reqId ? { reqId: _reqId } : {}),
      ...(body && typeof body.status === 'number' ? { upstream: body.status } : {}),
      ...(body && Array.isArray(body.rows) ? { rows: body.rows.length } : {}),
      ...(body && typeof body.count === 'number' ? { count: body.count } : {}),
    });
    res.statusCode = status; res.end(JSON.stringify(body));
  };

  if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
  if (rateLimited(req)) return send(429, { error: 'rate_limited' });
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
    const authRes = await fetchT(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
    });
    if (!authRes.ok) {
      // 401/403 = the token itself is genuinely rejected (expired / bad sig) →
      // a real auth failure. ANY other status (5xx, 408, 429, 521 from an
      // overloaded/down GoTrue) is an UPSTREAM OUTAGE, not the caller's fault —
      // report it as retryable 503 so the client shows "service unavailable /
      // retrying" and keeps cached data, instead of a misleading 401 dead-end.
      if (authRes.status === 401 || authRes.status === 403) return send(401, { error: 'unauthenticated' });
      return send(503, { error: 'auth_unavailable', status: authRes.status });
    }
    const authUser = await authRes.json();
    authId = authUser && authUser.id;
  } catch (e) {
    // Network failure or our own abort timeout — Auth is unreachable, not a bad
    // token. Retryable, so the client falls back to cache and tries again.
    return send(503, { error: 'auth_unavailable', detail: e && e.name === 'AbortError' ? 'timeout' : 'unreachable' });
  }
  if (!authId) return send(401, { error: 'unauthenticated' });

  // (2) Authz — server-side visibility scope (null = all, [] = none, [ids] = scoped).
  let visible;
  try {
    const scopeRes = await fetchT(`${SUPABASE_URL}/rest/v1/rpc/bff_visible_agent_ids`, {
      method: 'POST',
      headers: svc({ 'content-type': 'application/json' }),
      body: JSON.stringify({ p_auth_id: authId }),
    });
    if (!scopeRes.ok) return send(503, { error: 'scope_unavailable', status: scopeRes.status });
    visible = await scopeRes.json();
  } catch {
    return send(503, { error: 'scope_unavailable' });
  }
  // bff_visible_agent_ids returns [] ONLY for an unresolved caller (auth uid not
  // mapped to a users row) — every real user gets null / [self] / a non-empty
  // downline. During a token-refresh / SW-activation race the uid can transiently
  // not resolve; returning an empty 200 here would cache "0 customers" (the
  // cold-boot blank-list bug). Treat [] as retryable so the client retries /
  // falls back to the legacy scoped read instead of showing an empty list.
  if (Array.isArray(visible) && visible.length === 0) return send(409, { error: 'caller_unresolved' });

  // (3) Service-role query — scoped + searched + offset-paginated (full_name asc,
  //     matching the customers list). count=exact gives the ACTUAL matching total
  //     (returned in the Content-Range header) so the page-number UI shows the
  //     right number of pages — count=planned is only a planner estimate that can
  //     diverge on filtered queries / un-ANALYZEd tables, leaving empty/unreachable
  //     last pages. One extra count scan is acceptable for this bounded list.
  const params = new URLSearchParams();
  params.set('select', LIST_COLUMNS);
  params.set('order', 'full_name.asc');
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (Array.isArray(visible)) params.append('responsible_agent_id', `in.(${visible.join(',')})`);
  if (gua) params.append('ming_gua', `eq.${gua}`);
  if (type === 'VIP') params.append('lifetime_value', 'gte.5000');
  if (q) {
    // Strip PostgREST grammar chars `( ) , *` (filter-injection guard), THEN escape
    // SQL LIKE metacharacters `%` and `_` so a literal search for "100%" or "a_b"
    // matches literally instead of being treated as ilike wildcards (% = any run,
    // _ = any single char). PostgREST ilike honors backslash escaping.
    const safe = q.replace(/[(),*]/g, ' ').replace(/[%_]/g, (m) => '\\' + m).trim();
    if (safe) params.append('or', `(full_name.ilike.*${safe}*,nickname.ilike.*${safe}*,phone.ilike.*${safe}*,email.ilike.*${safe}*)`);
  }

  let rows, count = 0;
  try {
    const dataRes = await fetchT(`${SUPABASE_URL}/rest/v1/customers?${params.toString()}`, {
      headers: svc({ Prefer: 'count=exact' }),
    });
    if (!dataRes.ok) return send(503, { error: 'query_unavailable', status: dataRes.status });
    rows = await dataRes.json();
    // Content-Range: "0-49/1234"  (the part after '/' is the exact total)
    const cr = dataRes.headers.get('content-range') || '';
    const total = cr.split('/')[1];
    count = (total && total !== '*') ? (parseInt(total, 10) || 0) : (Array.isArray(rows) ? rows.length : 0);
  } catch {
    return send(503, { error: 'query_unavailable' });
  }

  return send(200, { rows: Array.isArray(rows) ? rows : [], count });
}

// ── helpers ──────────────────────────────────────────────────────────────────
// fetch with an abort timeout (default 8s) so a hung/overloaded Supabase upstream
// fails fast instead of blocking the function up to the platform timeout. During
// the 2026-06-16 compute outage these endpoints hung 20–25s; an 8s ceiling turns
// that into a clean retryable 503 while staying well above a healthy <200ms call.
async function fetchT(url, opts = {}, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}
function svc(extra = {}) {
  return { apikey: SECRET, Authorization: `Bearer ${SECRET}`, ...extra };
}
function clampInt(v, dflt, min, max) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
// Returns true if this request should be rejected (429). Fail-open: any error → false (allow).
function rateLimited(req) {
  try {
    if (RL_MAX <= 0) return false; // disabled
    const xff = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '');
    const ip = (xff.split(',')[0] || '').trim();
    // No forwarded IP (internal call, misconfigured proxy, or a runtime that
    // doesn't inject XFF) → fail-open and skip limiting for THIS request rather
    // than collapsing all such traffic into one shared 'unknown' counter that
    // would throttle unrelated callers together. Limiter stays best-effort.
    if (!ip) return false;
    const now = Date.now();
    const arr = (_rlHits.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
    arr.push(now);
    _rlHits.set(ip, arr);
    // Opportunistic cleanup so the Map can't grow unbounded on a long-lived instance.
    if (_rlHits.size > 5000) { for (const [k, v] of _rlHits) { if (!v.length || now - v[v.length-1] > RL_WINDOW_MS) _rlHits.delete(k); } }
    return arr.length > RL_MAX;
  } catch { return false; }
}
// Structured single-line JSON log for a Vercel Log Drain to ingest + alert on.
// Pure observability — never throws into the request path (best-effort, swallowed).
function logEvent(level, event, fields) {
  try {
    const rec = { t: new Date().toISOString(), lvl: level, ev: event, fn: 'customers', ...fields };
    (level === 'error' ? console.error : console.log)(JSON.stringify(rec));
  } catch {}
}
