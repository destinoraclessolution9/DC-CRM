// supabase/functions/order-form-ocr/index.ts
// Order Form OCR — takes a photo of one of three PREON order-form templates
// (A: PRN Modern Installment, B: PRN Receipt Direct, C: Old Paper Form)
// and returns structured field data using Gemini 2.5 Flash vision.
//
// Caller: any authenticated CRM user — verifies JWT against public.users.
//
// Request:  POST JSON { image_base64, mime_type, form_type? }
//           form_type ∈ "A" | "B" | "C" | "auto" (default "auto" — let Gemini classify)
// Response: { ok, form_type, fields, confidence, raw_text }

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

// Only allow trusted image MIME types through to Gemini (mirror cps-form-ocr).
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

// One unified extraction prompt that ALSO classifies the form.
// Gemini returns a single schema with all fields nullable; fields the form
// doesn't have come back null.
const EXTRACTION_PROMPT = `You are reading a Malaysian PREON order form / receipt. There are THREE templates:

A) "PRN Modern Installment" — printed digital form titled "ORDER FORM", header includes a "PRN" number,
   has sections: BILL TO, Order Date/Ref/Consultant/Agent Code/Collection, product table, DOWN PAYMENT,
   SECURITY DEPOSIT, Total Amount, STANDING INSTRUCTION PAYMENT block, PREON DETAILS block
   (Installment Amount / Monthly Installment / Tenure).

B) "PRN Receipt Direct" — printed digital titled "ORDER FORM / RECEIPT", PRN number, BILL TO,
   Order Date/Ref/Consultant/Agent Code/Collection, single product line, TRANSACTION DETAILS
   (PAYMENT METHOD / REFERENCE / RECEIPT NO.). No installment/down payment. Total Amount.

C) "Old Paper Form" — paper form titled "PREON ORDER FORM / RECEIPT" in BOTH Chinese (賓記訂單) and English,
   "PR" number (no N), company header "PREON RESOURCES SDN BHD / 宏盈有限公司". Has handwritten fields
   for DEALER/EA, CUSTOMER (NAME, NRIC, TEL, ADDRESS, EMAIL, OCCUPATION), DESCRIPTIONS (Power Ring + ring size,
   M/F, Solar/Lunar birth date, GUA, Feng Shui Product, Calligraphy, Course, Others), FULLPAYMENT or INSTALLMENT,
   PAYMENT MODE (Credit Card / Debit Card / Visa / Master / Cheque / Direct Banking), card details, third-party
   relationship, Product Collection Area (KL / PG / JB / SG).

FIRST step: identify which template (A, B, or C). If you genuinely cannot tell, output "unknown".

SECOND step: extract every field listed below. If a field is not present on this template OR is blank/illegible,
return null. DO NOT GUESS. Preserve the text as written. For dates, output ISO YYYY-MM-DD; if the date is shown
as DD/MM/YYYY convert carefully (Malaysian date convention is day-first).

For amounts, return plain numeric strings without "RM" or commas (e.g. "18990.00", "1010.00").

For EACH field, ALSO rate confidence: "high" (clearly legible, unambiguous), "medium" (legible but possibly
ambiguous), "low" (handwriting hard to read or guessed). Use "low" liberally for handwriting.

Return STRICT JSON matching the schema. No commentary.

FIELD GUIDE (some only apply to specific templates — others null):

Header:
- form_type: "A" | "B" | "C" | "unknown"
- prn_number: the PRN or PR number (e.g. "PRN19027476" or "PR1935532") — include the prefix
- order_date: date the order was placed (ISO YYYY-MM-DD)
- order_ref: "Pre On #156302" / "Direct On #165312" / null
- consultant: consultant name
- agent_code: numeric code
- collection_branch: e.g. "Kuala Lumpur", or KL/PG/JB/SG for template C
- business_month: only template C (e.g. "06/2024")

Customer:
- customer_name
- customer_nric: NRIC number (template C only; templates A/B don't show it)
- customer_address
- customer_phone
- customer_email
- customer_occupation: template C only
- customer_attn: optional "ATTN" name on templates A/B (may differ from customer_name)

Product:
- product_name: e.g. "AUTHORITY POWER RING", "XING GUA JIE YUN 2026"
- product_ringsize: numeric ring size if shown
- product_lunar_bd: lunar birth date (preserve format as written or ISO)
- product_solar_bd: solar birth date (ISO YYYY-MM-DD preferred)
- product_lifesign: e.g. "2" (only on PRN modern installment for rings)
- product_usage: e.g. "Own Use"
- product_gender: "M" | "F" | null (template C if checked)
- product_gua: GUA number/text if shown (template C)
- product_category: "Power Ring" | "Feng Shui Product" | "Calligraphy" | "Course" | "Others" | null (template C — which checkbox is ticked)

Amounts (all numeric strings, no "RM"):
- amount_unit_price: per-unit price shown
- amount_down_payment: down payment if separate
- amount_security_deposit: security deposit if separate
- amount_total_due: Total Amount shown on the form (what customer pays today)
- amount_grand_total: for template C, "GRAND TOTAL" — if same as unit_price ignore

Installment (template A or template C if installment ticked):
- installment_amount: full installment amount (e.g. "18990.00")
- installment_monthly: monthly payment
- installment_tenure_months: number of months

Payment:
- payment_type: "Visa" | "Master" | "Credit Card" | "Debit Card" | "Cheque" | "Direct Banking" | "Online" | null
- payment_method: "Standing Instruction" | "Online (MPGS)" | "Direct Banking" | "Cheque" | null
- card_holder: name on card
- card_last4: last 4 digits of card (e.g. "1623")
- card_expiry: MM/YY format
- card_issuing_bank: e.g. "MALAYAN BANKING BERHAD"
- third_party_relationship: relationship if third party paid (template C)

Transaction (template B):
- transaction_reference: REFERENCE field
- transaction_receipt_no: RECEIPT NO.
- transaction_gateway: e.g. "Online (MPGS) – Card ending with 9836"

Other:
- raw_text: all text visible on the form, as a single string for audit/debug.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    fields: {
      type: "OBJECT",
      properties: {
        form_type:                  { type: "STRING", nullable: true, enum: ["A", "B", "C", "unknown"] },
        prn_number:                 { type: "STRING", nullable: true },
        order_date:                 { type: "STRING", nullable: true },
        order_ref:                  { type: "STRING", nullable: true },
        consultant:                 { type: "STRING", nullable: true },
        agent_code:                 { type: "STRING", nullable: true },
        collection_branch:          { type: "STRING", nullable: true },
        business_month:             { type: "STRING", nullable: true },

        customer_name:              { type: "STRING", nullable: true },
        customer_nric:              { type: "STRING", nullable: true },
        customer_address:           { type: "STRING", nullable: true },
        customer_phone:             { type: "STRING", nullable: true },
        customer_email:             { type: "STRING", nullable: true },
        customer_occupation:        { type: "STRING", nullable: true },
        customer_attn:              { type: "STRING", nullable: true },

        product_name:               { type: "STRING", nullable: true },
        product_ringsize:           { type: "STRING", nullable: true },
        product_lunar_bd:           { type: "STRING", nullable: true },
        product_solar_bd:           { type: "STRING", nullable: true },
        product_lifesign:           { type: "STRING", nullable: true },
        product_usage:              { type: "STRING", nullable: true },
        product_gender:             { type: "STRING", nullable: true, enum: ["M", "F"] },
        product_gua:                { type: "STRING", nullable: true },
        product_category:           { type: "STRING", nullable: true, enum: ["Power Ring", "Feng Shui Product", "Calligraphy", "Course", "Others"] },

        amount_unit_price:          { type: "STRING", nullable: true },
        amount_down_payment:        { type: "STRING", nullable: true },
        amount_security_deposit:    { type: "STRING", nullable: true },
        amount_total_due:           { type: "STRING", nullable: true },
        amount_grand_total:         { type: "STRING", nullable: true },

        installment_amount:         { type: "STRING", nullable: true },
        installment_monthly:        { type: "STRING", nullable: true },
        installment_tenure_months:  { type: "STRING", nullable: true },

        payment_type:               { type: "STRING", nullable: true },
        payment_method:             { type: "STRING", nullable: true },
        card_holder:                { type: "STRING", nullable: true },
        card_last4:                 { type: "STRING", nullable: true },
        card_expiry:                { type: "STRING", nullable: true },
        card_issuing_bank:          { type: "STRING", nullable: true },
        third_party_relationship:   { type: "STRING", nullable: true },

        transaction_reference:      { type: "STRING", nullable: true },
        transaction_receipt_no:     { type: "STRING", nullable: true },
        transaction_gateway:        { type: "STRING", nullable: true },
      },
    },
    confidence: {
      type: "OBJECT",
      // Same key set as fields, each "high" | "medium" | "low" | null
      properties: Object.fromEntries(
        [
          "form_type","prn_number","order_date","order_ref","consultant","agent_code",
          "collection_branch","business_month","customer_name","customer_nric",
          "customer_address","customer_phone","customer_email","customer_occupation",
          "customer_attn","product_name","product_ringsize","product_lunar_bd",
          "product_solar_bd","product_lifesign","product_usage","product_gender",
          "product_gua","product_category","amount_unit_price","amount_down_payment",
          "amount_security_deposit","amount_total_due","amount_grand_total",
          "installment_amount","installment_monthly","installment_tenure_months",
          "payment_type","payment_method","card_holder","card_last4","card_expiry",
          "card_issuing_bank","third_party_relationship","transaction_reference",
          "transaction_receipt_no","transaction_gateway",
        ].map(k => [k, { type: "STRING", nullable: true, enum: ["high", "medium", "low"] }])
      ),
    },
    raw_text: { type: "STRING" },
  },
  required: ["fields", "confidence"],
};

async function callGemini(imageBase64: string, mimeType: string, hintFormType?: string) {
  const promptWithHint = hintFormType && hintFormType !== "auto"
    ? `${EXTRACTION_PROMPT}\n\nHINT FROM CLIENT: The user pre-classified this as Template ${hintFormType}. Use that unless the photo clearly disagrees.`
    : EXTRACTION_PROMPT;

  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: promptWithHint },
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

  // Log upstream detail server-side only; throw a generic error so raw Gemini
  // response fragments are never returned to the client (mirror cps-form-ocr).
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[order-form-ocr] Gemini API error ${res.status}:`, errText.slice(0, 500));
    throw new Error("upstream_error");
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error("[order-form-ocr] Gemini returned no text:", JSON.stringify(data).slice(0, 500));
    throw new Error("upstream_error");
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("[order-form-ocr] Gemini returned non-JSON:", text.slice(0, 500));
    throw new Error("upstream_error");
  }
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
  let formType = "auto";

  try {
    const body = await req.json();
    imageBase64 = String(body?.image_base64 || "").replace(/^data:[^;]+;base64,/, "");
    mimeType = String(body?.mime_type || "image/jpeg");
    formType = String(body?.form_type || "auto");
    if (!imageBase64) return json({ ok: false, error: "no_image_base64" }, 400);
  } catch (e: any) {
    return json({ ok: false, error: "bad_request", detail: String(e?.message || e) }, 400);
  }

  // Reject any non-image MIME type before forwarding to Gemini (mirror cps-form-ocr).
  const normalizedMime = mimeType.split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.includes(normalizedMime)) {
    console.error("[order-form-ocr] rejected mime type:", mimeType);
    return json({ ok: false, error: "unsupported_image_type" }, 400);
  }
  mimeType = normalizedMime;

  const approxBytes = (imageBase64.length * 3) / 4;
  if (approxBytes > 8 * 1024 * 1024) {
    return json({ ok: false, error: "image_too_large", detail: "Max 8 MB. Try a smaller photo." }, 413);
  }

  try {
    const result = await callGemini(imageBase64, mimeType, formType);
    const detectedType = result?.fields?.form_type || "unknown";
    return json({ ok: true, form_type: detectedType, ...result });
  } catch (e: any) {
    // Log detail server-side; return only a generic error to the client (mirror cps-form-ocr).
    console.error("[order-form-ocr] ocr failed:", String(e?.message || e));
    return json({ ok: false, error: "ocr_failed" }, 500);
  }
});
