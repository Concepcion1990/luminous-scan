-- 003_shop.sql — T3 core shop (plan §5.1, §7 Phase T3).
--
-- Tables:
--   entitlements     per-business plan row (T4 billing builds on this;
--                    until T4 lands, a missing row means Essentials —
--                    see server/plans.js planFor()). No grant route
--                    exists in T3: rows are only written by tests
--                    (direct SQL) and, from T4, by Stripe-verified flows.
--   products, categories, locations, stock_levels, stock_movements,
--   staff_members, staff_roles, suppliers, alert_rules, orders,
--   returns, count_sessions, listings
-- NOT created here (T5): purchase_orders, boms. Their entity reads
-- are stubbed empty server-side; writes refuse with bundles/po
-- staying in T5.
--
-- Conventions (as in 002_auth.sql): ids are app-generated UUIDs
-- (TEXT); audit columns created_at / updated_at on every row;
-- created_by_id (user id) + created_by (email) are the provenance
-- inputs (PR #63 rule — see server/authz.js). Array/object fields
-- are stored as TEXT holding JSON (deterministic on pg-mem and real
-- Postgres alike; the server serialises/deserialises them).
-- Money/quantities are NUMERIC; *_at are TIMESTAMPTZ; date-only
-- fields (acquisition_date, expiration_date, order_date, ...) are
-- TEXT in ISO form, as the ported pages send them.

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE REFERENCES businesses (id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'essentials' CHECK (plan IN ('essentials', 'business')),
  status TEXT NOT NULL DEFAULT 'pending_checkout',
  trial_ends_at TIMESTAMPTZ,
  period_ends_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_entitlements_business_id ON entitlements (business_id);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  upc TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  qr_code TEXT NOT NULL DEFAULT '',
  isbn TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  copy_group TEXT NOT NULL DEFAULT '',
  variant_label TEXT NOT NULL DEFAULT '',
  variant_options TEXT NOT NULL DEFAULT '[]',
  photo_urls TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'each',
  cost NUMERIC,
  price NUMERIC,
  reorder_point NUMERIC NOT NULL DEFAULT 0,
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NOT NULL DEFAULT '',
  subcategory TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  brand TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  edition TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  fulfillment_method TEXT NOT NULL DEFAULT 'owner_stocked',
  acquisition_date TEXT,
  weight TEXT NOT NULL DEFAULT '',
  dimensions TEXT NOT NULL DEFAULT '',
  batch_lot TEXT NOT NULL DEFAULT '',
  expiration_date TEXT,
  serial_number TEXT NOT NULL DEFAULT '',
  warranty TEXT NOT NULL DEFAULT '',
  custom_fields TEXT NOT NULL DEFAULT '[]',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_business_id ON products (business_id);
CREATE INDEX IF NOT EXISTS idx_products_business_sku ON products (business_id, sku);
CREATE INDEX IF NOT EXISTS idx_products_business_upc ON products (business_id, upc);
CREATE INDEX IF NOT EXISTS idx_products_business_barcode ON products (business_id, barcode);
CREATE INDEX IF NOT EXISTS idx_products_business_isbn ON products (business_id, isbn);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  parent_id TEXT,
  parent_name TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_business_id ON categories (business_id);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'store',
  parent_id TEXT,
  parent_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_locations_business_id ON locations (business_id);

CREATE TABLE IF NOT EXISTS stock_levels (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations (id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL DEFAULT 0,
  reserved NUMERIC NOT NULL DEFAULT 0,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, product_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_levels_business_product ON stock_levels (business_id, product_id);
CREATE INDEX IF NOT EXISTS idx_levels_business_location ON stock_levels (business_id, location_id);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  location_id TEXT NOT NULL DEFAULT '',
  location_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  previous_qty NUMERIC NOT NULL DEFAULT 0,
  new_qty NUMERIC NOT NULL DEFAULT 0,
  to_location_id TEXT NOT NULL DEFAULT '',
  to_location_name TEXT NOT NULL DEFAULT '',
  scanned_code TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  reversal_of_id TEXT,
  reversal_of_label TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_movements_business_created ON stock_movements (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_business_product ON stock_movements (business_id, product_id);

CREATE TABLE IF NOT EXISTS staff_members (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  app_role TEXT NOT NULL DEFAULT 'user',
  role_id TEXT,
  role_name TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'invited',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_business_email ON staff_members (business_id, email);
CREATE INDEX IF NOT EXISTS idx_staff_business_status ON staff_members (business_id, status);

CREATE TABLE IF NOT EXISTS staff_roles (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '[]',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_roles_business_id ON staff_roles (business_id);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  lead_time_days NUMERIC,
  address TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_business_id ON suppliers (business_id);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'low_stock',
  threshold NUMERIC NOT NULL DEFAULT 0,
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  location_ids TEXT NOT NULL DEFAULT '[]',
  location_names TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_business_id ON alert_rules (business_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  number TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_ref TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'new',
  type TEXT NOT NULL DEFAULT 'sale',
  order_date TEXT,
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  lines TEXT NOT NULL DEFAULT '[]',
  discount NUMERIC NOT NULL DEFAULT 0,
  shipping NUMERIC NOT NULL DEFAULT 0,
  tax NUMERIC NOT NULL DEFAULT 0,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  carrier TEXT NOT NULL DEFAULT '',
  tracking_ref TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  reserved_at TIMESTAMPTZ,
  reserved_by TEXT NOT NULL DEFAULT '',
  shipped_at TIMESTAMPTZ,
  shipped_by TEXT NOT NULL DEFAULT '',
  cancelled_at TIMESTAMPTZ,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_business_id ON orders (business_id);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  number TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'return',
  type TEXT NOT NULL DEFAULT 'refund',
  status TEXT NOT NULL DEFAULT 'new',
  reason TEXT NOT NULL DEFAULT '',
  order_id TEXT,
  order_number TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  received_date TEXT,
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  lines TEXT NOT NULL DEFAULT '[]',
  exchange_lines TEXT NOT NULL DEFAULT '[]',
  refund_amount NUMERIC NOT NULL DEFAULT 0,
  refund_note TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  approved_at TIMESTAMPTZ,
  approved_by TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  completed_by TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_returns_business_id ON returns (business_id);

CREATE TABLE IF NOT EXISTS count_sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  number TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  scope_note TEXT NOT NULL DEFAULT '',
  lines TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ,
  started_by TEXT NOT NULL DEFAULT '',
  applied_at TIMESTAMPTZ,
  applied_by TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_counts_business_id ON count_sessions (business_id);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT,
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  price NUMERIC,
  quantity_listed NUMERIC NOT NULL DEFAULT 0,
  external_id TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  listed_on TEXT,
  last_checked TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_listings_business_id ON listings (business_id);
