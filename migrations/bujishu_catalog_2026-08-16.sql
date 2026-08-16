-- Bujishu supplier catalogue (look-up only) — 2026-08-16
-- 508 products + 1,273 per-option prices scraped from bujishu.com/shop.
-- Separate from `bujishu` (the curated offerings list) on purpose: the five
-- consumers of `bujishu` (post-meetup checkboxes, pipeline, pillars, purchase
-- history) must NOT see these rows. Read-only for the app; imports run through
-- the Management API (bypasses RLS), so no write policy is granted.

CREATE TABLE IF NOT EXISTS bujishu_catalog (
  id                  BIGSERIAL PRIMARY KEY,
  source_product_id   INTEGER UNIQUE NOT NULL,   -- bujishu.com product id; upsert key
  name                TEXT NOT NULL,
  category            TEXT,
  price_selling       NUMERIC(12,2),             -- list price; only ~22 products have it
  price_customer      NUMERIC(12,2),             -- Bujishu Customer Price (default option)
  price_member        NUMERIC(12,2),             -- Wang Member Price (default option)
  price_customer_min  NUMERIC(12,2),             -- set only when options change the price
  price_customer_max  NUMERIC(12,2),
  price_member_min    NUMERIC(12,2),
  price_member_max    NUMERIC(12,2),
  lead_time           TEXT,
  options_summary     TEXT,
  photo_url           TEXT,                      -- bujishu.com hosted (public); not mirrored
  source_url          TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  scraped_at          DATE
);

CREATE TABLE IF NOT EXISTS bujishu_catalog_options (
  id             BIGSERIAL PRIMARY KEY,
  catalog_id     BIGINT NOT NULL REFERENCES bujishu_catalog(id) ON DELETE CASCADE,
  option_type    TEXT,        -- Size / Colour / Curtain Size
  option_label   TEXT,
  price_customer NUMERIC(12,2),
  price_member   NUMERIC(12,2),
  sort_order     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bjc_options_catalog ON bujishu_catalog_options (catalog_id);
CREATE INDEX IF NOT EXISTS idx_bjc_category ON bujishu_catalog (category);

ALTER TABLE bujishu_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE bujishu_catalog_options ENABLE ROW LEVEL SECURITY;

-- Look-up only: SELECT for signed-in users, no client write path.
DROP POLICY IF EXISTS bujishu_catalog_auth_read ON bujishu_catalog;
CREATE POLICY bujishu_catalog_auth_read ON bujishu_catalog
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS bujishu_catalog_options_auth_read ON bujishu_catalog_options;
CREATE POLICY bujishu_catalog_options_auth_read ON bujishu_catalog_options
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON bujishu_catalog, bujishu_catalog_options TO authenticated;
