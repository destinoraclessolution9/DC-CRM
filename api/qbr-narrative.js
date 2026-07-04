/**
 * QBR Narrative — board-ready AI narrative for the Quarter Business Review tab.
 * Vercel Node Serverless Function. CommonJS (module.exports): this file is `.js`
 * and the repo root package.json has NO "type":"module", so Node treats it as
 * CommonJS. (The sibling api/*.mjs files are ESM by their .mjs extension; this
 * one is deliberately .js/CJS per its task spec.)
 *
 * WHY server-side: the ANTHROPIC_API_KEY must never reach the browser. The client
 * computes ALL KPI/analysis numbers itself and posts them here as `snapshot`; this
 * function only wraps them in board-appropriate prose. It NEVER computes figures.
 *
 * ── Environment variables ────────────────────────────────────────────────────
 *   ANTHROPIC_API_KEY      REQUIRED — Anthropic API key (sk-ant-…). If missing or
 *                          empty the function returns 200 { ok:false,
 *                          reason:'not_configured' } so the client cleanly
 *                          degrades to its own heuristic narrative. It is NEVER
 *                          echoed in any response or log line.
 *   QBR_NARRATIVE_MODEL    optional — model id override.
 *                          Defaults to 'claude-sonnet-5'.
 *
 * ── Request contract ─────────────────────────────────────────────────────────
 *   POST /api/qbr-narrative
 *   Content-Type: application/json
 *   Body: {
 *     quarter:  string,   // e.g. "2026 Q2"
 *     snapshot: object,   // KPI / analysis numbers ALREADY computed by the client
 *     context:  string    // free-text extra guidance for the model
 *   }
 *   Any non-POST method → 405 { ok:false, reason:'method' }.
 *
 * ── Response contract (ALWAYS HTTP 200 except the 405 method guard) ───────────
 *   Success:         { ok:true,  narrative: {
 *                        openingScript:    string,   // ~60s spoken board opening
 *                        executiveSummary: string,
 *                        rootCause: [ { problem, cause, impact, solution }, … ],
 *                        decisionSummary:  string     // one paragraph to approve
 *                      } }
 *   Not configured:  { ok:false, reason:'not_configured' }   (key absent)
 *   Upstream/parse:  { ok:false, reason:'error', detail:<short string> }
 * The client treats every ok:false as a signal to fall back to heuristic text,
 * so this handler must never surface a 5xx to the browser.
 */

// ── Auth + abuse-control config ──────────────────────────────────────────────
// This endpoint bills the company ANTHROPIC_API_KEY, so it must not be callable
// anonymously. We verify the caller's Supabase session token (same mechanism as
// api/customers.mjs) and apply a best-effort per-IP rate limit.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://remuwhxvzkzjtgbzqjaa.supabase.co';
const PUBLISHABLE  = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_XVWyiw5j1lnEErQUTV4XWg_lQcCIAjX';

