// supabase/functions/send-2fa-sms/index.ts
// Generates a 6-digit 2FA code server-side, sends it via Twilio SMS, and
// returns ONLY a SHA-256 hash of the code to the client. The plaintext code
// never touches the client browser — prevents log/screen-share leakage.
//
// Required env vars (Supabase dashboard → Functions → admin-auth-ops secrets):
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM           (your purchased number in E.164, e.g. +14155552671)
//
// Request:  { phone: "+60123456789" }
// Response: { hash: "<64-hex>", ok: true }  on success
//           { error, ok: false }            on failure (4xx/5xx)

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
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  const phone = normalizePhone(payload?.phone);
  if (!phone) return json({ ok: false, error: "phone_required" }, 400);

  const code = generateCode();
  const hash = await sha256Hex(code);
  const smsBody = `Your DestinOracles verification code is ${code}. It expires in 5 minutes.`;

  const sent = await sendTwilioSms(phone, smsBody);
  if (!sent.ok) return json({ ok: false, error: sent.error, detail: (sent as any).detail }, sent.status);

  // Return only the hash — client stores it and compares on verify.
  return json({ ok: true, hash });
});
