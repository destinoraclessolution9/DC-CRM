# Storage Bucket Split — Plan to Close the C2 PII Leak

**Date:** 2026-07-13 · **Status:** plan (not yet executed) · Supersedes the "just convert to signed URLs" idea.

## The core problem
The single `attachments` bucket is **Public** (confirmed live). It holds BOTH:
- **Sensitive PII** — order forms (NRIC/DOB/card last-4), invoices, CPS forms, payment proofs, delivery proofs, NPO payment slips. These are anonymously fetchable at guessable URLs **right now**.
- **Shareable content** — product/event/promotion/birthday **posters** and photos that get **pasted into WhatsApp messages as links** (recipients open them hours/days later).

You cannot just flip the bucket private: that kills every poster/photo render AND breaks WhatsApp sharing (signed URLs expire). And you cannot sign the posters: an expiring link in a WhatsApp message is dead by the time it's opened.

## The fix: two buckets
| Bucket | Visibility | Contents | Render method |
|---|---|---|---|
| `attachments` (existing) | **flip to Private** | ALL PII/proof | store PATH, render via signed URL (`resolveAttachmentSrc` / `data-attach-src` / `_openAttachment`) |
| `public-media` (**new**) | Public | posters + shareable photos | store public URL (durable), render/​share as public URL |

## Field-by-field split (from the 3 inventory passes)

### → PRIVATE (`attachments`), convert to signed URLs
| Field | Chunk | Upload | Render |
|---|---|---|---|
| order-form photos, invoices | activities / calendar / prospects | ✅ DONE | ✅ DONE |
| CPS form file (`cps_form_url`) | cps / prospects | ✅ DONE | ✅ DONE |
| case-study photos (`photo_urls`) | cases | ✅ DONE | ✅ DONE (was already) |
| customer payment proof (`purchases.proof`) | customers | ✅ DONE | ✅ DONE |
| meetup/attendee papers (`activities.photo_urls`, `event_attendees.photo_urls`) | activities 5279 / calendar 6662, 6884 | TODO path | activities 1261, calendar 7051 → data-attach-src / resolve |
| order-form-extract card photo (`file_url`) | activities (already path) | — | order-form-extract 683 → data-attach-src |
| delivery proof (`delivery_proof`) | prospects | TODO path | prospects render → _openAttachment |
| NPO payment slip (`slip_url`) | npo 1330 | TODO path | npo 1296 → _openAttachment |
| user avatar (`avatar_url`) ⚠ MIXED (path OR base64 data-URI) | marketing 5202 | TODO path (keep data-URI branch) | marketing 5124/5227 → branch data-URI vs resolve |

### → PUBLIC (`public-media`), keep durable public URLs — DO NOT sign
| Field | Chunk | Why public |
|---|---|---|
| `products.photo_url`, `products.poster_url` | marketing 1024/1030 | shown in lists; posters shareable |
| `events.poster_url` | marketing 1123 / activities 3080, 5101 | **pasted into WhatsApp** (calendar 2383) |
| `promotions.poster_url` | marketing 3380 | monthly-promo share |
| `birthday_poster_male/female_url` | marketing 2074 | **mobile-calendar prefetch + share** |
| APU `photo_url` (`apu_form` file_url) | (APU upload code) | **interpolated into WhatsApp body** (calendar 1115) |

### SKIP (no storage object)
- `contracts.signature_data_url` — base64 data-URI (canvas), never a storage URL.
- `activities.redemption_image_name` — a filename string, no file uploaded.
- `waze_link`, SVG initials avatars — external/generated.

