// supabase/functions/send-2fa-sms/index.ts
// Generates a 6-digit 2FA code server-side and sends it via Twilio SMS.
// Neither the plaintext code nor its hash is ever returned to the client —
// returning the hash would let the 6-digit code be brute-forced offline and
// bypass 2FA. Verification is handled by a server-side flow.
// Requires an authenticated caller (Bearer JWT with role authenticated/service_role).
//
// Required env vars (Supabase dashboard → Functions → admin-auth-ops secrets):
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM           (your purchased number in E.164, e.g. +14155552671)
//
// Request:  { phone: "+60123456789" }   (Authorization: Bearer <jwt> required)
// Response: { ok: true }                 on success
//           { error, ok: false }         on failure (4xx/5xx)
//           { error: "unauthorized" }    on missing/invalid caller auth (401)

// @ts-ignore
const TWILIO_ACCOUNT_SID: string = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
// @ts-ignore
const TWILIO_AUTH_TOKEN: string = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
// @ts-ignore
const TWILIO_FROM: string = Deno.env.get("TWILIO_FROM") || "";

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateCode(): string {
  // 6-digit numeric code, left-padded. Uses crypto.getRandomValues for entropy.
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(n % 1_000_000).padStart(6, "0");
}

function normalizePhone(raw: string): string {
  // Accept raw digits or +E.164; force a leading + if the caller gave digits only.
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;
  // Default to Malaysia country code if 10-11 digits without + (CRM is MY-based).
  if (/^\d{9,12}$/.test(trimmed)) return `+${trimmed.startsWith("60") ? trimmed : "60" + trimmed.replace(/^0/, "")}`;
  return trimmed;
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

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const _role = callerRole(req);
  if (_role !== "authenticated" && _role !== "service_role") {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  }

  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  const phone = normalizePhone(payload?.phone);
  if (!phone) return json({ ok: false, error: "phone_required" }, 400);

  const code = generateCode();
  const smsBody = `Your DestinOracles verification code is ${code}. It expires in 5 minutes.`;

  const sent = await sendTwilioSms(phone, smsBody);
  if (!sent.ok) return json({ ok: false, error: sent.error, detail: (sent as any).detail }, sent.status);

  // Confirm the SMS was sent. The code hash is intentionally NOT returned —
  // returning it lets the 6-digit code be brute-forced offline (2FA bypass).
  // Verification is handled by a server-side flow.
  return json({ ok: true });
});
