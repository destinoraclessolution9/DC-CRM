-- =============================================================================
-- Customer Forms (Survey + CPS + APU) — 2026-05-30
-- =============================================================================
-- Digitizes 3 official Destin Oracles paper forms:
--   1. 新客户调查表  (New Customer Survey) — pre-consultation pulse check
--   2. 細解命盤 CPS  (Personal Life Chart Analysis) — during consultation
--   3. APU Appraisal — post-consultation feedback + 3 referrals
--
-- Lives under Marketing Automation > Forms tab.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) customer_surveys — 新客户调查表 (6 Qs + signature)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_surveys (
    id                  BIGSERIAL PRIMARY KEY,
    prospect_id         BIGINT REFERENCES public.prospects(id) ON DELETE CASCADE,
    consultant_id       BIGINT,                    -- 顾问姓名
    analysis_date       DATE,                      -- 解盘日期
    customer_name       TEXT,                      -- 客户姓名
    email               TEXT,                      -- 电邮
    phone               TEXT,                      -- 联络电话
    occupation          TEXT,                      -- 职业

    -- Q1: 请问您从哪里听闻及认识到DC?
    q1_source           TEXT,                      -- 'family' | 'friend' | 'other'
    q1_source_other     TEXT,                      -- if 'other'

    -- Q2: 请问您目前或之前有使用过风水或相关风水服务?
    q2_used_before      BOOLEAN,                   -- TRUE = 有, FALSE = 没有

    -- Q3: 请问您个人或家庭之前或目前相信风水的功效吗?
    q3_belief           TEXT,                      -- 'believe' | 'disbelieve' | 'neutral'
    q3_belief_reason    TEXT,                      -- 为什麼

    -- Q4: 如果传承7000年的玄空风水,确实有效,您会否愿意尝试使用?
    q4_willing          TEXT,                      -- 'yes' | 'maybe' | 'no'

    -- Q5: 为了个人及家人...您是否愿意使用DC风水的解决方案?
    q5_use_dc           TEXT,                      -- 'willing' | 'consider' | 'neutral'

    -- Q6: 若您明白到DC风水知识的种种好处与利益,您会否主动分享给亲友?
    q6_share            TEXT,                      -- 'definitely' | 'when_opportunity' | 'no'

    signature_data_url  TEXT,                      -- 客户签名 (base64 PNG from canvas)
    signed_at           TIMESTAMPTZ,

    created_by          BIGINT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_surveys_prospect_idx
    ON public.customer_surveys (prospect_id);
CREATE INDEX IF NOT EXISTS customer_surveys_date_idx
    ON public.customer_surveys (analysis_date DESC);

-- ---------------------------------------------------------------------------
-- 2) cps_analyses — CPS Form / 細解命盤 (with Lunar + Solar bagua grids)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cps_analyses (
    id                          BIGSERIAL PRIMARY KEY,
    prospect_id                 BIGINT REFERENCES public.prospects(id) ON DELETE CASCADE,
    serial_number               TEXT,              -- SN
    form_date                   DATE DEFAULT CURRENT_DATE,

    customer_name               TEXT,              -- Customer Name
    customer_name_chinese       TEXT,              -- 客戶姓名 (中文)
    gender                      TEXT,              -- 'male' | 'female'

    birthdate_solar             DATE,              -- 陽曆
    birthdate_lunar             DATE,              -- 農曆

    phone                       TEXT,              -- 手提號碼
    email                       TEXT,              -- 電郵
    occupation                  TEXT,              -- 目前職業
    living_area                 TEXT,              -- 居住地區
    introducer                  TEXT,              -- 介紹人
    marital_status              TEXT,              -- 'single' | 'married' | 'others'
    dealer_id                   BIGINT,            -- 代理姓名 (users.id)

    -- 8 trigrams (巽離坤 / 震兌 / 艮坎乾) + center = 9 cells per chart
    -- JSON shape: { xun, li, kun, zhen, center, dui, gen, kan, qian }
    lunar_chart                 JSONB,
    solar_chart                 JSONB,

    notes                       TEXT,              -- 6 free-form lines

    -- For Office Use signatures
    dealer_signature_data_url   TEXT,              -- Dealer's Signature
    dealer_signed_name          TEXT,
    dealer_signed_at            TIMESTAMPTZ,

    cps_by_id                   BIGINT,            -- CPS by (users.id)
    cps_signature_data_url      TEXT,
    cps_signed_name             TEXT,
    cps_signed_at               TIMESTAMPTZ,

    created_by                  BIGINT,
    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cps_analyses_prospect_idx
    ON public.cps_analyses (prospect_id);
CREATE INDEX IF NOT EXISTS cps_analyses_date_idx
    ON public.cps_analyses (form_date DESC);

-- ---------------------------------------------------------------------------
-- 3) apu_appraisals — DC Personal Chart Analysis APPRAISAL FORM (7 Qs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.apu_appraisals (
    id                              BIGSERIAL PRIMARY KEY,
    prospect_id                     BIGINT REFERENCES public.prospects(id) ON DELETE CASCADE,
    appraisal_date                  DATE DEFAULT CURRENT_DATE,

    consultant_id                   BIGINT,        -- CONSULTANT (users.id)
    dealer_ea_id                    BIGINT,        -- DEALER / EA (users.id)
    customer_identifier             TEXT,          -- ID
    referrer                        TEXT,          -- 傳福者

    -- Q1: How do you rate the personal chart analysis service received?
    q1_service_rating               SMALLINT,      -- 5=Extremely Satisfied ... 1=Poor
    q1_reason                       TEXT,

    -- Q2: Rate consultant's chart analysis ability and overall performance
    q2_consultant_rating            SMALLINT,
    q2_reason                       TEXT,

    -- Q3: Satisfaction on arrangement and flow
    q3_arrangement_rating           SMALLINT,
    q3_reason                       TEXT,

    -- Q4: How do you rate the result/value of this complimentary analysis?
    --     5=Extremely Exceeded Expectation ... 1=Poor
    q4_value_rating                 SMALLINT,
    q4_reason                       TEXT,

    -- Q5: Rate the Consultant (knowledge, sharing, responsiveness)
    --     5=Excellent ... 1=Unacceptable
    q5_knowledge_rating             SMALLINT,
    q5_reason                       TEXT,

    -- Q6: Are you aware this service is only by referral?
    q6_aware_referral               BOOLEAN,
    q6_reason                       TEXT,

    -- Signatures
    customer_signature_data_url     TEXT,
    customer_signed_at              TIMESTAMPTZ,
    apu_signature_data_url          TEXT,          -- DC APU signature
    apu_signed_at                   TIMESTAMPTZ,
    apu_signed_by                   BIGINT,
    head_apu_signature_data_url     TEXT,          -- Head of DC APU signature
    head_apu_signed_at              TIMESTAMPTZ,
    head_apu_signed_by              BIGINT,

    created_by                      BIGINT,
    created_at                      TIMESTAMPTZ DEFAULT now(),
    updated_at                      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apu_appraisals_prospect_idx
    ON public.apu_appraisals (prospect_id);
CREATE INDEX IF NOT EXISTS apu_appraisals_date_idx
    ON public.apu_appraisals (appraisal_date DESC);

-- ---------------------------------------------------------------------------
-- 4) apu_referrals — Q7 referral capture (up to 3 names per appraisal)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.apu_referrals (
    id                       BIGSERIAL PRIMARY KEY,
    appraisal_id             BIGINT REFERENCES public.apu_appraisals(id) ON DELETE CASCADE,
    position                 SMALLINT,             -- 1, 2, 3
    name                     TEXT,                 -- 姓名 / NAME
    nric                     TEXT,                 -- 身份證 / NRIC
    contact                  TEXT,                 -- 電話 / CONTACT
    occupation               TEXT,                 -- 職業 / OCCUPATION
    converted_prospect_id    BIGINT REFERENCES public.prospects(id) ON DELETE SET NULL,
    converted_at             TIMESTAMPTZ,
    created_at               TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apu_referrals_appraisal_idx
    ON public.apu_referrals (appraisal_id);

-- =============================================================================
-- Row Level Security (mirror pattern from rls_replace_allow_all_2026-04-24.sql)
-- =============================================================================
ALTER TABLE public.customer_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cps_analyses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apu_appraisals   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apu_referrals    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_surveys_auth_full_access" ON public.customer_surveys;
CREATE POLICY "customer_surveys_auth_full_access"
    ON public.customer_surveys FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "cps_analyses_auth_full_access" ON public.cps_analyses;
CREATE POLICY "cps_analyses_auth_full_access"
    ON public.cps_analyses FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "apu_appraisals_auth_full_access" ON public.apu_appraisals;
CREATE POLICY "apu_appraisals_auth_full_access"
    ON public.apu_appraisals FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "apu_referrals_auth_full_access" ON public.apu_referrals;
CREATE POLICY "apu_referrals_auth_full_access"
    ON public.apu_referrals FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

GRANT ALL ON public.customer_surveys TO authenticated;
GRANT ALL ON public.cps_analyses     TO authenticated;
GRANT ALL ON public.apu_appraisals   TO authenticated;
GRANT ALL ON public.apu_referrals    TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.customer_surveys_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.cps_analyses_id_seq     TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.apu_appraisals_id_seq   TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.apu_referrals_id_seq    TO authenticated;

-- =============================================================================
-- updated_at triggers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at_customer_forms()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_surveys_updated_at ON public.customer_surveys;
CREATE TRIGGER trg_customer_surveys_updated_at
    BEFORE UPDATE ON public.customer_surveys
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_customer_forms();

DROP TRIGGER IF EXISTS trg_cps_analyses_updated_at ON public.cps_analyses;
CREATE TRIGGER trg_cps_analyses_updated_at
    BEFORE UPDATE ON public.cps_analyses
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_customer_forms();

DROP TRIGGER IF EXISTS trg_apu_appraisals_updated_at ON public.apu_appraisals;
CREATE TRIGGER trg_apu_appraisals_updated_at
    BEFORE UPDATE ON public.apu_appraisals
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_customer_forms();
