// supabase/functions/cps-form-ocr/index.ts
// CPS Form OCR — takes a photo of the paper "PERSONAL LIFE CHART ANALYSIS / 細解命盤"
// form and returns structured field data using Gemini 2.5 Flash vision.
//
// Caller: any authenticated CRM user (any role) — the function verifies the
// caller's JWT against public.users before calling Gemini.
//
// Request:  POST multipart/form-data with field "photo" (image/jpeg|png|webp)
//           OR JSON { "image_base64": "...", "mime_type": "image/jpeg" }
// Response: { ok, fields: {...}, confidence: {...}, raw_text }

// @ts-ignore
const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL") || "";
// @ts-ignore
const SERVICE_ROLE: string = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// @ts-ignore
const ANON_KEY: string = Deno.env.get("SUPABASE_ANON_KEY") || "";
// @ts-ignore
const GEMINI_API_KEY: string = Deno.env.get("GEMINI_API_KEY") || "";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Only forward image MIME types we trust to Gemini.
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

// Verify the caller has a valid JWT and exists in public.users.
// Any role can scan — agents fill CPS forms for prospects.
async function requireAuth(req: Request): Promise<{ ok: true } | { ok: false; reason: string; status: number }> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, reason: "no_token", status: 401 };

  const whoRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "Authorization": `Bearer ${token}`, "apikey": ANON_KEY },
  });
  if (!whoRes.ok) return { ok: false, reason: "invalid_token", status: 401 };
  const who = await whoRes.json();
  if (!who?.email) return { ok: false, reason: "no_identity", status: 401 };

  const userRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?select=id&email=eq.${encodeURIComponent(who.email)}&limit=1`,
    { headers: { "apikey": SERVICE_ROLE, "Authorization": `Bearer ${SERVICE_ROLE}` } },
  );
  if (!userRes.ok) return { ok: false, reason: "user_lookup_failed", status: 500 };
  const rows = await userRes.json();
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: "not_in_crm", status: 403 };

  return { ok: true };
}

const EXTRACTION_PROMPT = `You are reading a filled-out paper form titled "PERSONAL LIFE CHART ANALYSIS / 細解命盤".
The form is bilingual (Traditional Chinese + English) and may be handwritten.

Extract the following fields exactly as written. If a field is empty, blank, illegible, or you are not confident, set it to null. Do NOT guess.

Field guide:
- name: the customer's name (姓名 Customer Name). Romanized name preferred; include Chinese if also written.
- gender: "Male" or "Female" — based on which checkbox is ticked (男 = Male, 女 = Female). null if neither ticked.
- dob_solar: solar/Western date of birth in ISO format YYYY-MM-DD. The form shows it as DD/MM/YYYY under "Solar 陽曆". Convert carefully.
- dob_lunar: lunar date of birth as written, e.g. "1990-11-21" or the raw Chinese form. null if blank.
- phone: phone number as written (手提號碼 Phone Number), digits + dashes preserved.
- occupation: current occupation (目前職業 Current Occupation).
- email: email address (電郵 Email).
- address: living area (居住地區 Living Area). The full text as written.
- marital_status: one of "Single", "Married", "Others" based on which checkbox is ticked (婚姻狀況). null if none ticked.
- introducer: the introducer/referrer name (介紹人 Introducer).
- date: the form date in YYYY-MM-DD if shown at top right "Date".

For EACH field, also rate your confidence: "high" (clearly legible and unambiguous), "medium" (legible but possibly ambiguous), "low" (hard to read, partially obscured, or guessed). Use "low" for any field where you had to interpret messy handwriting.

