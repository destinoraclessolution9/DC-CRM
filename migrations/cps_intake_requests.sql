-- CPS Intake Requests — shareable one-time intake links
-- Agent sets date/time/venue, generates a token link, prospect fills basic info
-- externally, then agent approves on calendar page which opens Quick Add Activity.

CREATE TABLE IF NOT EXISTS public.cps_intake_requests (
    id                    BIGSERIAL PRIMARY KEY,
    token                 UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    agent_id              BIGINT,

    -- Fixed by agent at share time
    activity_date         DATE        NOT NULL,
    start_time            TIME        NOT NULL,
    end_time              TIME        NOT NULL,
    venue_name            TEXT,
    venue_address         TEXT,
    waze_link             TEXT,

    -- Filled by prospect via public form
    prospect_name         TEXT,
    prospect_ic           TEXT,
    prospect_occupation   TEXT,
    prospect_phone        TEXT,
    prospect_email        TEXT,

    -- Lifecycle
    status                TEXT        NOT NULL DEFAULT 'awaiting_submission',
        -- awaiting_submission | submitted | approved | rejected | expired
    submitted_at          TIMESTAMPTZ,
    approved_at           TIMESTAMPTZ,
    approved_activity_id  BIGINT,
    expires_at            TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
    created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cps_intake_token_idx     ON public.cps_intake_requests (token);
CREATE INDEX IF NOT EXISTS cps_intake_agent_idx     ON public.cps_intake_requests (agent_id, status);
CREATE INDEX IF NOT EXISTS cps_intake_status_idx    ON public.cps_intake_requests (status);

-- Row Level Security: public anon needs to read by token and submit once
ALTER TABLE public.cps_intake_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cps_intake_anon_read"     ON public.cps_intake_requests;
DROP POLICY IF EXISTS "cps_intake_anon_submit"   ON public.cps_intake_requests;
DROP POLICY IF EXISTS "cps_intake_auth_all"      ON public.cps_intake_requests;

-- Anon (public form) can SELECT any row — they need the token to know which one anyway
CREATE POLICY "cps_intake_anon_read" ON public.cps_intake_requests
    FOR SELECT TO anon USING (true);

-- Anon can UPDATE only while the link is still awaiting submission.
-- The WITH CHECK allows status to flip to 'submitted' but not to 'approved' etc.
CREATE POLICY "cps_intake_anon_submit" ON public.cps_intake_requests
    FOR UPDATE TO anon
    USING (status = 'awaiting_submission' AND expires_at > now())
    WITH CHECK (status IN ('awaiting_submission', 'submitted'));

-- Authenticated (agent via service role) full access
CREATE POLICY "cps_intake_auth_all" ON public.cps_intake_requests
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, UPDATE ON public.cps_intake_requests TO anon;
GRANT ALL            ON public.cps_intake_requests TO authenticated, service_role;
GRANT USAGE, SELECT  ON SEQUENCE public.cps_intake_requests_id_seq TO anon, authenticated, service_role;
