# Sales-Closing Pipeline Audit — 2026-07-13

Scope: the Meeting Outcome / sales-closing money path and its OCR/invoice/approval
surrounds, plus a regression sweep of the ~25 commits since the 2026-07-04 re-audit.
Tip audited: `df392ac` (my date fix `3fe196b` + a concurrent reporting-dedup commit).
Four parallel audit lanes; every finding below cross-checked against the un-minified
source. "Verified" = I re-read the exact code/policy proving it.

Trigger for this audit was a real bug an agent hit — saving a closing failed with
`invalid input syntax for type date: ""`. That specific bug is **already fixed and
live** (`3fe196b`): blank Collection/Order Date and POP fields now coerce `'' → null`.
Everything below is *additional* and pre-existing; none of it was introduced today.

---

## CRITICAL

### C1 — Manager-approval gate on the money path is client-side only (self-approval + self-inflated LTV)
- **Where:** `chunks/script-approvals.js:489` (`isManagement(_state.cu)` is the only gate on approve/convert); `migrations/sec_2026-06-19_writes.sql:22-40` (prospects UPDATE RLS scopes by row-ownership, **no column guard**); `migrations/adjust_customer_ltv_2026-06-19.sql:26-38` (SECURITY INVOKER).
- **Defect:** There is a `users_guard` trigger protecting privileged columns on `users`, but **no equivalent on `prospects`/`customers`**. An agent who owns a prospect can write any column.
- **Exploit:** From the browser console, an L3–L12 agent runs `AppDataStore.update('prospects', ownId, {status:'converted', conversion_status:'approved', closing_record:{…}})`, inserts a `customers` row they own (`customers` INSERT is `with check(true)`), then calls `adjust_customer_ltv(ownCustomer, 999999, 1)` — self-approving a sale and inflating their own lifetime-value / leaderboard / commission KPI with no manager in the loop.
- **Confidence:** Verified (read all four policy/code sites). Insider-console vector, not UI-reachable. Pre-existing since 2026-06-19.
- **Fix:** Add a `prospects` column-guard trigger mirroring `users_guard` — transitions of `status` / `conversion_status` / `closing_records_history` (and locking of `closing_record`) require `current_user_level() <= 4`. Server must own the approval gate.

### C2 — Order-form / invoice PII served via public storage URLs (NRIC, DOB, card data)
- **Where:** `chunks/script-activities.js:2135` (`getPublicUrl`), `:2176` (stores the public URL in `prospect_attachments.file_url`), raw `<img src>` at `:2295/:2463/:2480`; `chunks/script-calendar.js:6184` (invoice). Bucket history: `migrations/attachments_bucket_private_2026-04-24.sql`; cross-read policy `attachments_authenticated_select` (bucket-wide).
- **Defect:** This feature bypasses the app's private-bucket pipeline (paths + `resolveAttachmentSrc` + 1-hour signed URLs that CPS/case-study/meet-up photos use). It stores and renders **public** URLs. Order forms carry NRIC, DOB, address, phone, and card holder/last4/bank/expiry.
- **Exploit:** If the bucket is public (which the feature *rendering at all* via `/object/public/...` implies), every order form is anonymously fetchable at a guessable URL (`order_forms/{prospectId}_{ms}_{type}_{filename}` — sequential id + ms timestamp + predictable camera filename). Even if the bucket is private, `attachments_authenticated_select` grants **every** logged-in agent read of **every** other agent's attachments.
- **Confidence:** Code divergence Verified. The live `storage.buckets.public` flag is the one thing not readable from the repo — **check it in the Supabase dashboard**; if `true`, this is an active PII leak.
- **Fix:** Store paths (not URLs) for order forms + invoices, render through `resolveAttachmentSrc`; scope `attachments_authenticated_select` to owner/visible-agent instead of bucket-wide; confirm bucket `public = false`.

---

## HIGH