Return STRICT JSON matching this schema, no commentary:
{
  "fields": {
    "name": string|null,
    "gender": "Male"|"Female"|null,
    "dob_solar": string|null,
    "dob_lunar": string|null,
    "phone": string|null,
    "occupation": string|null,
    "email": string|null,
    "address": string|null,
    "marital_status": "Single"|"Married"|"Others"|null,
    "introducer": string|null,
    "date": string|null
  },
  "confidence": {
    "name": "high"|"medium"|"low"|null,
    "gender": "high"|"medium"|"low"|null,
    "dob_solar": "high"|"medium"|"low"|null,
    "dob_lunar": "high"|"medium"|"low"|null,
    "phone": "high"|"medium"|"low"|null,
    "occupation": "high"|"medium"|"low"|null,
    "email": "high"|"medium"|"low"|null,
    "address": "high"|"medium"|"low"|null,
    "marital_status": "high"|"medium"|"low"|null,
    "introducer": "high"|"medium"|"low"|null,
    "date": "high"|"medium"|"low"|null
  },
  "raw_text": "all text visible on the form, for reference"
}`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    fields: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", nullable: true },
        gender: { type: "STRING", nullable: true, enum: ["Male", "Female"] },
        dob_solar: { type: "STRING", nullable: true },
        dob_lunar: { type: "STRING", nullable: true },
        phone: { type: "STRING", nullable: true },
        occupation: { type: "STRING", nullable: true },
        email: { type: "STRING", nullable: true },
        address: { type: "STRING", nullable: true },
        marital_status: { type: "STRING", nullable: true, enum: ["Single", "Married", "Others"] },
        introducer: { type: "STRING", nullable: true },
        date: { type: "STRING", nullable: true },
      },
    },
    confidence: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
        gender: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
        dob_solar: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
        dob_lunar: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
        phone: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
        occupation: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
        email: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
        address: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
        marital_status: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
        introducer: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
        date: { type: "STRING", nullable: true, enum: ["high", "medium", "low"] },
      },
    },
    raw_text: { type: "STRING" },
  },
  required: ["fields", "confidence"],
};

async function callGemini(imageBase64: string, mimeType: string) {
  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: EXTRACTION_PROMPT },
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: "application/json",
      response_schema: RESPONSE_SCHEMA,
    },
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[cps-form-ocr] Gemini API error ${res.status}:`, errText.slice(0, 500));
    throw new Error("upstream_error");
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error("[cps-form-ocr] Gemini returned no text:", JSON.stringify(data).slice(0, 500));
    throw new Error("upstream_error");
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("[cps-form-ocr] Gemini returned non-JSON:", text.slice(0, 500));
    throw new Error("upstream_error");
  }
}

// Convert a Blob/File to base64 (no data URL prefix).
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // chunked encode to avoid call-stack issues on large images
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

// @ts-ignore
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!GEMINI_API_KEY) return json({ ok: false, error: "gemini_key_not_configured" }, 500);

  const auth = await requireAuth(req);
  if (!auth.ok) return json({ ok: false, error: auth.reason }, auth.status);

  let imageBase64 = "";
  let mimeType = "image/jpeg";

  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const photo = form.get("photo");
      if (!(photo instanceof Blob)) return json({ ok: false, error: "no_photo" }, 400);
      mimeType = photo.type || "image/jpeg";
      imageBase64 = await blobToBase64(photo);
    } else {
      const body = await req.json();
      imageBase64 = String(body?.image_base64 || "").replace(/^data:[^;]+;base64,/, "");
      mimeType = String(body?.mime_type || "image/jpeg");
      if (!imageBase64) return json({ ok: false, error: "no_image_base64" }, 400);
    }
  } catch (e: any) {
    console.error("[cps-form-ocr] request parse error:", String(e?.message || e));
    return json({ ok: false, error: "bad_request" }, 400);
  }

  // Only allow trusted image MIME types through to Gemini.
  const normalizedMime = mimeType.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(normalizedMime)) {
    console.error("[cps-form-ocr] rejected mime type:", mimeType);
    return json({ ok: false, error: "unsupported_image_type" }, 400);
  }
  mimeType = normalizedMime;

  // Validate image size — Gemini Flash limit is generous but we cap to avoid runaway costs
  const approxBytes = (imageBase64.length * 3) / 4;
  if (approxBytes > 8 * 1024 * 1024) {
    return json({ ok: false, error: "image_too_large", detail: "Max 8 MB. Try a smaller photo." }, 413);
  }

  try {
    const result = await callGemini(imageBase64, mimeType);
    return json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[cps-form-ocr] ocr failed:", String(e?.message || e));
    return json({ ok: false, error: "ocr_failed" }, 500);
  }
});
