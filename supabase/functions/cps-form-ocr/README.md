# cps-form-ocr — CPS Form Photo OCR

Reads a photo of the paper **PERSONAL LIFE CHART ANALYSIS / 細解命盤** form
and returns structured field data using Google's **Gemini 2.5 Flash** vision model.

## Setup (one-time)

### 1. Get a Gemini API key

1. Go to **https://aistudio.google.com/app/apikey**
2. Sign in with your Google account
3. Click **Create API key** → copy the key (starts with `AIza...`)

Free tier: 15 req/min, 1,500 req/day — plenty for CPS volume.

### 2. Add the key to Supabase

In your CRM project root, run:

```bash
supabase secrets set GEMINI_API_KEY=AIza...your-key-here
```

Or via the Supabase dashboard:
- Project Settings → Edge Functions → Secrets → **New secret**
- Name: `GEMINI_API_KEY`
- Value: your key

### 3. Deploy the function

```bash
supabase functions deploy cps-form-ocr
```

## Use

From the CRM:

1. Open **Quick Add Activity** → CPS type (or **Add Prospect**)
2. Click **📷 Take Photo** at the top of the form
3. Camera opens (mobile) or file picker (desktop)
4. Wait ~3–6s — the **Review Scanned Form** modal opens
5. Review the side-by-side diff:
   - ✓ **MATCH** rows — already match, no change needed
   - **+ FILL** rows — empty in form, will be filled (pre-ticked)
   - ⚠ **CONFLICT** rows — differ from existing — agent must explicitly tick
6. Click **Apply Selected**
7. Form populates → agent reviews → saves as normal

## Fields extracted

| Paper form (中/EN) | CRM target |
|---|---|
| 姓名 Customer Name | `name` |
| 性別 Gender (女/男 checkbox) | `gender` (Male/Female) |
| 生日 陽曆 Solar | `dob` (YYYY-MM-DD) |
| 生日 農曆 Lunar | `lunar` |
| 手提號碼 Phone | `phone` |
| 目前職業 Occupation | `occupation` |
| 電郵 Email | `email` |
| 居住地區 Living Area | `address` |
| 婚姻狀況 Marital Status (Single/Married/Others) | `marital_status` |
| 介紹人 Introducer | not auto-applied yet (free-text in v1) |

## Cost

- Free tier covers normal CRM use (1,500 scans/day, 15/min).
- If you exceed: ~$0.002/scan on Gemini 2.5 Flash paid tier.

## Privacy

- The photo is sent to Google for OCR and **not stored** by this function.
- Only the parsed JSON is returned to the browser.
- If you want an audit trail, save the photo manually as an attachment after
  filling the form.

## Request / Response

**Request** (POST, must include `Authorization: Bearer <user_jwt>`):

```json
{ "image_base64": "...", "mime_type": "image/jpeg" }
```

Or as `multipart/form-data` with field `photo`.

**Response**:

```json
{
  "ok": true,
  "fields": {
    "name": "Tan Ah Kow",
    "gender": "Male",
    "dob_solar": "1990-12-12",
    "dob_lunar": "庚午年冬月廿一",
    "phone": "012-3456789",
    "occupation": "Engineer",
    "email": "tan@gmail.com",
    "address": "12 Jln Sutera, Bangsar",
    "marital_status": "Married",
    "introducer": "Lee Mei",
    "date": "2026-05-30"
  },
  "confidence": {
    "name": "high", "gender": "high", "dob_solar": "high",
    "phone": "high", "email": "medium", "address": "medium"
  },
  "raw_text": "..."
}
```

## Errors

| Status | error | Meaning |
|---|---|---|
| 401 | `no_token` / `invalid_token` | Caller must be a signed-in CRM user |
| 403 | `not_in_crm` | Auth user not found in `public.users` |
| 400 | `no_photo` / `no_image_base64` | Missing image |
| 413 | `image_too_large` | Photo > 8 MB |
| 500 | `gemini_key_not_configured` | `GEMINI_API_KEY` secret missing |
| 500 | `ocr_failed` | Gemini API error (see `detail`) |
