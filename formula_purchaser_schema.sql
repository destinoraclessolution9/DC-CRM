-- ========================================================================
-- FORMULA PURCHASER — Schema for Stock Replenishment & Multi-Outlet System
-- Run this in Supabase SQL Editor (one-time setup).
-- ========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ---------- LOCATIONS ----------
CREATE TABLE IF NOT EXISTS fp_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(20) CHECK (type IN ('warehouse','retail','central_hub','supplier')),
    pos_prefix VARCHAR(20),                   -- e.g. PGBL, FMKL, FMLS (for POS import mapping)
    address TEXT,
    is_active BOOLEAN DEFAULT true,
    is_oem BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO fp_locations (name, type, pos_prefix, is_oem) VALUES
    ('Puchong warehouse',      'warehouse',   NULL,   false),
    ('001 Retail Puchong',     'retail',      'FMLS', false),
    ('002 Retail Bay Avenue',  'retail',      'PGBL', false),
    ('003 Retail Pavilion 2',  'central_hub', 'FMKL', false),
    ('Factory OEM',            'supplier',    NULL,   true)
ON CONFLICT (name) DO NOTHING;

-- ---------- VENDORS ----------
CREATE TABLE IF NOT EXISTS fp_vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    address_line1 VARCHAR(200),
    address_line2 VARCHAR(200),
    address_line3 VARCHAR(200),
    phone VARCHAR(50),
    fax VARCHAR(50),
    email VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- SKU MASTER ----------
CREATE TABLE IF NOT EXISTS fp_sku_master (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_code VARCHAR(50) UNIQUE NOT NULL,
    product_name VARCHAR(300),
    product_attribute VARCHAR(150),
    auto_min_stock INTEGER DEFAULT 0,
    actual_min_stock INTEGER,
    max_stock_level INTEGER DEFAULT 200,
    reorder_quantity INTEGER DEFAULT 50,
    unit_cost NUMERIC(10,2),
    is_active BOOLEAN DEFAULT true,
    is_oem BOOLEAN DEFAULT false,
    lead_time_days INTEGER DEFAULT 7,
    safety_factor NUMERIC(3,2) DEFAULT 1.5,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- STOCK BALANCE ----------
CREATE TABLE IF NOT EXISTS fp_stock_balance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID REFERENCES fp_locations(id) ON DELETE CASCADE,
    sku_id UUID REFERENCES fp_sku_master(id) ON DELETE CASCADE,
    physical_stock INTEGER DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(location_id, sku_id)
);

-- ---------- POS TRANSACTIONS ----------
CREATE TABLE IF NOT EXISTS fp_pos_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID REFERENCES fp_locations(id),
    sku_id UUID REFERENCES fp_sku_master(id),
    purchase_number VARCHAR(50),
    quantity_sold INTEGER NOT NULL,
    unit_price NUMERIC(10,2),
    subtotal NUMERIC(10,2),
    transaction_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- REFUNDS ----------
CREATE TABLE IF NOT EXISTS fp_refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID REFERENCES fp_locations(id),
    sku_id UUID REFERENCES fp_sku_master(id),
    purchase_number VARCHAR(50),
    quantity_refunded INTEGER NOT NULL,
    unit_price NUMERIC(10,2),
    refund_date DATE NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- ORDER REQUIREMENTS (deals) ----------
CREATE TABLE IF NOT EXISTS fp_order_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku_id UUID REFERENCES fp_sku_master(id) ON DELETE CASCADE,
    requirement_type VARCHAR(30) CHECK (requirement_type IN ('BUY_X_GET_Y_FREE','MIN_ORDER_QTY','VOLUME_DISCOUNT')),
    x_quantity INTEGER,
    y_free INTEGER,
    min_order_qty INTEGER,
    discount_percent NUMERIC(5,2),
    effective_from DATE,
    effective_to DATE,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- PRODUCT EXCLUSIONS ----------
CREATE TABLE IF NOT EXISTS fp_product_exclusions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_code VARCHAR(50) NOT NULL,
    match_type VARCHAR(20) DEFAULT 'exact' CHECK (match_type IN ('exact','starts_with','contains','regex')),
    reason VARCHAR(200),
    is_active BOOLEAN DEFAULT true,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------- PURCHASE ORDERS ----------
