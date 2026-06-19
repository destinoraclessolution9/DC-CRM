# Deep Audit — Server-side / DB Follow-ups (owner decision required)

The deep line-by-line audit's **427 client-side findings are all fixed + deployed**
(commits ff85a95 → 1374bcb). The items below were flagged by the fix/review agents
as needing **Supabase / DB access or edge-function deployment** — they are *not*
client code and were intentionally left out of the code waves. Each is a deliberate
decision for you.

## 1. Edge-function deployment (required for those fixes to take effect)
The 7 edited edge functions are committed but **not deployed by the Vercel push** —
deploy them via the Supabase CLI (`supabase functions deploy <name> --use-api`):
`admin-auth-ops`, `send-2fa-sms`, `send-activity-reminders`, `send-journey-whatsapp`,
`notify-on-activity`, `order-form-ocr`, `send-activity-push`.

## 2. Authorization — server enforcement (client guards are defense-in-depth only)
- **Manager-approval (HIGH).** `approveQueueEntry`/`approveClosingRecord`/
  `approveProspectConversion` now have client `isManagement` gates, but a self-approving
  agent owns the prospects/customers/purchases rows, so RLS does not stop a direct
  API/console call. Add an RLS policy or `SECURITY DEFINER` RPC that checks the
  *caller's* role (`auth.uid()` → `users.role` level ≤ 4) before the status→approved
  write + purchases insert.
- **Redemption balance (fude).** Client now re-derives the balance + blocks pending
  double-spend, but the authoritative check belongs server-side: an RPC that re-derives
  `SUM(fudi_points)`, rejects `pts > available_after_pending`, and debits/escrows on
  request. Also harden `redemption_requests` RLS SELECT from `using(true)` → own-row-or-admin.
- **contracts / portal_sessions / document_shares / org_consultations** — add per-row
  RLS so the new client role-gates can't be bypassed via the API.

## 3. Schema fixes (migrations)
- **journey_touchpoints.assigned_to UUID↔bigint mismatch (HIGH).** The column is `UUID
  REFERENCES auth.users` but the app uses the bigint `public.users.id`. `data.js` now
  defensively skips stamping a non-UUID id (no more 22P02 crash), but per-agent journey
  queues stay empty until the column is `BIGINT REFERENCES public.users(id)` (+ rebuild
  `agent_journey_load`). Same for `escalates_to` / `completed_by`.
- **push_subscriptions.endpoint UNIQUE.** `push-notifications.js` upserts
  `onConflict:'endpoint'`; live has the table (dashboard-created) but no committed DDL —
  add `CREATE TABLE IF NOT EXISTS … UNIQUE(endpoint)` for version control + new envs.
- **mfa_sms_codes + verify-2fa-sms.** `send-2fa-sms` now persists a salted code
  server-side; for the SMS-2FA factor to be *trustworthy* (not just consistent) it needs
  (a) the `mfa_sms_codes` table and (b) a companion `verify-2fa-sms` edge function doing
  the server-side compare. Until then, two-factor.js does a client-side salted compare
  (now consistent with the server hash, but still a stopgap).
- **daily_summary_log** — migration is committed (`migrations/daily_summary_log_2026-06-20.sql`);
  apply it when deploying `send-activity-reminders` (the function degrades gracefully if absent).

## 4. Optional hardening (nice-to-have)
- `fp_pos_transactions` / `fp_refunds` UNIQUE(purchase_number, sku_id, date) for
  authoritative POS-import dedup (client Set guards the common re-import case only).
- `fp_po_items.free_quantity` column so Buy-X-Get-Y free goods round-trip.
- `org_consultations.paid_by` column (markOrgConsultationPaid writes it; auto-stripped if absent).
- A server-side atomic score RPC (`UPDATE prospects SET score = GREATEST(0, score+Δ) RETURNING`,
  mirroring `adjust_customer_ltv`) for fully multi-client-safe scoring; client serialization
  is in place now.
- `purchases.prospect_id` column + backfill (the prospect "Sales Orders" tab now resolves
  via the converted customer, so this is cleanliness only).
- `AppDataStore.update` optimistic-concurrency (version/updated_at guard) for the few
  read-modify-write paths that still race under heavy concurrency.

## 5. Compute (standing item from prior audits)
The NANO Supabase tier remains the top scale lever; a compute upgrade is owner-billed.
