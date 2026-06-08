-- ============================================================
-- Journey System — 5-Year Automated Follow-Up
-- DestinOraclesSolution CRM · Migration 20260606
-- Apply via: Supabase Dashboard → SQL Editor, or Management API
-- ============================================================

-- 1. journey_templates — master blueprint of touchpoints per stage
CREATE TABLE IF NOT EXISTS public.journey_templates (
    id                  BIGSERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    track               TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'nurture'
    stage_name          TEXT NOT NULL,                    -- 'first_contact'|'engagement'|'value_milestone'|'decision'|'onboarding'|'active_client_y1'|'growth_y2'…'growth_y5'|'nurture'
    days_offset         INTEGER NOT NULL DEFAULT 0,       -- days from stage_start_date
    touchpoint_type     TEXT NOT NULL DEFAULT 'task',     -- 'task'|'call'|'meeting'|'whatsapp_auto'
    message_template    TEXT,                             -- for whatsapp_auto: {name} placeholder
    assigned_to_role    TEXT NOT NULL DEFAULT 'agent',    -- 'agent'|'team_leader'|'manager'|'system'
    escalates_to_role   TEXT DEFAULT 'team_leader',
    escalate_after_days INTEGER DEFAULT 7,
    priority            TEXT NOT NULL DEFAULT 'med' CHECK (priority IN ('high','med','low')),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    sort_order          INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 2. journey_touchpoints — per-prospect/customer instances
CREATE TABLE IF NOT EXISTS public.journey_touchpoints (
    id                  BIGSERIAL PRIMARY KEY,
    prospect_id         BIGINT REFERENCES public.prospects(id)  ON DELETE CASCADE,
    customer_id         BIGINT REFERENCES public.customers(id)  ON DELETE CASCADE,
    template_id         BIGINT REFERENCES public.journey_templates(id),
    stage_name          TEXT NOT NULL,
    track               TEXT NOT NULL DEFAULT 'active',
    touchpoint_type     TEXT NOT NULL DEFAULT 'task',
    message_template    TEXT,
    title               TEXT NOT NULL,
    due_date            DATE NOT NULL,
    priority            TEXT NOT NULL DEFAULT 'med',
    status              TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','done','skipped','snoozed','overdue','auto_sent')),
    assigned_to         UUID REFERENCES auth.users(id),
    escalates_to        UUID REFERENCES auth.users(id),
    escalate_after_days INTEGER DEFAULT 7,
    completed_at        TIMESTAMPTZ,
    completed_by        UUID REFERENCES auth.users(id),
    snooze_until        DATE,
    notes               TEXT,
    whatsapp_message_id TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT journey_touchpoints_entity_check CHECK (
        (prospect_id IS NOT NULL AND customer_id IS NULL) OR
        (prospect_id IS NULL  AND customer_id IS NOT NULL)
    )
);

-- 3. journey_stage_log — immutable log of every stage transition
CREATE TABLE IF NOT EXISTS public.journey_stage_log (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     TEXT NOT NULL CHECK (entity_type IN ('prospect','customer')),
    entity_id       BIGINT NOT NULL,
    from_stage      TEXT,
    to_stage        TEXT NOT NULL,
    transitioned_by UUID REFERENCES auth.users(id),
    transitioned_at TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT
);

-- 4. conditional_rules — if/then branching engine
CREATE TABLE IF NOT EXISTS public.conditional_rules (
    id              BIGSERIAL PRIMARY KEY,
    trigger_event   TEXT NOT NULL,    -- 'proposal_opened_2x'|'said_not_now'|'no_reply_14d'|'score_above_70'
    trigger_value   JSONB DEFAULT '{}',
    action          TEXT NOT NULL CHECK (action IN (
        'skip_to_stage','move_to_nurture','accelerate','pause','move_to_active'
    )),
    action_payload  JSONB DEFAULT '{}',  -- e.g. {"stage":"decision"} or {"track":"nurture"}
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 5. prospect_score_log — append-only engagement score history
CREATE TABLE IF NOT EXISTS public.prospect_score_log (
    id              BIGSERIAL PRIMARY KEY,
    prospect_id     BIGINT REFERENCES public.prospects(id) ON DELETE CASCADE,
    score           INTEGER NOT NULL DEFAULT 0,
    delta           INTEGER NOT NULL DEFAULT 0,
    trigger_event   TEXT,  -- 'ftf_logged'|'cps_logged'|'reply_received'|'proposal_opened'|'decay'
    calculated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jt_prospect        ON public.journey_touchpoints(prospect_id)  WHERE prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jt_customer        ON public.journey_touchpoints(customer_id)  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jt_assigned_due    ON public.journey_touchpoints(assigned_to, status, due_date);
CREATE INDEX IF NOT EXISTS idx_jt_due_status      ON public.journey_touchpoints(due_date, status);
CREATE INDEX IF NOT EXISTS idx_jsl_entity         ON public.journey_stage_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_psl_prospect       ON public.prospect_score_log(prospect_id, calculated_at DESC);

-- ── updated_at trigger ────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        CREATE OR REPLACE FUNCTION public.set_updated_at()
        RETURNS TRIGGER LANGUAGE plpgsql AS $f$
        BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
        $f$;
    END IF;
END$$;

DROP TRIGGER IF EXISTS trg_jt_updated_at ON public.journey_touchpoints;
CREATE TRIGGER trg_jt_updated_at
    BEFORE UPDATE ON public.journey_touchpoints
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Agent journey load view ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.agent_journey_load AS
SELECT
    assigned_to                                                               AS agent_id,
    COUNT(*) FILTER (WHERE status = 'overdue')                                AS overdue_count,
    COUNT(*) FILTER (WHERE status = 'pending' AND due_date = CURRENT_DATE)    AS due_today_count,
    COUNT(*) FILTER (WHERE status IN ('pending','overdue','snoozed'))          AS total_open
FROM public.journey_touchpoints
WHERE assigned_to IS NOT NULL
GROUP BY assigned_to;

-- ── Daily overdue marker function (called by pg_cron) ────────────────────────
CREATE OR REPLACE FUNCTION public.mark_overdue_journey_touchpoints()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE updated_count INTEGER;
BEGIN
    UPDATE public.journey_touchpoints
    SET status = 'overdue'
    WHERE status = 'pending'
      AND due_date < CURRENT_DATE;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.journey_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_touchpoints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journey_stage_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conditional_rules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_score_log   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journey_templates_auth    ON public.journey_templates;
DROP POLICY IF EXISTS journey_touchpoints_auth  ON public.journey_touchpoints;
DROP POLICY IF EXISTS journey_stage_log_auth    ON public.journey_stage_log;
DROP POLICY IF EXISTS conditional_rules_auth    ON public.conditional_rules;
DROP POLICY IF EXISTS prospect_score_log_auth   ON public.prospect_score_log;

CREATE POLICY journey_templates_auth   ON public.journey_templates   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY journey_touchpoints_auth ON public.journey_touchpoints FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY journey_stage_log_auth   ON public.journey_stage_log   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY conditional_rules_auth   ON public.conditional_rules   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY prospect_score_log_auth  ON public.prospect_score_log  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── pg_cron: daily at 00:00 UTC (08:00 MYT) mark overdue ─────────────────────
-- Requires pg_cron extension (pre-enabled on Supabase Pro / Team).
-- Run this block manually in the SQL editor after confirming pg_cron is enabled:
/*
SELECT cron.schedule(
    'journey-mark-overdue',
    '0 0 * * *',
    $$SELECT public.mark_overdue_journey_touchpoints();$$
);
*/

-- ── Seed: 5-Year Journey Templates ───────────────────────────────────────────
INSERT INTO public.journey_templates
    (name, track, stage_name, days_offset, touchpoint_type, message_template,
     assigned_to_role, escalates_to_role, escalate_after_days, priority, sort_order)
VALUES
-- ── Track A: Active Pursuit ──────────────────────────────────────────────────
-- Stage 1: First Contact (D 0-7)
('WhatsApp Thank You',        'active','first_contact',  1,'whatsapp_auto',
 'Hi {name}! It was great meeting you. I look forward to sharing more about how we can help you. Feel free to reach out anytime! 🙏',
 'system','agent',3,'high',10),
('Follow-up Call Reminder',   'active','first_contact',  3,'call', NULL,   'agent','team_leader',3,'high',20),
('Schedule CPS / FSA Session','active','first_contact',  7,'task', NULL,   'agent','team_leader',3,'med', 30),

-- Stage 2: Engagement (W 2-4)
('CPS / FSA Session Prompt',  'active','engagement',    14,'task', NULL,   'agent','team_leader',5,'high',40),
('Proposal Sent — Follow-up', 'active','engagement',    21,'task', NULL,   'agent','team_leader',7,'med', 50),
('Proposal Response Check',   'active','engagement',    28,'call', NULL,   'agent','team_leader',7,'med', 60),

-- 30-Day Value Milestone
('30-Day Value Milestone Review','active','value_milestone',30,'task',NULL,'manager','manager',   7,'high',70),

-- Stage 3: Decision (M 2-3)
('Decision Check-in Call',    'active','decision',      60,'call', NULL,   'agent','team_leader',5,'high',80),
('Final Close Attempt',       'active','decision',      90,'task', NULL,   'team_leader','manager',5,'high',90),

-- Stage 4: Onboarding (Post-conversion, days from conversion date)
('Welcome WhatsApp',          'active','onboarding',     3,'whatsapp_auto',
 'Welcome to the DestinOraclesSolution family, {name}! 🎉 Your transformation journey begins now. We will be in touch shortly with your next steps.',
 'system','agent',3,'high',100),
('Welcome Review Meeting',    'active','onboarding',    30,'meeting',NULL, 'agent','team_leader',7,'high',110),
('Quarterly Check-in',        'active','onboarding',    90,'call',  NULL,  'agent','team_leader',7,'med', 120),
('6-Month Milestone + Referral Ask','active','onboarding',180,'meeting',NULL,'agent','team_leader',7,'high',130),

-- Stage 5: Active Client – Year 1 (days from conversion date)
('Monthly Check-in',          'active','active_client_y1', 30,'task',NULL,'agent','team_leader',7,'med',140),
('Monthly Check-in',          'active','active_client_y1', 60,'task',NULL,'agent','team_leader',7,'med',141),
('Quarterly Business Review', 'active','active_client_y1', 90,'meeting',NULL,'team_leader','manager',7,'high',150),
('Monthly Check-in',          'active','active_client_y1',120,'task',NULL,'agent','team_leader',7,'med',142),
('Monthly Check-in',          'active','active_client_y1',150,'task',NULL,'agent','team_leader',7,'med',143),
('Quarterly Business Review', 'active','active_client_y1',180,'meeting',NULL,'team_leader','manager',7,'high',151),
('Monthly Check-in',          'active','active_client_y1',210,'task',NULL,'agent','team_leader',7,'med',144),
('Monthly Check-in',          'active','active_client_y1',240,'task',NULL,'agent','team_leader',7,'med',145),
('Quarterly Business Review', 'active','active_client_y1',270,'meeting',NULL,'team_leader','manager',7,'high',152),
('Annual Review + Upsell',    'active','active_client_y1',365,'meeting',NULL,'agent','team_leader',7,'high',160),

-- Stage 6: Long-term Growth – Year 2-5
('6-Month Strategy Review',   'active','growth_y2',180,'meeting',NULL,'agent','team_leader',7,'high',170),
('Annual Renewal Discussion', 'active','growth_y2',365,'meeting',NULL,'agent','manager',   7,'high',180),
('Referral Cultivation Ask',  'active','growth_y2',540,'task',  NULL,'agent','team_leader',7,'high',190),
('6-Month Strategy Review',   'active','growth_y3',180,'meeting',NULL,'agent','team_leader',7,'high',200),
('Annual Renewal Discussion', 'active','growth_y3',365,'meeting',NULL,'agent','manager',   7,'high',210),
('6-Month Strategy Review',   'active','growth_y4',180,'meeting',NULL,'agent','team_leader',7,'high',220),
('Annual Renewal Discussion', 'active','growth_y4',365,'meeting',NULL,'agent','manager',   7,'high',230),
('5-Year Legacy Review',      'active','growth_y5',365,'meeting',NULL,'manager','manager', 7,'high',240),

-- ── Track B: Nurture (said "not now") ────────────────────────────────────────
('Nurture Value Share',       'nurture','nurture', 30,'whatsapp_auto',
 'Hi {name}! Sharing a quick insight that may be relevant to your journey. No pressure — just here when you are ready 😊',
 'system','agent',14,'low',300),
('Nurture Case Study',        'nurture','nurture', 60,'whatsapp_auto',
 'Hi {name}! A quick story of someone who made a positive change this month — thought it might inspire you 🌟',
 'system','agent',14,'low',310),
('Nurture Light Check-in',    'nurture','nurture', 90,'call', NULL,  'agent','team_leader',14,'low',320),
('Nurture Re-qualify',        'nurture','nurture',180,'task', NULL,  'agent','team_leader',14,'low',330),
('Nurture Annual Re-engage',  'nurture','nurture',365,'task', NULL,  'agent','team_leader',14,'med',340)

ON CONFLICT DO NOTHING;

-- ── Seed: Default conditional rules ──────────────────────────────────────────
INSERT INTO public.conditional_rules (trigger_event, trigger_value, action, action_payload) VALUES
('said_not_now',      '{}',          'move_to_nurture',  '{"track":"nurture"}'),
('no_reply_90d',      '{}',          'pause',            '{}'),
('score_above_70',    '{}',          'accelerate',       '{"reduce_offset_days":7}'),
('nurture_score_50',  '{}',          'move_to_active',   '{"stage":"decision"}')
ON CONFLICT DO NOTHING;
