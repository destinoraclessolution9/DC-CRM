-- Customer/prospect conversion audit remediation — 2026-08-05
--
-- Two independent defects, both found while auditing the 149-row customer list
-- against the prospects table.
--
-- ============================================================================
-- DEFECT 1 — six columns the conversion path writes but `customers` never had
-- ============================================================================
-- approveProspectConversion() (chunks/script-approvals.js:~735-765) builds a
-- customer payload with 28 fields. SIX of them do not exist on public.customers:
--
--     referred_by, referred_by_id, referred_by_type, referral_relationship,
--     approved_by, approved_at
--
-- AppDataStore.create() swallows the 42703 unknown-column error, strips the
-- offending field and retries — so the INSERT succeeds, the manager sees
-- "Customer created", and the referral attribution + approval audit trail are
-- silently discarded. Same failure mode as the potential/opportunity columns
-- (migrations/potential_opportunity_columns_2026-07-29.sql) and life_chart_type
-- (migrations/basic_info_missing_columns_2026-07-20.sql).
--
-- Visible symptom: the customer profile's "Referred By" row
-- (chunks/script-customers.js:918 and :1162) renders "-" for all 149 customers,
-- because customer.referred_by has never been a real column. The referrer IS
-- known — it sits on the source prospect row — it just never crossed over.
--
-- Types mirror public.prospects exactly (text / bigint, nullable, no FK —
-- prospects.referred_by_id carries no FK constraint either, because a referrer
-- can be a user, a customer or a prospect and referred_by_type disambiguates).
--
-- `customers` has NO entry in data.js `_lightSelects`, so customer reads already
-- send select=* — no client-side allowlist update is needed for these to appear.
--
-- ============================================================================
-- DEFECT 2 — four customers still showing as OPEN prospects
-- ============================================================================
-- getActiveProspects() (data.js:3391) excludes status 'converted' and 'lost' but
-- deliberately KEEPS NULL status ("never-classified → kept"). Four people who are
-- customers therefore still appear in the active prospect list, and are double
-- counted in prospect KPIs, re-engagement queues and birthday dispatchers:
--
--   1777790563204  Nelly Wong Sze Ching   status NULL      own linked prospect
--   1780893248547  TEOH WAI KHIN          status 'active'  own linked prospect
--   1781357679358  CHIA SHUK SHIN         status 'active'  DUPLICATE of customer
--                                                          1784860456000507
--                                                          "Susie Chia Shuk Shin"
--   1780453859786  SABRINA CHONG KAI QI   status 'active'  DUPLICATE of customer
--                                                          1784860456000512
--                                                          "Sabrina Chong"
--
-- The two duplicates arose from the 2026-07-24 02:34 customer import: it created
-- a fresh stub prospect per customer (status='converted') rather than matching
-- the person's existing prospect record, leaving the original profile open.
--
-- Verified before writing: all four rows carry ZERO activities, purchases, notes,
-- cps_analyses and closing records, so closing them destroys no history. (Nelly
-- and Teoh have 1 and 2 prospect_attachments respectively — those stay on the
-- same row, which remains the customer's linked prospect.)
--
-- Deliberately NOT doing here:
--   * No DELETE of the two import stubs. 25 tables carry an FK to prospects;
--     removing rows to tidy a display issue is not worth that blast radius.
--     Marking the duplicate 'converted' is factually true — that person IS a
--     customer — and is all getActiveProspects needs to stop listing them.
--   * No re-point of customers.converted_from_prospect_id. Either way one of the
--     two rows ends up without a customer pointing at it; churning a live FK buys
--     nothing and risks the cached-snapshot paths.
--   * No rename of customer 1784860456000512 "Sabrina Chong" to the fuller legal
--     "SABRINA CHONG KAI QI" from the duplicate — display names are the owner's
--     call. The IC and DOB from that record ARE merged up (below), since the
--     customer row had neither.
--
-- Idempotent: every statement is IF NOT EXISTS / guarded by a WHERE that stops
-- matching once applied. Safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- PART A — add the six missing columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS referred_by           TEXT,
    ADD COLUMN IF NOT EXISTS referred_by_id        BIGINT,
    ADD COLUMN IF NOT EXISTS referred_by_type      TEXT,
    ADD COLUMN IF NOT EXISTS referral_relationship TEXT,
    ADD COLUMN IF NOT EXISTS approved_by           BIGINT,
    ADD COLUMN IF NOT EXISTS approved_at           TIMESTAMPTZ;

COMMENT ON COLUMN public.customers.referred_by IS
    'Referrer display name, copied from the source prospect at conversion. Rendered by the customer profile "Referred By" row.';
COMMENT ON COLUMN public.customers.referred_by_id IS
    'Referrer row id. No FK: the referrer may be a user, customer or prospect — referred_by_type disambiguates. Mirrors prospects.referred_by_id.';
COMMENT ON COLUMN public.customers.referred_by_type IS
    'Which table referred_by_id points at (agent / customer / prospect).';
COMMENT ON COLUMN public.customers.approved_by IS
    'users.id of the manager who approved the prospect→customer conversion.';
COMMENT ON COLUMN public.customers.approved_at IS
    'When the conversion was approved.';

-- ---------------------------------------------------------------------------
-- PART B — backfill referral attribution from each customer's source prospect
--          (this is exactly what the conversion payload always intended to write)
-- ---------------------------------------------------------------------------
UPDATE public.customers c
SET referred_by           = NULLIF(p.referred_by, ''),
    referred_by_id        = p.referred_by_id,
    referred_by_type      = NULLIF(p.referred_by_type, ''),
    referral_relationship = NULLIF(p.referral_relationship, '')
FROM public.prospects p
WHERE p.id = c.converted_from_prospect_id
  AND c.referred_by IS NULL
  AND c.referred_by_id IS NULL
  AND c.referred_by_type IS NULL
  AND c.referral_relationship IS NULL
  AND ( NULLIF(p.referred_by, '')           IS NOT NULL
     OR p.referred_by_id                    IS NOT NULL
     OR NULLIF(p.referred_by_type, '')      IS NOT NULL
     OR NULLIF(p.referral_relationship, '') IS NOT NULL );

-- Backfill the approval trail where approval_queue still holds it (10 rows).
UPDATE public.customers c
SET approved_by = q.reviewed_by,
    approved_at = q.reviewed_at
FROM public.approval_queue q
WHERE q.prospect_id   = c.converted_from_prospect_id
  AND q.approval_type = 'new_customer'
  AND q.status        = 'approved'
  AND q.reviewed_by IS NOT NULL
  AND c.approved_by IS NULL;

-- ---------------------------------------------------------------------------
-- PART C — close the four prospect profiles that belong to existing customers
-- ---------------------------------------------------------------------------

-- C1 + C2: own linked prospect never got the converted flag.
UPDATE public.prospects
SET status            = 'converted',
    conversion_status = 'approved',
    updated_at        = NOW()
WHERE id IN (1777790563204,   -- Nelly Wong Sze Ching  (was NULL)
             1780893248547)   -- TEOH WAI KHIN         (was 'active')
  AND status IS DISTINCT FROM 'converted';

-- C3 + C4: duplicate profile of a person who is already a customer.
UPDATE public.prospects
SET status            = 'converted',
    conversion_status = 'approved',
    revive_notes      = COALESCE(revive_notes || E'\n', '')
                        || 'Duplicate profile — this person is already customer '
                        || CASE id WHEN 1781357679358 THEN '1784860456000507 (Susie Chia Shuk Shin)'
                                   WHEN 1780453859786 THEN '1784860456000512 (Sabrina Chong)' END
                        || '. Closed 2026-08-05 by the customer/prospect audit.',
    updated_at        = NOW()
WHERE id IN (1781357679358,   -- CHIA SHUK SHIN
             1780453859786)   -- SABRINA CHONG KAI QI
  AND status IS DISTINCT FROM 'converted';

-- C4b: the duplicate carried an IC and DOB the customer row was missing —
-- merge them up rather than losing them behind a closed profile.
UPDATE public.customers c
SET ic_number     = COALESCE(NULLIF(c.ic_number, ''), p.ic_number),
    date_of_birth = COALESCE(c.date_of_birth, p.date_of_birth)
FROM public.prospects p
WHERE p.id = 1780453859786
  AND c.id = 1784860456000512
  AND (NULLIF(c.ic_number, '') IS NULL OR c.date_of_birth IS NULL);

-- ---------------------------------------------------------------------------
-- PART D — bump updated_at so the backfill actually reaches cached clients
-- ---------------------------------------------------------------------------
-- data.js:1521 revalidates a cached table snapshot with `.gte('updated_at', sinceISO)`.
-- `customers` has NO updated_at trigger (verified: 0 non-internal triggers), so the
-- Part B/C4b UPDATEs above left updated_at frozen at 2026-07-24 02:34 — every client
-- holding an SWR snapshot would keep serving rows without the new columns and the
-- delta poll would never fetch them. Bumping the touched rows makes the next delta
-- pick them up.
--
-- Idempotent via the timestamp guard: after this runs the rows sit at NOW(), which
-- is past the literal, so a re-run matches nothing.
UPDATE public.customers
SET updated_at = NOW()
WHERE updated_at < TIMESTAMPTZ '2026-08-05 00:00:00+00'
  AND ( referred_by           IS NOT NULL
     OR referred_by_id        IS NOT NULL
     OR referred_by_type      IS NOT NULL
     OR referral_relationship IS NOT NULL
     OR approved_by           IS NOT NULL );

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFY (run after commit — all checks must come back clean)
-- ---------------------------------------------------------------------------
-- 5) cached clients can see the backfill — expect max(updated_at) = today
--
-- SELECT max(updated_at) FROM customers;
--
-- 1) no customer left with an open prospect profile — expect 0 rows
--
-- SELECT c.id, c.full_name, p.id AS open_prospect, p.status
-- FROM customers c JOIN prospects p ON p.id = c.converted_from_prospect_id
-- WHERE p.status IS DISTINCT FROM 'converted';
--
-- 2) the two duplicates are closed — expect status='converted' on both
--
-- SELECT id, full_name, status FROM prospects
-- WHERE id IN (1781357679358, 1780453859786, 1777790563204, 1780893248547);
--
-- 3) referral attribution landed — expect a non-zero count
--
-- SELECT count(*) FILTER (WHERE referred_by IS NOT NULL)      AS with_referrer,
--        count(*) FILTER (WHERE approved_by IS NOT NULL)      AS with_approver,
--        count(*)                                             AS total
-- FROM customers;
--
-- 4) Sabrina's IC/DOB merged up
--
-- SELECT id, full_name, ic_number, date_of_birth FROM customers WHERE id = 1784860456000512;
