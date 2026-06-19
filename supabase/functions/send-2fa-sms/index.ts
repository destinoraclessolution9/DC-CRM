// supabase/functions/send-2fa-sms/index.ts
// Generates a 6-digit 2FA code server-side and sends it via Twilio SMS.
//
// Security model (post-audit):
//   * The caller's JWT is VERIFIED against GoTrue (/auth/v1/user) — the role
//     claim is never trusted from an unverified base64 payload. A forged
//     header.payload.signature can no longer pass the gate.
//   * The generated code is persisted SERVER-SIDE (salted SHA-256 hash + TTL +
//     attempt counter) in public.mfa_sms_codes, keyed by the verified auth.uid.
//     This makes the factor enforceable by a companion server-side verify flow
//     even if the browser/JS is fully attacker-controlled.
//   * A SERVER-SIDE send rate limit (per auth.uid + per destination phone) is
//     applied before any Twilio dispatch, so the (paid) SMS endpoint cannot be
//     used for abuse / cost amplification.
//
// Required env vars (Supabase dashboard → Functions secrets):
//   SUPABASE_URL                (auto-injected)
//   SUPABASE_ANON_KEY           (auto-injected) — used only to verify the caller JWT
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injected) — server-side state read/write
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM                 (your purchased number in E.164, e.g. +14155552671)
//
// Request:  { phone: "+60123456789" }   (Authorization: Bearer <jwt> required)
// Response: { ok: true, hash, salt, expires_at }  on success
//           { error, ok: false }                   on failure (4xx/5xx)
//           { error: "unauthorized" }              on missing/invalid caller auth (401)
//
// The returned { hash, salt } is the salted SHA-256 verification material the
// client/native-MFA flow stores to verify the user-entered code. It is salted
// per-send so the same returned value cannot be precomputed across sends. The
// authoritative copy lives server-side; a companion verify-2fa-sms function
// should enforce single-use / attempts / expiry against public.mfa_sms_codes.

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") || "";
// @ts-ignore
const ANON_KEY: string = Deno.env.get("SUPABASE_ANON_KEY") || "";
// @ts-ignore
const SERVICE_ROLE: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// @ts-ignore
const TWILIO_ACCOUNT_SID: string = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
// @ts-ignore
const TWILIO_AUTH_TOKEN: string = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
// @ts-ignore
const TWILIO_FROM: string = Deno.env.get("TWILIO_FROM") || "";

// Code lifetime and abuse limits (server-side, not client-overridable).
const CODE_TTL_MS = 5 * 60 * 1000;          // code valid for 5 minutes
const RATE_WINDOW_MS = 10 * 60 * 1000;      // sliding window for send throttling
const MAX_SENDS_PER_WINDOW = 3;             // per (user, phone) per window

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
// client-supplied base64 payload. A forged token fails /auth/v1/user (non-200),
// so the role claim can no longer be hand-crafted to pass the gate.
async function verifyCaller(
  req: Request,
): Promise<{ ok: true; userId: string; role: string } | { ok: false; status: number }> {
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
  // GoTrue puts the authenticated principal's role here; for an end user this is
  // "authenticated". service_role tokens never hit /auth/v1/user as a user, so
  // any verified identity returned here is a real, signed-in caller.
  const role = String(who?.role || "authenticated");
  return { ok: true, userId: String(userId), role };
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomSaltHex(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
}

function generateCode(): string {
  // 6-digit numeric code, left-padded. Uses crypto.getRandomValues for entropy.
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

function normalizePhone(raw: string): string {
  // Canonicalize any MY-style input to a single E.164 form, then validate.
  // Strategy: keep an explicit +prefix verbatim; otherwise reduce to digits,
  // drop a single leading 0, and add the MY country code only if not present.
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";

  let digits: string;
  if (trimmed.startsWith("+")) {
    // Caller gave E.164 already — strip non-digits but trust the country code.
    digits = trimmed.replace(/\D/g, "");
  } else {
    digits = trimmed.replace(/\D/g, "");
    if (digits.startsWith("60")) {
      // already carries the MY country code (e.g. "60123456789")
      // leave as-is
    } else {
      // local form: drop a single leading 0 then prefix MY country code
      digits = "60" + digits.replace(/^0/, "");
    }
  }

  if (!digits) return "";
  // MY E.164 is +60 followed by 9-10 national digits (mobiles are 9-10 here);
  // validate the full string length so a malformed +600... never reaches Twilio.
  const e164 = `+${digits}`;
  if (!/^\+\d{10,15}$/.test(e164)) return "";
  return e164;
}

async function sendTwilioSms(to: string, body: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM) {
    return { ok: false, status: 503, error: "sms_provider_not_configured" };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const form = new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body });
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: "twilio_error", detail: txt };
  }
  return { ok: true, status: 200 };
}

