-- =============================================================================
-- Destiny Code 3-Year Blueprint — 九運改命藍圖表 — 2026-05-31
-- =============================================================================
-- Digitizes the official Destin Oracles "DC 個人風水 九運改命藍圖表" form.
-- Lives under Marketing Automation > Forms tab as #4 (after Survey/CPS/APU)
-- and on the prospect profile accordion's Customer Forms card.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.destiny_blueprints (
    id                          BIGSERIAL PRIMARY KEY,
    prospect_id                 BIGINT REFERENCES public.prospects(id) ON DELETE CASCADE,
    form_date                   DATE DEFAULT CURRENT_DATE,

    -- ── Header
    customer_name               TEXT,              -- 姓名
    contact_number              TEXT,              -- 聯絡號碼
    agent_id                    BIGINT,            -- 代理 (users.id)
    group_name                  TEXT,              -- 組別

    -- ── 1) 命卦大運 (Life Trigram Fortune)
    section1_ji                 TEXT,              -- 吉
    section1_xiong              TEXT,              -- 凶
    section1_hui                TEXT,              -- 悔
    section1_lin                TEXT,              -- 吝
    section1_score              SMALLINT,          -- 分數
    section1_advice             TEXT,              -- 建言

    -- ── 2) 成效與需求 (Effectiveness & Needs — current/future solutions)
    section2_personal           TEXT,              -- 個人
    section2_home               TEXT,              -- 家居
    section2_work               TEXT,              -- 工作
    section2_business           TEXT,              -- 生意
    section2_relationship       TEXT,              -- 關係
    section2_children           TEXT,              -- 子女
    section2_advice             TEXT,              -- 建言

    -- ── 3) Future 3-year fortune table
    start_year                  SMALLINT DEFAULT 2026,
    year_1_event                TEXT,              -- 運盤重大剋應 (year 1)
    year_1_goal                 TEXT,              -- 藍圖目標 (year 1)
    year_2_event                TEXT,
    year_2_goal                 TEXT,
    year_3_event                TEXT,
    year_3_goal                 TEXT,
    section3_conclusion         TEXT,              -- 結論

    -- ── 4) 行動與結果 (Action & Results — possible result changes)
    section4_gain               TEXT,              -- 得到
    section4_loss               TEXT,              -- 損失
    section4_maintain           TEXT,              -- 保持
    section4_decline            TEXT,              -- 衰退
    section4_best_solution      TEXT,              -- 把風險降低提高成率的最佳輔助方案或決定

    -- ── Signatures (customer + consultant)
    customer_signed_name        TEXT,              -- 客戶姓名
    customer_signature_data_url TEXT,
    customer_signed_at          TIMESTAMPTZ,
    consultant_id               BIGINT,            -- 顧問 (users.id)
    consultant_signed_name      TEXT,
    consultant_signature_data_url TEXT,
    consultant_signed_at        TIMESTAMPTZ,

    created_by                  BIGINT,
    created_at                  TIMESTAMPTZ DEFAULT now(),
    updated_at                  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS destiny_blueprints_prospect_idx
    ON public.destiny_blueprints (prospect_id);
CREATE INDEX IF NOT EXISTS destiny_blueprints_date_idx
    ON public.destiny_blueprints (form_date DESC);

-- =============================================================================
-- RLS (mirror customer_forms pattern)
-- =============================================================================
ALTER TABLE public.destiny_blueprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "destiny_blueprints_auth_full_access" ON public.destiny_blueprints;
CREATE POLICY "destiny_blueprints_auth_full_access"
    ON public.destiny_blueprints FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

GRANT ALL ON public.destiny_blueprints TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.destiny_blueprints_id_seq TO authenticated;

-- =============================================================================
-- updated_at trigger (reuses set_updated_at_customer_forms from customer_forms migration)
-- =============================================================================
DROP TRIGGER IF EXISTS trg_destiny_blueprints_updated_at ON public.destiny_blueprints;
CREATE TRIGGER trg_destiny_blueprints_updated_at
    BEFORE UPDATE ON public.destiny_blueprints
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_customer_forms();
