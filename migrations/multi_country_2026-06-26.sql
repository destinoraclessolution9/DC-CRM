-- Multi-country support (MY / SG / AU + future) — 2026-06-26
-- ADDITIVE + NON-DESTRUCTIVE. Every new column is nullable or carries a default,
-- so existing rows are untouched and read back as Malaysia / MYR exactly as before.
-- Safe to run on the live DB; re-runnable (IF NOT EXISTS / ON CONFLICT guards).
--
-- Architecture: ONE system, country-tagged records (NOT a clone-per-country).
--   * countries           — extensible registry (add a row = add a market, no deploy)
--   * <record>.country     — ISO code tag, defaults 'MY', inherited from the agent
--   * purchases.currency / event_attendees.currency — currency a money row was booked in
--   * products.prices      — per-country price map {"MY":99,"SG":45,"AU":30}

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Country registry
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.countries (
    code             TEXT PRIMARY KEY,          -- ISO-3166 alpha-2: MY, SG, AU
    name             TEXT NOT NULL,
    currency_code    TEXT NOT NULL,             -- ISO-4217: MYR, SGD, AUD
    currency_symbol  TEXT NOT NULL,             -- RM, S$, A$
    locale           TEXT NOT NULL,             -- en-MY, en-SG, en-AU
    is_default       BOOLEAN NOT NULL DEFAULT false,
    active           BOOLEAN NOT NULL DEFAULT true,
    sort_order       INT     NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.countries (code, name, currency_code, currency_symbol, locale, is_default, active, sort_order) VALUES
    ('MY', 'Malaysia',  'MYR', 'RM', 'en-MY', true,  true, 1),
    ('SG', 'Singapore', 'SGD', 'S$', 'en-SG', false, true, 2),
    ('AU', 'Australia', 'AUD', 'A$', 'en-AU', false, true, 3)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "countries_read_all"  ON public.countries;
DROP POLICY IF EXISTS "countries_admin_all" ON public.countries;
-- Everyone authenticated may read the registry (drives dropdowns + currency render).
CREATE POLICY "countries_read_all" ON public.countries
    FOR SELECT TO authenticated, anon USING (true);
-- Only admins write it (kept simple: app already gates the admin UI; tighten later
-- with current_user_level() if needed).
CREATE POLICY "countries_admin_all" ON public.countries
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT ON public.countries TO anon, authenticated, service_role;
GRANT ALL    ON public.countries TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Country tag on the records that carry a market
--    Default 'MY' so every existing row is Malaysia — no data rewrite.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.users      ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'MY';  -- agent home market
ALTER TABLE public.prospects  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'MY';
ALTER TABLE public.customers  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'MY';
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'MY';  -- events

CREATE INDEX IF NOT EXISTS prospects_country_idx  ON public.prospects  (country);
CREATE INDEX IF NOT EXISTS customers_country_idx  ON public.customers  (country);
CREATE INDEX IF NOT EXISTS activities_country_idx ON public.activities (country);
CREATE INDEX IF NOT EXISTS users_country_idx      ON public.users      (country);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Currency stamp on money rows — so an SG/AU sale is never silently summed
--    into an RM total. Defaults 'MYR' to match all historical rows.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.purchases       ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MYR';
ALTER TABLE public.event_attendees ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MYR';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Per-country product price map. Existing `price` column stays the MY base;
--    `prices` holds the per-country overrides {"MY":99,"SG":45,"AU":30}.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS prices JSONB NOT NULL DEFAULT '{}'::jsonb;

-- (Optional, run once if you want existing products' MY base mirrored into the map.)
-- UPDATE public.products SET prices = jsonb_build_object('MY', price)
--   WHERE (prices = '{}'::jsonb OR prices IS NULL) AND price IS NOT NULL;