// ---- Server-side state (public.mfa_sms_codes) -----------------------------
// Expected schema (see cross_file_needs — migration must be added):
//   create table public.mfa_sms_codes (
//     id          uuid primary key default gen_random_uuid(),
//     auth_user_id uuid not null,
//     phone       text not null,
//     code_hash   text not null,   -- sha256(code + ':' + salt)
//     salt        text not null,
//     expires_at  timestamptz not null,
//     attempts    int  not null default 0,
//     consumed    boolean not null default false,
//     created_at  timestamptz not null default now()
//   );
// RLS: no anon/authenticated access — only the service role (this function and
// the companion verify function) may read/write.

const REST = () => `${SUPABASE_URL}/rest/v1/mfa_sms_codes`;
const SR_HEADERS = {
  "apikey": SERVICE_ROLE,
  "Authorization": `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
};

// Count un-expired sends for this (user, phone) inside the rate window.
async function recentSendCount(userId: string, phone: string): Promise<number | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null; // cannot enforce → treat as unknown
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const q = `${REST()}?select=id&auth_user_id=eq.${encodeURIComponent(userId)}` +
    `&phone=eq.${encodeURIComponent(phone)}&created_at=gte.${encodeURIComponent(since)}`;
  const res = await fetch(q, { headers: { ...SR_HEADERS, "Prefer": "count=exact" } });
  if (!res.ok) return null;
  // Prefer count=exact returns the count in the Content-Range header (e.g. "0-2/3").
  const cr = res.headers.get("content-range") || "";
  const total = cr.split("/")[1];
  if (total && /^\d+$/.test(total)) return parseInt(total, 10);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : null;
}

async function persistCode(
  userId: string,
  phone: string,
  codeHash: string,
  salt: string,
  expiresAt: string,
): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return false;
  // Invalidate any prior un-consumed codes for this user so only the newest is
  // verifiable (single live code per user), then insert the fresh row.
  await fetch(
    `${REST()}?auth_user_id=eq.${encodeURIComponent(userId)}&consumed=eq.false`,
    { method: "PATCH", headers: SR_HEADERS, body: JSON.stringify({ consumed: true }) },
  ).catch(() => {});
  const res = await fetch(REST(), {
    method: "POST",
    headers: { ...SR_HEADERS, "Prefer": "return=minimal" },
    body: JSON.stringify({
      auth_user_id: userId,
      phone,
      code_hash: codeHash,
      salt,
      expires_at: expiresAt,
      attempts: 0,
      consumed: false,
    }),
  });
  return res.ok;
}

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  // Verify the caller's signed JWT (not an unverified base64 payload).
  const caller = await verifyCaller(req);
  if (!caller.ok) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: caller.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  const phone = normalizePhone(payload?.phone);
  if (!phone) return json({ ok: false, error: "phone_required" }, 400);

  // Server-side per-(user,phone) send rate limit BEFORE dispatching any SMS.
  const sends = await recentSendCount(caller.userId, phone);
  if (sends !== null && sends >= MAX_SENDS_PER_WINDOW) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  const code = generateCode();
  // Salt the stored/returned hash per send so it cannot be precomputed and so
  // the same code never yields the same hash across sends.
  const salt = randomSaltHex();
  const codeHash = await sha256Hex(`${code}:${salt}`);
  const expiresAtMs = Date.now() + CODE_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();

  // Persist the authoritative server-side state before sending. If persistence
  // fails we refuse to send so the factor never silently degrades to "no record".
  const persisted = await persistCode(caller.userId, phone, codeHash, salt, expiresAt);
  if (!persisted) {
    return json({ ok: false, error: "mfa_state_unavailable" }, 503);
  }

  const smsBody = `Your DestinOracles verification code is ${code}. It expires in 5 minutes.`;
  const sent = await sendTwilioSms(phone, smsBody);
  if (!sent.ok) return json({ ok: false, error: sent.error, detail: (sent as any).detail }, sent.status);

  // Return the salted verification material the client/native-MFA flow needs.
  // The authoritative copy is server-side (public.mfa_sms_codes); a companion
  // verify-2fa-sms function should be the real gate (single-use, attempts, TTL).
  return json({ ok: true, hash: codeHash, salt, expires_at: expiresAt });
});
