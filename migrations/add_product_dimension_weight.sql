-- Add Product Dimension and Product Weight columns to products and bujishu tables
-- Run this in Supabase SQL Editor

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_dimension TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_weight TEXT;

ALTER TABLE bujishu ADD COLUMN IF NOT EXISTS product_dimension TEXT;
ALTER TABLE bujishu ADD COLUMN IF NOT EXISTS product_weight TEXT;