CREATE TABLE IF NOT EXISTS fp_purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_number VARCHAR(30) UNIQUE NOT NULL,
    vendor_id UUID REFERENCES fp_vendors(id),
    branch_location_id UUID REFERENCES fp_locations(id),
    order_date DATE DEFAULT CURRENT_DATE,
    expected_delivery DATE,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','submitted','received','cancelled')),
    total_amount NUMERIC(12,2),
    notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fp_po_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    po_id UUID REFERENCES fp_purchase_orders(id) ON DELETE CASCADE,
    sku_id UUID REFERENCES fp_sku_master(id),
    quantity_ordered INTEGER NOT NULL,
    quantity_received INTEGER DEFAULT 0,
    unit_cost NUMERIC(10,2),
    free_quantity INTEGER DEFAULT 0,
    remark VARCHAR(200),
    amount NUMERIC(12,2)
);

-- ---------- TRANSFER ORDERS ----------
CREATE TABLE IF NOT EXISTS fp_transfer_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_location_id UUID REFERENCES fp_locations(id),
    to_location_id UUID REFERENCES fp_locations(id),
    transfer_date DATE DEFAULT CURRENT_DATE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','in_transit','completed','cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fp_transfer_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transfer_id UUID REFERENCES fp_transfer_orders(id) ON DELETE CASCADE,
    sku_id UUID REFERENCES fp_sku_master(id),
    quantity INTEGER NOT NULL,
    reason VARCHAR(100)
);

-- ---------- OUTLET SKU SETTINGS ----------
CREATE TABLE IF NOT EXISTS fp_outlet_sku_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    outlet_id UUID REFERENCES fp_locations(id) ON DELETE CASCADE,
    sku_id UUID REFERENCES fp_sku_master(id) ON DELETE CASCADE,
    manual_min_stock INTEGER,
    sales_velocity NUMERIC(8,2),
    last_transfer_date DATE,
    UNIQUE(outlet_id, sku_id)
);

-- ---------- INDEXES ----------
CREATE INDEX IF NOT EXISTS idx_fp_stock_sku       ON fp_stock_balance(sku_id);
CREATE INDEX IF NOT EXISTS idx_fp_stock_location  ON fp_stock_balance(location_id);
CREATE INDEX IF NOT EXISTS idx_fp_pos_sku_date    ON fp_pos_transactions(sku_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_fp_pos_location    ON fp_pos_transactions(location_id);
CREATE INDEX IF NOT EXISTS idx_fp_pos_purchase    ON fp_pos_transactions(purchase_number);
CREATE INDEX IF NOT EXISTS idx_fp_refunds_sku     ON fp_refunds(sku_id);
CREATE INDEX IF NOT EXISTS idx_fp_po_status       ON fp_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_fp_transfer_status ON fp_transfer_orders(status);
CREATE INDEX IF NOT EXISTS idx_fp_excl_active     ON fp_product_exclusions(is_active);

-- ---------- ROW LEVEL SECURITY ----------
ALTER TABLE fp_locations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_vendors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_sku_master          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_stock_balance       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_pos_transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_refunds             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_order_requirements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_product_exclusions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_purchase_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_po_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_transfer_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_transfer_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fp_outlet_sku_settings ENABLE ROW LEVEL SECURITY;

-- Permissive policy for authenticated users (tighten per-role later if needed).
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'fp_locations','fp_vendors','fp_sku_master','fp_stock_balance',
    'fp_pos_transactions','fp_refunds','fp_order_requirements',
    'fp_product_exclusions','fp_purchase_orders','fp_po_items',
    'fp_transfer_orders','fp_transfer_items','fp_outlet_sku_settings'])
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "fp_auth_full" ON %I; '
      'CREATE POLICY "fp_auth_full" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
      t, t);
  END LOOP;
END $$;

-- ---------- WEEKLY AUTO-MIN-STOCK JOB ----------
-- Recomputes auto_min_stock from last 90 days of POS sales.
DO $$
BEGIN
    PERFORM cron.unschedule('fp_update_auto_min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
    'fp_update_auto_min',
    '0 2 * * 0',
    $$UPDATE fp_sku_master SET auto_min_stock = CEIL(COALESCE(
        (SELECT SUM(quantity_sold) FROM fp_pos_transactions
         WHERE sku_id = fp_sku_master.id
           AND transaction_date >= CURRENT_DATE - INTERVAL '90 days')
        / 90.0 * lead_time_days * safety_factor, 0))$$
);
