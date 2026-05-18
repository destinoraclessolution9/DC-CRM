-- Add photo and poster URL columns to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS poster_url TEXT;

-- Price history table: tracks every price change with effective date
CREATE TABLE IF NOT EXISTS product_price_history (
    id          BIGSERIAL PRIMARY KEY,
    product_id  BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price       NUMERIC(12,2) NOT NULL,
    effective_date DATE NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE product_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read product price history"
    ON product_price_history FOR SELECT
    TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert product price history"
    ON product_price_history FOR INSERT
    TO authenticated WITH CHECK (true);

-- Index for fast per-product lookups
CREATE INDEX IF NOT EXISTS idx_product_price_history_product_id
    ON product_price_history (product_id, effective_date DESC);
