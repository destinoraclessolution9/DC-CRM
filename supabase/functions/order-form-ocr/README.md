# order-form-ocr

Auto-extracts structured data from a photo of one of three PREON order-form templates:

| Code | Template                          | Identifier on form                                  |
| :--: | --------------------------------- | --------------------------------------------------- |
| **A** | PRN Modern Installment            | "ORDER FORM" + PRN + "PREON DETAILS" block          |
| **B** | PRN Receipt Direct                | "ORDER FORM / RECEIPT" + PRN + "TRANSACTION DETAILS"|
| **C** | Old Paper Form                    | "PREON ORDER FORM / RECEIPT" + PR (no N) + bilingual EN/中文 |

Powered by **Gemini 2.5 Flash** via the Generative Language API.

## Deploy

```bash
supabase functions deploy order-form-ocr --no-verify-jwt
supabase secrets set GEMINI_API_KEY=...
```

(`--no-verify-jwt` because the function does its own JWT verification against `public.users` — same pattern as `cps-form-ocr`.)

## Request

```http
POST /functions/v1/order-form-ocr
Authorization: Bearer <user-jwt>
Content-Type: application/json

{
  "image_base64": "...",
  "mime_type": "image/jpeg",
  "form_type": "auto"   // optional. "A" | "B" | "C" | "auto"
}
```

Max image size: 8 MB.

## Response

```json
{
  "ok": true,
  "form_type": "A",
  "fields": {
    "form_type": "A",
    "prn_number": "PRN19027476",
    "order_date": "2024-09-08",
    "consultant": "OO KEAN CHERNG",
    "agent_code": "169000463",
    "customer_name": "TAN SOO BOEY",
    "customer_address": "51. TAMAN BUKIT IDAMAN, 27600 RAUB",
    "customer_phone": "0199567355",
    "customer_email": "BOEYTANMAN@GMAIL.COM",
    "product_name": "AUTHORITY POWER RING",
    "product_ringsize": "18",
    "product_solar_bd": "1987-04-03",
    "product_lunar_bd": "1987-03-06",
    "amount_unit_price": "18990.00",
    "amount_down_payment": "1010.00",
    "amount_security_deposit": "200.00",
    "amount_total_due": "1210.00",
    "installment_monthly": "899.00",
    "installment_tenure_months": "20",
    "payment_type": "Visa",
    "payment_method": "Standing Instruction",
    "card_last4": "1623",
    "card_expiry": "09/25",
    "card_issuing_bank": "MALAYAN BANKING BERHAD"
  },
  "confidence": { "...": "high" | "medium" | "low" },
  "raw_text": "..."
}
```

Any field not present on the template (e.g. installment fields on Template B) comes back `null`.

## Cost

~$0.0003 per scan (Gemini 2.5 Flash). 200 closings/month ≈ $0.06/month.

## Caller

`script.js` → `app.handleOrderFormScanFile()` in the Meeting Outcome closing block.
