-- =============================================================================
-- Formula Healthcare Product — Auto Refill Reminder System
-- =============================================================================
-- Reads from the 'formula' Marketing List table (NOT the generic 'products' table).
-- Already applied to project remuwhxvzkzjtgbzqjaa on 2026-04-12 via Management API.
--
-- HOW TO RUN (if setting up a new project):
-- 1. (One-time) Supabase Dashboard → Database → Extensions → enable "pg_cron"
-- 2. Supabase Dashboard → SQL Editor → New query → paste this file → Run
--
-- SAFETY: Every statement is idempotent and safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. formula table (if missing) + healthcare reminder fields
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS formula (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  functions TEXT,
  pills_bottles TEXT,
  price NUMERIC,
  delivery_lead_time TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_by BIGINT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE formula ADD COLUMN IF NOT EXISTS capsules_per_bottle INTEGER;
ALTER TABLE formula ADD COLUMN IF NOT EXISTS daily_dosage NUMERIC(5,2);
ALTER TABLE formula ADD COLUMN IF NOT EXISTS reminder_lead_days INTEGER DEFAULT 3;
ALTER TABLE formula ADD COLUMN IF NOT EXISTS reminder_buffer_percent NUMERIC(4,2) DEFAULT 0.10;


-- -----------------------------------------------------------------------------
-- 2. refill_reminders table (populated by pg_cron + on-save RPC)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refill_reminders (
  id                      BIGSERIAL PRIMARY KEY,
  prospect_id             BIGINT,
  customer_id             BIGINT,
  product_id              BIGINT,
  product_name            TEXT NOT NULL,
  purchase_index          INTEGER NOT NULL,
  purchase_date           DATE,
  estimated_finish_date   DATE NOT NULL,
  days_until_finish       INTEGER NOT NULL,
  reminder_type           TEXT NOT NULL DEFAULT 'due_soon',   -- 'due_soon' | 'overdue'
  status                  TEXT NOT NULL DEFAULT 'pending',    -- 'pending' | 'whatsapp_sent' | 'dismissed'
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS refill_reminders_unique_key
  ON refill_reminders (
    COALESCE(prospect_id, 0),
    COALESCE(customer_id, 0),
    COALESCE(product_id, 0),
    product_name,
    purchase_index
  );

CREATE INDEX IF NOT EXISTS idx_refill_reminders_status_date
  ON refill_reminders(status, estimated_finish_date);

CREATE INDEX IF NOT EXISTS idx_refill_reminders_prospect
  ON refill_reminders(prospect_id) WHERE prospect_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refill_reminders_customer
  ON refill_reminders(customer_id) WHERE customer_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. compute_refill_reminders() stored function
--    Sweeps prospects only (customers table has no closing_record in this project).
--    Reads reminder_lead_days from the 'formula' table.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_refill_reminders()
RETURNS void
LANGUAGE plpgsql
AS $func$
DECLARE
  rec RECORD;
  purchase JSONB;
  idx INTEGER;
  p_lead_days INTEGER;
  p_finish DATE;
  p_days_left INTEGER;
  p_reminder_type TEXT;
  p_product_id BIGINT;
  p_product_name TEXT;
  p_purchase_date DATE;
BEGIN
  FOR rec IN
    SELECT id AS entity_id,
           'prospect'::TEXT AS entity_kind,
           closing_record->'formula_healthcare_purchases' AS purchases
    FROM prospects
    WHERE closing_record IS NOT NULL
      AND closing_record ? 'formula_healthcare_purchases'
      AND jsonb_typeof(closing_record->'formula_healthcare_purchases') = 'array'
      AND jsonb_array_length(closing_record->'formula_healthcare_purchases') > 0
  LOOP
    idx := 0;
    FOR purchase IN SELECT * FROM jsonb_array_elements(rec.purchases) LOOP
      BEGIN
        IF purchase->>'reminder_dismissed_at' IS NOT NULL
           OR purchase->>'estimated_finish_date' IS NULL
           OR purchase->>'estimated_finish_date' = '' THEN
          idx := idx + 1;
          CONTINUE;
        END IF;

        p_finish := (purchase->>'estimated_finish_date')::DATE;
        p_product_name := COALESCE(purchase->>'product', '');
        p_product_id := NULLIF(purchase->>'product_id', '')::BIGINT;
        p_purchase_date := NULLIF(purchase->>'purchase_date', '')::DATE;

        p_lead_days := NULL;
        IF p_product_id IS NOT NULL THEN
          SELECT COALESCE(reminder_lead_days, 3) INTO p_lead_days
          FROM formula WHERE id = p_product_id;
        END IF;
        IF p_lead_days IS NULL THEN p_lead_days := 3; END IF;

        p_days_left := p_finish - CURRENT_DATE;

        IF p_days_left <= (p_lead_days + 7) THEN
          p_reminder_type := CASE
            WHEN p_days_left < 0 THEN 'overdue'
            ELSE 'due_soon'
          END;

          INSERT INTO refill_reminders (
            prospect_id, customer_id, product_id, product_name,
            purchase_index, purchase_date, estimated_finish_date,
            days_until_finish, reminder_type, status, updated_at
          )
          VALUES (
            rec.entity_id, NULL, p_product_id, p_product_name,
            idx, p_purchase_date, p_finish,
            p_days_left, p_reminder_type, 'pending', now()
          )
          ON CONFLICT (
            COALESCE(prospect_id, 0),
            COALESCE(customer_id, 0),
            COALESCE(product_id, 0),
            product_name,
            purchase_index
          )
          DO UPDATE SET
            days_until_finish     = EXCLUDED.days_until_finish,
            reminder_type         = EXCLUDED.reminder_type,
            estimated_finish_date = EXCLUDED.estimated_finish_date,
            updated_at            = now()
          WHERE refill_reminders.status = 'pending';
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      idx := idx + 1;
    END LOOP;
  END LOOP;

  -- Cleanup pass: dismiss any pending row whose underlying JSON purchase was
  -- dismissed client-side so the next cron run doesn't resurrect it.
  UPDATE refill_reminders r
  SET status = 'dismissed', updated_at = now()
  FROM prospects p
  WHERE r.status IN ('pending', 'whatsapp_sent')
    AND r.prospect_id = p.id
    AND p.closing_record IS NOT NULL
    AND jsonb_typeof(p.closing_record->'formula_healthcare_purchases') = 'array'
    AND r.purchase_index < jsonb_array_length(p.closing_record->'formula_healthcare_purchases')
    AND (p.closing_record->'formula_healthcare_purchases'->r.purchase_index->>'reminder_dismissed_at') IS NOT NULL;
END;
$func$;


-- -----------------------------------------------------------------------------
-- 4. Schedule the daily cron job (01:00 MYT = 17:00 UTC previous day)
-- -----------------------------------------------------------------------------
DO $sched$
DECLARE jid BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR jid IN SELECT jobid FROM cron.job WHERE jobname = 'refill_reminders_daily' LOOP
      PERFORM cron.unschedule(jid);
    END LOOP;
    PERFORM cron.schedule(
      'refill_reminders_daily',
      '0 17 * * *',
      $job$SELECT compute_refill_reminders();$job$
    );
  ELSE
    RAISE NOTICE 'pg_cron extension is NOT enabled. Enable it via Supabase Dashboard → Database → Extensions → pg_cron, then re-run this migration.';
  END IF;
END $sched$;


-- -----------------------------------------------------------------------------
-- 5. Initial populate + PostgREST reload
-- -----------------------------------------------------------------------------
SELECT compute_refill_reminders();
NOTIFY pgrst, 'reload schema';
