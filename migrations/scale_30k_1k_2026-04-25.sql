-- ════════════════════════════════════════════════════════════════════
-- Scale-readiness pass for 30K prospects + 1K agents
-- Applied via Supabase Management API on 2026-04-25.
-- Idempotent (CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE, ADD COLUMN
-- IF NOT EXISTS) so re-running it is safe.
--
-- Indexes added below cover join keys + filter columns hit on every
-- dashboard render and tree paint. KPI RPCs replace 13 client-side
-- getAll() iterations with 3 server-side aggregations. campaign_queue
-- is the bulk-send queue for WhatsApp/email/SMS. referrals.path_ids
-- + trigger denormalize the ancestor chain so getAncestorPath becomes
-- one indexed SELECT instead of 15 sequential getById calls.
-- ════════════════════════════════════════════════════════════════════

-- ───────────── 1. Critical indexes ─────────────
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_prospect ON public.referrals (referred_prospect_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_composite ON public.referrals (referrer_type, referrer_id);
CREATE INDEX IF NOT EXISTS idx_customers_responsible_agent ON public.customers (responsible_agent_id);
CREATE INDEX IF NOT EXISTS idx_event_attendees_entity ON public.event_attendees (entity_id, attended);
CREATE INDEX IF NOT EXISTS idx_event_attendees_attendee ON public.event_attendees (attendee_id, attended);
CREATE INDEX IF NOT EXISTS idx_event_attendees_type ON public.event_attendees (attendee_type);
CREATE INDEX IF NOT EXISTS idx_purchases_customer_id ON public.purchases (customer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON public.purchases (date DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_payment_method ON public.purchases (payment_method) WHERE payment_method IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_customer_date ON public.purchases (customer_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_users_reporting_to ON public.users (reporting_to) WHERE reporting_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users (status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_created_at ON public.prospects (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prospects_close_probability ON public.prospects (close_probability) WHERE close_probability >= 50;

-- ───────────── 2. KPI aggregation RPCs ─────────────
CREATE OR REPLACE FUNCTION public.kpi_activity_summary(
    p_from date,
    p_to date,
    p_agent_ids bigint[] DEFAULT NULL,
    p_role text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
    WITH filtered AS (
        SELECT a.activity_type
        FROM public.activities a
        LEFT JOIN public.users u ON u.id = a.lead_agent_id
        WHERE a.activity_date BETWEEN p_from AND p_to
          AND (p_agent_ids IS NULL OR a.lead_agent_id = ANY(p_agent_ids))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    )
    SELECT jsonb_build_object(
        'cps_count',         (SELECT COUNT(*) FROM filtered WHERE activity_type = 'CPS'),
        'total_meetings',    (SELECT COUNT(*) FROM filtered WHERE activity_type IN ('EVENT','AGENT_MEETING','FTF','FSA')),
        'agent_meetings',    (SELECT COUNT(*) FROM filtered WHERE activity_type IN ('EVENT','AGENT_MEETING')),
        'client_meetings',   (SELECT COUNT(*) FROM filtered WHERE activity_type IN ('FTF','FSA'))
    );
$$;

CREATE OR REPLACE FUNCTION public.kpi_purchase_summary(
    p_from date,
    p_to date,
    p_agent_ids bigint[] DEFAULT NULL,
    p_role text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
    WITH filtered AS (
        SELECT p.amount, p.payment_method, p.epp_bank, p.epp_months
        FROM public.purchases p
        LEFT JOIN public.customers c ON c.id = p.customer_id
        LEFT JOIN public.users u ON u.id = c.responsible_agent_id
        WHERE p.date BETWEEN p_from AND p_to
          AND COALESCE(p.is_agent_package, false) = false
          AND (p_agent_ids IS NULL OR c.responsible_agent_id = ANY(p_agent_ids))
          AND (p_role IS NULL OR p_role = 'All' OR u.role = p_role)
    ),
    epp_rows AS (
        SELECT COALESCE(epp_bank, 'Unknown') AS bank,
               COALESCE(epp_months::text, '-') AS months,
               COUNT(*) AS cnt
        FROM filtered
        WHERE payment_method = 'EPP'
        GROUP BY bank, months
    )
    SELECT jsonb_build_object(
        'total_sales',  (SELECT COALESCE(SUM(amount), 0) FROM filtered),
        'pop_count',    (SELECT COUNT(*) FROM filtered WHERE payment_method = 'POP'),
        'pop_sales',    (SELECT COALESCE(SUM(amount), 0) FROM filtered WHERE payment_method = 'POP'),
        'epp_count',    (SELECT COUNT(*) FROM filtered WHERE payment_method = 'EPP'),
        'epp_sales',    (SELECT COALESCE(SUM(amount), 0) FROM filtered WHERE payment_method = 'EPP'),
        'epp_details',  COALESCE((SELECT jsonb_agg(jsonb_build_object('bank', bank, 'months', months, 'count', cnt)) FROM epp_rows), '[]'::jsonb)
    );
$$;

CREATE OR REPLACE FUNCTION public.kpi_user_summary(
    p_from date,
    p_to date,
    p_agent_ids bigint[] DEFAULT NULL,
    p_role text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
    SELECT jsonb_build_object(
        'new_agents', (
            SELECT COUNT(*)
            FROM public.users u
            WHERE u.join_date BETWEEN p_from AND p_to
              AND (p_agent_ids IS NULL OR u.id = ANY(p_agent_ids))
              AND (
                  p_role IS NULL
                  OR p_role = 'All'
                  OR u.role = p_role
              )
              AND (
                  (p_role IS NOT NULL AND p_role <> 'All')
                  -- isAgent semantics in script.js: Level 3 through Level
                  -- 12 inclusive. The trailing ([^0-9]|$) anchor stops
                  -- "Level 13"/"Level 14" from matching the "Level 1"
                  -- prefix via the [3-9] alternation.
                  OR u.role ~ 'Level[[:space:]]*([3-9]|1[0-2])([^0-9]|$)'
              )
        ),
        'new_customers', (
            SELECT COUNT(*)
            FROM public.customers c
            WHERE c.customer_since BETWEEN p_from AND p_to
              AND (p_agent_ids IS NULL OR c.responsible_agent_id = ANY(p_agent_ids))
              AND EXISTS (
                  SELECT 1 FROM public.purchases p
                  WHERE p.customer_id = c.id
                    AND p.date BETWEEN p_from AND p_to
              )
        )
    );
$$;

GRANT EXECUTE ON FUNCTION public.kpi_activity_summary(date, date, bigint[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kpi_purchase_summary(date, date, bigint[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kpi_user_summary(date, date, bigint[], text) TO authenticated;

-- ───────────── 3. campaign_queue + referrals.path_ids ─────────────
-- ─── campaign_queue ───────────────────────────────────────────────
-- Bulk WhatsApp / email sends are queued here so the browser doesn't
-- iterate 30k prospects synchronously. A worker (Edge Function or
-- pg_cron job) processes pending rows in batches, leaving the user
-- free to close the tab.
CREATE TABLE IF NOT EXISTS public.campaign_queue (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT,
    channel TEXT NOT NULL,                         -- 'whatsapp' | 'email' | 'sms'
    target_type TEXT NOT NULL,                     -- 'prospect' | 'customer'
    target_id BIGINT NOT NULL,
    target_phone TEXT,
    target_email TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,    -- message body / template vars
    status TEXT NOT NULL DEFAULT 'pending',        -- pending | processing | sent | failed | skipped
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_by BIGINT,                             -- users.id who enqueued
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_queue_status ON public.campaign_queue (status, created_at) WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS idx_campaign_queue_campaign ON public.campaign_queue (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_queue_created_by ON public.campaign_queue (created_by, created_at DESC) WHERE created_by IS NOT NULL;

ALTER TABLE public.campaign_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_full_access ON public.campaign_queue;
CREATE POLICY auth_full_access ON public.campaign_queue FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Updated_at trigger to keep the row fingerprint in sync with edits.
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_campaign_queue_updated_at ON public.campaign_queue;
CREATE TRIGGER trg_campaign_queue_updated_at
    BEFORE UPDATE ON public.campaign_queue
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── referrals.path_ids ───────────────────────────────────────────
-- Denormalized ancestor chain so getAncestorPath(prospect) becomes
-- a single SELECT instead of 15 sequential getById calls. Element 0
-- is the root referrer; the last element is the direct parent.
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS path_ids BIGINT[];
ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS path_types TEXT[];

-- Backfill: walk up to 15 levels from each row using a recursive CTE.
-- Cycles are broken by the depth limit and a visited check.
WITH RECURSIVE chain AS (
    -- Anchor: every referral row, with itself as the first ancestor.
    SELECT
        r.id            AS root_id,
        r.referrer_id   AS current_id,
        r.referrer_type AS current_type,
        ARRAY[r.referrer_id]::bigint[]   AS ids,
        ARRAY[r.referrer_type]::text[]    AS types,
        1 AS depth
    FROM public.referrals r
    WHERE r.referrer_id IS NOT NULL
    UNION ALL
    -- Recurse: find the parent referral (where the current ancestor
    -- is the referred prospect), prepend its referrer.
    SELECT
        c.root_id,
        r2.referrer_id,
        r2.referrer_type,
        ARRAY[r2.referrer_id] || c.ids,
        ARRAY[COALESCE(r2.referrer_type, 'prospect')] || c.types,
        c.depth + 1
    FROM chain c
    JOIN public.referrals r2 ON r2.referred_prospect_id = c.current_id
                            AND COALESCE(c.current_type,'prospect') = 'prospect'
    WHERE c.depth < 15
      AND r2.referrer_id IS NOT NULL
      AND NOT (r2.referrer_id = ANY(c.ids))   -- cycle guard
),
deepest AS (
    SELECT DISTINCT ON (root_id) root_id, ids, types
    FROM chain
    ORDER BY root_id, depth DESC
)
UPDATE public.referrals r
SET path_ids = d.ids, path_types = d.types
FROM deepest d
WHERE r.id = d.root_id
  AND (r.path_ids IS NULL OR r.path_ids <> d.ids);

-- Index for fast `.contains` / array lookups (e.g. "is X in Y's path?")
CREATE INDEX IF NOT EXISTS idx_referrals_path_ids ON public.referrals USING GIN (path_ids);

-- Trigger to keep path_ids in sync as referrals are inserted/updated.
CREATE OR REPLACE FUNCTION public.refresh_referral_path() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_ids bigint[] := ARRAY[NEW.referrer_id];
    v_types text[] := ARRAY[COALESCE(NEW.referrer_type, 'prospect')];
    v_current_id bigint := NEW.referrer_id;
    v_current_type text := COALESCE(NEW.referrer_type, 'prospect');
    v_parent record;
    v_depth int := 1;
BEGIN
    IF NEW.referrer_id IS NULL THEN
        NEW.path_ids := NULL;
        NEW.path_types := NULL;
        RETURN NEW;
    END IF;

    -- Walk up 15 levels
    WHILE v_depth < 15 LOOP
        SELECT r.referrer_id, COALESCE(r.referrer_type, 'prospect') AS rtype
        INTO v_parent
        FROM public.referrals r
        WHERE r.referred_prospect_id = v_current_id
          AND v_current_type = 'prospect'
          AND r.referrer_id IS NOT NULL
          AND NOT (r.referrer_id = ANY(v_ids))   -- cycle guard
        LIMIT 1;
        EXIT WHEN NOT FOUND;
        v_ids := ARRAY[v_parent.referrer_id] || v_ids;
        v_types := ARRAY[v_parent.rtype] || v_types;
        v_current_id := v_parent.referrer_id;
        v_current_type := v_parent.rtype;
        v_depth := v_depth + 1;
    END LOOP;

    NEW.path_ids := v_ids;
    NEW.path_types := v_types;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_referrals_path ON public.referrals;
CREATE TRIGGER trg_referrals_path
    BEFORE INSERT OR UPDATE OF referrer_id, referrer_type, referred_prospect_id
    ON public.referrals
    FOR EACH ROW EXECUTE FUNCTION public.refresh_referral_path();
