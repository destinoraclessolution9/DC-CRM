// supabase/functions/verify-2fa-sms/index.ts
// Server-side authoritative verify for the SMS 2FA factor — the companion the
// send-2fa-sms docstring calls for. Validates a user-entered code against the
// salted hash persisted in public.mfa_sms_codes and enforces single-use,
// attempt-cap, and TTL SERVER-SIDE so a fully attacker-controlled browser can
// neither replay a code, brute-force it past the cap, nor accept an expired one.
//
// Security model:
//   * The caller's JWT is VERIFIED against GoTrue (/auth/v1/user) — identical to
//     send-2fa-sms; a forged header.payload.signature can't pass the gate.
//   * The code is checked against the NEWEST un-consumed row for the verified
//     auth.uid only. On success the row is marked consumed=true (single-use).
//   * Each wrong attempt increments attempts; at MAX_ATTEMPTS the row is consumed
//     (burned) so an online guessing attack gets at most MAX_ATTEMPTS tries per
//     sent code.
//   * Expired rows (expires_at < now) are rejected and consumed.
//   * The hash uses the SAME construction as send-2fa-sms: sha256(code + ':' + salt).
//
// Required env vars (auto-injected by the platform):
//   SUPABASE_URL, SUPABASE_ANON_KEY (verify caller JWT),
//   SUPABASE_SERVICE_ROLE_KEY (read/write mfa_sms_codes; bypasses RLS).
//
// Request:  { code: "123456" }            (Authorization: Bearer <jwt> required)
// Response: { ok: true,  verified: true  }                       on a correct code
//           { ok: true,  verified: false, reason: "<why>" }      on a wrong/expired/used/locked code
//           { ok: false, error: "<why>" }                        on a server/config error (5xx)
//           { error: "unauthorized" }                            on missing/invalid caller auth (401)
//
// NOTE: returns 200 with verified:false for a genuine wrong code (not a 4xx) so the
// client can distinguish an authoritative "wrong code" from an infra error.

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") || "";
// @ts-ignore
const ANON_KEY: string = Deno.env.get("SUPABASE_ANON_KEY") || "";
// @ts-ignore
const SERVICE_ROLE: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Max wrong guesses per sent code before the code is burned. send-2fa-sms allows
// 3 sends / 10 min, so this caps an online guessing attack hard.
const MAX_ATTEMPTS = 5;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Verify the caller's JWT against GoTrue rather than trusting an unverified,
// client-supplied base64 payload. Mirrors send-2fa-sms.verifyCaller.
async function verifyCaller(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; status: number }> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, status: 401 };
  if (!SUPABASE_URL || !ANON_KEY) return { ok: false, status: 503 };

  const whoRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "Authorization": `Bearer ${token}`, "apikey": ANON_KEY },
  });
  if (!whoRes.ok) return { ok: false, status: 401 };
  const who = await whoRes.json().catch(() => null);
  const userId = who?.id;
  if (!userId) return { ok: false, status: 401 };
  return { ok: true, userId: String(userId) };
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time hex compare — defeats timing oracles on the digest compare.
function constantEqHex(a: string, b: string): boolean {
  const s1 = String(a ?? ""), s2 = String(b ?? "");
  if (s1.length !== s2.length) return false;
  let diff = 0;
  for (let i = 0; i < s1.length; i++) diff |= s1.charCodeAt(i) ^ s2.charCodeAt(i);
  return diff === 0;
}

const REST = () => `${SUPABASE_URL}/rest/v1/mfa_sms_codes`;
const SR_HEADERS = {
  "apikey": SERVICE_ROLE,
  "Authorization": `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
};

type CodeRow = {
  id: string;
  code_hash: string;
  salt: string;
  expires_at: string;
  attempts: number;
  consumed: boolean;
};

// Newest un-consumed code row for this user, or null.
async function latestPendingRow(userId: string): Promise<CodeRow | null> {
  const q = `${REST()}?select=id,code_hash,salt,expires_at,attempts,consumed` +
    `&auth_user_id=eq.${encodeURIComponent(userId)}&consumed=eq.false` +
    `&order=created_at.desc&limit=1`;
  const res = await fetch(q, { headers: SR_HEADERS });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] as CodeRow : null;
}

async function patchRow(id: string, patch: Record<string, unknown>): Promise<void> {
  await fetch(`${REST()}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...SR_HEADERS, "Prefer": "return=minimal" },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const caller = await verifyCaller(req);
  if (!caller.ok) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: caller.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ ok: false, error: "mfa_state_unavailable" }, 503);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  const code = String(payload?.code ?? "").trim();
  if (!code) return json({ ok: false, error: "code_required" }, 400);

  const row = await latestPendingRow(caller.userId);
  if (!row) return json({ ok: true, verified: false, reason: "no_pending_code" });

  // Expired → reject and burn so it can't be retried.
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await patchRow(row.id, { consumed: true });
    return json({ ok: true, verified: false, reason: "expired" });
  }

  // Already over the attempt cap (defensive — burned below on the hit) → reject.
  if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
    await patchRow(row.id, { consumed: true });
    return json({ ok: true, verified: false, reason: "too_many_attempts" });
  }

  const submitted = await sha256Hex(`${code}:${row.salt}`);
  if (constantEqHex(submitted, row.code_hash)) {
    // Correct → single-use: burn the row so it can never be replayed.
    await patchRow(row.id, { consumed: true });
    return json({ ok: true, verified: true });
  }

  // Wrong → increment attempts; burn once the cap is reached.
  const nextAttempts = (row.attempts ?? 0) + 1;
  await patchRow(row.id, nextAttempts >= MAX_ATTEMPTS
    ? { attempts: nextAttempts, consumed: true }
    : { attempts: nextAttempts });
  return json({
    ok: true,
    verified: false,
    reason: nextAttempts >= MAX_ATTEMPTS ? "too_many_attempts" : "invalid_code",
  });
});
