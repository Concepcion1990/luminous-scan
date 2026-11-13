-- 005_business.sql — T5 Business-only modules (plan §2.11, §7 Phase T5).
--
-- Tables:
--   purchase_orders  supplier orders, created as `draft`, never silently
--                    `ordered` (server/entities.js forces draft on
--                    create; status moves only through the guarded
--                    transitions + the atomic receive endpoint in
--                    server/business.js).
--   boms             build lists (bundle / recipe): the finished product
--                    plus its component lines.
-- Suppliers, alert_rules and orders already exist from 003_shop.sql.
--
-- Conventions (as in 002/003): ids are app-generated UUIDs (TEXT);
-- audit columns created_at / updated_at on every row; created_by_id
-- (user id) + created_by (email) are the provenance inputs (PR #63).
-- Array/object fields are stored as TEXT holding JSON; money and
-- quantities are NUMERIC; date-only fields are TEXT in ISO form.

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  number TEXT NOT NULL DEFAULT '',
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ordered', 'partial', 'received', 'cancelled')),
  order_date TEXT,
  expected_date TEXT,
  received_date TEXT,
  location_id TEXT NOT NULL DEFAULT '',
  location_name TEXT NOT NULL DEFAULT '',
  lines TEXT NOT NULL DEFAULT '[]',
  subtotal NUMERIC NOT NULL DEFAULT 0,
  shipping NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  received_by TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_business_id ON purchase_orders (business_id);
CREATE INDEX IF NOT EXISTS idx_pos_business_status ON purchase_orders (business_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_business_supplier ON purchase_orders (business_id, supplier_id);

CREATE TABLE IF NOT EXISTS boms (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'bundle' CHECK (kind IN ('bundle', 'recipe')),
  lines TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_boms_business_id ON boms (business_id);
CREATE INDEX IF NOT EXISTS idx_boms_business_product ON boms (business_id, product_id);