// Per-IP rate limit (defense-in-depth; the real controls are the Vercel WAF + the
// auth check below). In-memory + per-instance: with Fluid Compute each warm
// instance keeps its own window, so the effective global cap is (limit × live
// instances) — a backstop against a single-instance hammer, not distributed-flood
// control. Default 20/min (generous for an admin generating a few quarters);
// override with QBR_RATE_LIMIT_PER_MIN (0 disables).
const RL_MAX = Math.max(0, parseInt(process.env.QBR_RATE_LIMIT_PER_MIN || '20', 10) || 0);
const RL_WINDOW_MS = 60000;
const _rlHits = new Map(); // ip -> number[] recent hit timestamps
function _clientIp(req) {
  const xff = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return xff || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function _rateLimited(req) {
  if (!RL_MAX) return false;
  const ip = _clientIp(req);
  const now = Date.now();
  const hits = (_rlHits.get(ip) || []).filter(t => now - t < RL_WINDOW_MS);
  hits.push(now);
  _rlHits.set(ip, hits);
  if (_rlHits.size > 5000) { // opportunistic cleanup so the map can't grow unbounded
    for (const [k, v] of _rlHits) { if (!v.length || now - v[v.length - 1] > RL_WINDOW_MS) _rlHits.delete(k); }
  }
  return hits.length > RL_MAX;
}

module.exports = async (req, res) => {
  try {
    // ── Method guard ─────────────────────────────────────────────────────────
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, reason: 'method' });
    }

    // ── Rate limit (LLM cost control) ────────────────────────────────────────
    if (_rateLimited(req)) {
      return res.status(429).json({ ok: false, reason: 'rate_limited' });
    }

    // ── Authn — require a valid Supabase session ─────────────────────────────
    // The QBR tab is admin-gated in the client; server-side we require ANY
    // authenticated CRM user, which is proportionate to the anonymous-abuse risk
    // (stops the open internet from billing our key). An auth failure returns
    // ok:false so the client degrades to its heuristic narrative exactly like the
    // not_configured path — no LLM call is made. (Optional future hardening:
    // also assert L1 admin via a users-table role lookup.)
    const _token = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
    if (!_token) {
      return res.status(200).json({ ok: false, reason: 'unauthenticated' });
    }
    try {
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${_token}` },
      });
      if (!authRes.ok) {
        // 401/403 = token genuinely rejected; anything else = a GoTrue outage
        // (retryable) — either way we don't spend an LLM call.
        const reason = (authRes.status === 401 || authRes.status === 403) ? 'unauthenticated' : 'auth_unavailable';
        return res.status(200).json({ ok: false, reason });
      }
      const authUser = await authRes.json();
      if (!authUser || !authUser.id) {
        return res.status(200).json({ ok: false, reason: 'unauthenticated' });
      }
    } catch (_) {
      // Auth unreachable — retryable; the client shows heuristic text meanwhile.
      return res.status(200).json({ ok: false, reason: 'auth_unavailable' });
    }

    // ── Defensive body parse ─────────────────────────────────────────────────
    // Vercel normally parses JSON into req.body, but handle raw-string bodies
    // (and anything unexpected) without throwing.
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    if (!body || typeof body !== 'object') body = {};

    const quarter  = (typeof body.quarter === 'string' ? body.quarter : '').slice(0, 40);
    // Sanitize the attacker-influenceable free-text context before it enters the LLM
    // prompt: collapse whitespace runs (newlines/tabs — the newline-flood injection
    // vector) and cap the length. JSON.stringify below safely escapes any remaining
    // control chars, and the SYSTEM prompt forbids inventing figures.
    const context  = (typeof body.context === 'string' ? body.context : '')
      .replace(/\s+/g, ' ').trim().slice(0, 2000);
    const snapshot = (body.snapshot && typeof body.snapshot === 'object') ? body.snapshot : {};

    // ── Key check → 200 not_configured (client degrades to heuristic text) ───
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || !String(apiKey).trim()) {
      return res.status(200).json({ ok: false, reason: 'not_configured' });
    }

    const model = process.env.QBR_NARRATIVE_MODEL || 'claude-sonnet-5';

    // ── Prompts ──────────────────────────────────────────────────────────────
    const SYSTEM = [
      'You are a Fortune 500 CMO with 30 years of experience writing a board-ready',
      'Quarterly Business Review.',
      '',
      'HARD RULES (non-negotiable):',
      '- Use ONLY numbers that are present in the provided snapshot object.',
      '- NEVER invent a figure, NEVER round differently, and NEVER alter any figure',
      '  in any way from how it appears in the snapshot.',
      '- If a figure the narrative would naturally reference is absent from the',
      '  snapshot, write "n/a" instead of guessing.',
      '- Be concise and board-appropriate: crisp, senior, no filler.',
      '- Output STRICT JSON ONLY. No markdown, no code fences, no commentary,',
      '  no text before or after the JSON object.',
    ].join('\n');

    const USER = [
      'Write the Quarterly Business Review narrative from the data below.',
      'Return a single JSON object with EXACTLY these keys and no others:',
      '  "openingScript"   (string) a ~60-second spoken opening to read aloud to the board,',
      '  "executiveSummary"(string) a tight executive summary,',
      '  "rootCause"       (array)  each item an object with EXACTLY the keys',
      '                             "problem", "cause", "impact", "solution" (all strings),',
      '  "decisionSummary" (string) one paragraph the board approves.',
      'Ground every figure strictly in the snapshot; use "n/a" for anything absent.',
      '',
      'DATA:',
      JSON.stringify({ quarter, context, snapshot }),
    ].join('\n');

    // ── Call the Anthropic Messages API via global fetch (no new deps) ───────
    let upstream;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          system: SYSTEM,
          messages: [{ role: 'user', content: USER }],
        }),
      });
    } catch (e) {
      // Network failure reaching Anthropic — retryable from the client's POV.
      return res.status(200).json({ ok: false, reason: 'error', detail: 'upstream_unreachable' });
    }

    if (!upstream.ok) {
      // Non-2xx from Anthropic. Report ONLY the status code — never the body,
      // which could echo request material; never the key.
      return res.status(200).json({ ok: false, reason: 'error', detail: 'upstream_' + upstream.status });
    }

    // ── Parse the model reply defensively ────────────────────────────────────
    let data;
    try {
      data = await upstream.json();
    } catch {
      return res.status(200).json({ ok: false, reason: 'error', detail: 'bad_upstream_json' });
    }

    let text = '';
    if (data && Array.isArray(data.content) && data.content[0] && typeof data.content[0].text === 'string') {
      text = data.content[0].text;
    }
    if (!text) {
      return res.status(200).json({ ok: false, reason: 'error', detail: 'empty_reply' });
    }

    // Strip ```json / ``` fences if the model added them despite instructions.
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(200).json({ ok: false, reason: 'error', detail: 'parse_failed' });
    }
    if (!parsed || typeof parsed !== 'object') {
      return res.status(200).json({ ok: false, reason: 'error', detail: 'parse_shape' });
    }

    // ── Success ──────────────────────────────────────────────────────────────
    return res.status(200).json({ ok: true, narrative: parsed });
  } catch (e) {
    // Absolute backstop — the client must never see a 5xx from this endpoint.
    return res.status(200).json({ ok: false, reason: 'error', detail: 'handler_exception' });
  }
};