### H1 — Duplicate NPO order (+ double PORT KPI) when the closing-record write fails after the sale insert
- **Where:** `chunks/script-calendar.js:6326` (idempotency guard reads `!newCR.npo_sale_id`), `:6363` (`npo_sales` insert + up-to-600 installments), `:6409` (prospect `closing_record` persist that carries the stamped `npo_sale_id`).
- **Defect:** The sale is inserted and `npo_sale_id` stamped *in memory* before the prospect update. If that update throws (e.g. RLS drift 42501 — `data.js` rethrows permanent errors), the stamp is lost but the `npo_sales` + schedule rows already exist. The toast says "retry"; the retry sees `npo_sale_id:null` and creates a **second** sale + full schedule. PORT double-counts.
- **Confidence:** Verified.
- **Fix:** Create the NPO order *after* the closing-record persist succeeds, or stamp+persist `npo_sale_id` in the same transaction/RPC; on retry, look up existing sale by prospect before inserting.

### H2 — No double-submit lock on `saveMeetingOutcome`
- **Where:** `chunks/script-calendar.js:6080+` (no in-flight lock, no Save-button disable — unlike `savePostMeetupNotes` and `approveClosingRecord`'s `_convInFlight`).
- **Defect:** A mobile double-tap runs the whole flow twice concurrently; both reads see `status:'draft'` / `npo_sale_id:null` → duplicate `npo_sales` orders **and** duplicate `approval_queue` entries.
- **Confidence:** Verified (guard absent).
- **Fix:** Disable Save on click + take a per-activity in-flight lock (reuse the `_convInFlight` pattern).

### H3 — NPO closings keyed on the DC Closing Record tab never materialise an NPO order
- **Where:** `chunks/script-prospects.js:3049-3056` (form has no tier/first-payment/monthly/tenure inputs), `:5929-5958` (`saveClosingRecord`), `chunks/script-approvals.js:484-560` (approval).
- **Defect:** Only the calendar `saveMeetingOutcome` path creates `npo_sales`/`items`/`installments`. A deal keyed on the profile tab is approved and books a `purchases` row but is **permanently absent** from the NPO Orders tab / PORT KPI, with no warning.
- **Confidence:** Verified by the closing-lane agent (path comparison).
- **Fix:** Route the DC-tab NPO save through the same order-materialisation, or block NPO method there and direct users to the Meeting Outcome flow.

### H4 — Order-form OCR outage hard-blocks every first-time closing
- **Where:** `chunks/script-activities.js:2152-2156` (OCR call throws on any error) executes **before** `:2173` (the `prospect_attachments` insert); gate at `chunks/script-calendar.js:6155`.
- **Defect:** If the `order-form-ocr` edge function is down, the code throws before the attachment row is created → no thumbnail → `hasOrderFormPhoto` false → the required-photo gate rejects the save. Agents cannot record a sale while OCR is unavailable. (The photo has already uploaded to storage — an orphan.)
- **Confidence:** Verified (code ordering).
- **Fix:** Persist the `prospect_attachments` row on successful *upload*, independent of OCR success; let OCR auto-fill be best-effort. Clean up storage on abort.

### H5 — OCR payment-type misclassification silently changes money flow
- **Where:** `chunks/script-activities.js:2049-2059` (`_mapPaymentToClosingValue`).
- **Defect:** A plain installment ("POP") is only detected when text contains "standing"; otherwise a `payment_type` like "Credit Card" maps to the lump-sum `Credit Card` method. If the `fill_pop` amount rows aren't ticked, a POP installment is recorded as a one-shot Credit Card sale — POP/NPO conditional blocks stay hidden, no installment schedule is created.
- **Confidence:** Verified (logic).
- **Fix:** Treat any populated installment field as POP; make the mapping conservative and surface the chosen method for confirmation.

### H6 — `_fuzzyMatchProduct` bidirectional substring match selects the wrong product
- **Where:** `chunks/script-activities.js:2088` (`val.includes(target) || target.includes(val)`, first match wins, no scoring).
- **Defect:** Scanned "Authority Power Ring 2026" with a generic "Power Ring" option ordered first → the generic option wins via `target.includes(val)` and is recorded as the product sold. Short option values ("Ring") match almost anything.
- **Confidence:** Verified.
- **Fix:** Rank by match length / exact-then-prefix-then-contains; require a minimum score or leave unselected for the agent to pick.

---

## MEDIUM

- **M1 — Stale photo satisfies the "photo required" gate.** `chunks/script-activities.js:2476` queries *all* order-form attachments for the prospect (no activity/closing filter); `:2505` counts DOM thumbs. Any repeat closing auto-passes with an earlier sale's photo. *Verified.*
- **M2 — Auto-submit bypasses the invoice-file gate and locks the record.** `chunks/script-calendar.js:6315-6321` requires only full_name+product+amount+invoice_number; manual submit requires `invoice_file`. A closing can auto-submit + lock (`status:'submitted'`) with no invoice, and the read-only submitted view offers no upload control. *Verified by closing lane.*
- **M3 — `closing_record` lock is UI-only (submitted record editable).** `chunks/script-prospects.js:5935` (`saveClosingRecord` forces `status:'draft'` unconditionally) and `migrations/set_closing_record_field_2026-07-04.sql:14-19` (RPC has no status predicate). A stale tab or the RPC can mutate a submitted record around the manager's review snapshot. *Verified.* (Same root as C1 — server-side status guard.)
- **M4 — Locked-record check reads a possibly-stale cached prospect.** `chunks/script-calendar.js:6262-6265` uses `getById` (SWR cache) without awaiting revalidation; a record submitted/approved on another device still reads `draft` here → overwrite+re-submit runs against a locked record. *Plausible; path verified.*
- **M5 — `fill`-strategy scan overwrites user-corrected Amount/Order Date.** `chunks/script-activities.js:2252` pre-ticks conflict rows for `fill` fields (`:2037,2039`); applying the scan replaces a hand-corrected Amount Closed. *Verified.*
- **M6 — Base64 invoice fallback bloats the prospect row.** `chunks/script-calendar.js:6187-6195` embeds an up-to-~10 MB data-URI into `closing_record` JSONB when storage is down; re-sent on every prospect update, poisons SWR/delta-sync. No size guard (unlike the 8 MB image guard). *Verified.*
- **M7 — Auto-submit re-converts already-converted prospects.** `chunks/script-calendar.js:6407-6411` guards only on `saleAmount >= 2000` (manual path checks `isAlreadyConverted`); a repeat ≥RM2,000 closing flips a converted prospect back to `pending_approval` and files a duplicate `new_customer` entry. *Verified by closing lane.*
- **M8 — `approval_queue` insert may be admin-only per repo policy.** `migrations/rls_replace_allow_all_2026-04-24.sql:18,32-38` puts it in `admin_only_tables` (`check level<=2`); agents insert at `script-prospects.js:6040` / `script-approvals.js:600` inside `console.warn`-only try/catch. If the repo reflects live, agent submissions silently never reach the queue. *Repo policy verified; live state unconfirmed — the feature appears to work, so the live policy may be looser. **Check.***
- **M9 — Edge function has no rate limiting.** `supabase/functions/order-form-ocr/index.ts` — any authenticated user (any role) can invoke unbounded 8 MB Gemini vision calls. Cost/quota-drain vector. *Verified (no limiter).*
- **M10 — Mobile Home agenda can print peer clients' names/notes.** `chunks/script-mobile.js:1120,1358` build the row subtitle with no `_mcalOwned`/`_canViewEntityName` gate; `fcfa2b5` removed the client-side scope clamp, so RLS now feeds same-team `closed`-visibility rows. Name exposure needs prospect-RLS visibility, but the `a.notes` fallback renders unconditionally. Desktop/month views mask these. *Verified (code path).*
- **M11 — Success Case Library search de-anonymises.** `chunks/script-cases.js:283-291` searches the hidden prospect/customer `full_name`; typing a name filters to their case (invitation story, method, profile, amount) and enables "is X a client?" enumeration. *Verified at HEAD.*

---

## LOW

- **L1 — Card last4/holder/bank persisted in `prospect_attachments.metadata`.** `chunks/script-activities.js:2427-2436` re-writes the full `fields` object (incl. `card_last4`, `card_issuing_bank`) on every apply — contradicts the "expiry only, never PAN/CVV" posture. *Verified.* Redact card fields before persisting metadata.
- **L2 — Locked closing record does not lock the activity's money fields.** `saveMeetingOutcome` still writes `amount_closed`/`closing_amount` to the activity row before the lock check; an agent can change the closed amount feeding badges/filters after approval. *Verified.*
- **L3 — CORS `*` on the PII OCR endpoint** (`index.ts:27-31`) deployed `--no-verify-jwt`; widens token-replay surface. No SSRF/path-traversal (base64-only input — that part is clean).
- **L4 — `image/*` accepted client-side, edge rejects non-jpeg/png/webp** (`:2099` vs `index.ts:313`) — HEIC from iPhone uploads to storage then fails at OCR, leaving an orphan (compounds H4).
- **L5 — 主讲老师 role no longer mirrors to `events.speaker`** (`set_event_session_role` dropped the sync) → stale noticeboard speaker; orphaned `set_event_role_name` RPC still lets any authenticated user overwrite `events.speaker`. *Verified regression.*
- **L6 — People Met undercounts prospects who later converted** (`chunks/script-reporting.js:2019` `continue`s instead of reattributing to Customers). Report-accuracy only. *Verified.*
- **L7 — `scanInvoiceWithAI` loads Tesseract from unpkg `@4` float tag at runtime** (`:1825`) — supply-chain + CSP risk over PII images.
- **L8 — Stale NPO artifacts when a draft changes after order creation** (`chunks/script-calendar.js:6284-6292`) — switching NPO→Cash or re-keying terms leaves the old `npo_sales`+schedule active; no update/cancel path.
- **L9 — Legacy hidden Add-Activity closing block** (`chunks/script-activities.js:216-292`, `display:none`) has no amount/photo/approval guards; currently unreachable but a latent trap if re-enabled. Its `''→null` coercions are correctly handled.

---

## Verified clean
- Session/cache cluster (`6cc5071/292e5d6/3e55149/7da89c6/2865688/0eff6e2`): no purge-loop, boot-gate timeout detection matches only the self-injected error, `_mcalTrust`/`_degraded` consistent. (`mhome` snapshot lacks the `_mcalTrust` guard — L-tier, day-scoped, self-healing.)
- `/diag.html`: runs under the viewer's own session, masked output — no unauthenticated leak.
- KPI cards `5c659c6`+`df392ac`: standard `_visibleUserIds`/role scope; dual-record dedup fixed.
- Promo `b52e029`/`ddb9561`: `agent_note` stripped for customer audience; customer-share path deleted — no leak.
- Daily-note rotation `100c3db`: null-guarded modulo — no index bug.
- No remaining `'' → typed-column` writes in the closing path (the `3fe196b` `_orNull` fix covers them; JSONB and regex-gated paths are safe).
- Edge-function output parsing: try/catch, no stack-trace leak, MIME allow-list + 8 MB cap server-side, auth required. No SSRF.
- Cross-chunk wiring for the mo/npo builders + pickers is fully exported with lazy stubs.

---

## Recommended fix order
1. **C2** — confirm the `attachments` bucket `public` flag today; if public, it's an active PII leak. Then move order-form/invoice to the signed-URL pipeline and owner-scope the read policy.
2. **C1 / M3** — add a `prospects` column-guard trigger so approval/conversion/closing-lock transitions require L≤4 server-side. Closes the self-approve, self-LTV, and submitted-record-edit holes at once.
3. **H1 / H2** — order the NPO insert after the closing persist + add the double-submit lock (stops duplicate money rows).
4. **H4** — decouple the required-photo record from OCR success (restores closings during OCR downtime).
5. **H3 / H5 / H6** — NPO-order materialisation from the DC tab, conservative payment mapping, ranked product match.
6. Medium/Low as capacity allows; **M8** needs a live-policy check.