## Refinements from the full (3-chunk) inventory
- **`apu_form.file_url` is a SPLIT-BRAIN field:** rendered in-app (prospects 4341, signed-OK) AND interpolated into a WhatsApp message body (calendar 1115, needs durable). It shares the `file_url` column + upload code with appraisal/evoucher (which are in-app-only). → Route by `attachment_type`: apu_form → public/durable; appraisal_form/evoucher → private/signed. Do NOT blanket-convert `file_url`.
- **`delivery_proof` is ALWAYS base64** (inline `readAsDataURL`, never a storage object) → SKIP; `data:` href already works. Privatizing it would first require making it a real upload (out of scope).
- **Also PII → private/signed** (from prospects/npo inventory): `activities.photo_urls` (prospects 4128 store / 4062 render), `evoucher_config.template_url` (4946), `attachment_data` STORAGE branch (5187/5239; base64 branch SKIP — renders 2901/3252/3661 → `_openAttachment` handles both), feng-shui audit files (`_uploadFengShuiToBucket` 5505; renders 3442 raw + photo-modals already done), `npo_installments.slip_url` (npo 1330 store / 1295 render — clean, no base64, no share).
- **Companion cleanup fixes required** if `file_url`/`template_url` become paths: `extractAttachmentPath(x)` (regex matches public URLs only) returns null for a bare path → storage-delete silently skips. Add `|| x` fallback at prospects 4800 (`removeEvoucher`) and 4963 (`saveEvoucherTemplate`).
- **Already-done (verified, no work):** invoice_file, cps_form_url, case-study photos, customer proof, evoucher/appraisal/apu/fengshui-photo *renders*, template_url consume/preview, activity upload-modal preview. A prior private-bucket pipeline pass (2026-04-24) converted many renders already.
- **No WhatsApp hazard in prospects/npo** — every share/download there resolves to a signed URL and fetches to a Blob immediately, or shares a cached Blob; captions carry the file, not a URL. The ONLY durable-URL requirements are marketing posters + calendar 1115/2383 (events poster + apu photo).
- **Modal auto-resolve caveat:** the `data-attach-src` observer watches `#content-viewport` + `#mobile-drawer`; modal previews outside those need an explicit `window._resolveAttachmentImages()` after `UI.showModal` (some chunks already do this; prospects does not).

## Cross-chunk lockstep hazards
- **Poster relocation must move WITH the WhatsApp-share code** (calendar 2383, 1115; mobile-calendar birthday prefetch). If posters move to `public-media` but the share code still reads `attachments` public URLs, sharing breaks. Change both in one deploy.
- **React islands** (`src/react/*`) receive raw poster/photo URLs from marketing (payload keys `posterUrl`, `birthdayPosters`, product/event rows at marketing 127/342/1354/1526/1596). If those fields become paths, the island must resolve them — but per the split, posters stay public URLs, so the islands are unaffected **as long as posters stay public**. Only avatar/photo fields that go private need island updates.
- **Modal-scope renders** (marketing 863/868/892/1202/3166, calendar 7051, fude 599): the `data-attach-src` DOM auto-resolver only fires inside `#content-viewport`. Modal previews must call `await AppDataStore.resolveAttachmentSrc(value)` and set `src` imperatively instead.

## Migration steps & ownership
1. **[USER]** Create the `public-media` bucket (Public) with an authenticated-write / public-read policy. *(bucket + policy = access-control; user-executed.)*
2. **[CLAUDE]** Frontend: repoint poster/photo uploads → `public-media` (store public URL); convert remaining PII uploads → path + signed-URL renders; update the mobile-calendar share code in lockstep. Build + deploy.
3. **[CLAUDE + browser]** Verify each feature renders in the live app (upload a photo, view each gallery/poster, trigger a WhatsApp share) before proceeding.
4. **[USER / script]** Migrate existing objects: copy poster objects (`products/`, `events/poster/`, `promotions/`, birthday posters, avatars-if-public) from `attachments` → `public-media`; leave PII objects in `attachments`. Backfill any DB rows whose stored URL points at the old bucket.
5. **[USER]** Flip `attachments` to Private. *(access-control; user-executed.)*
6. **[CLAUDE + browser]** Post-flip smoke test: every PII render (signed) still works; every poster/share (public) still works.

## Already shipped toward this
- Closing-path + case-study + CPS + customer-proof conversions are LIVE (`2d77bfb`, `1a05990`, `2d8f330`). They store paths and render via signed URLs, which work on the current public bucket and are ready for the private flip.

## Recommendation
This is a **phased, collaborative migration**, not a one-shot. The safe order is: (1) you create `public-media`; (2) I do all remaining frontend + the lockstep share-code changes and we browser-verify; (3) you run the object migration; (4) you flip `attachments` private; (5) we smoke-test. The independent, high-value **`prospects_approval_guard` migration (C1 self-approval fix)** has nothing to do with buckets and should be applied now regardless.
