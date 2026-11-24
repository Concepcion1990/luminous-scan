-- 048_restaurant_ops.sql — Release 361 (Nov 23, 2026):
-- restaurant operations, the deferred set on 359's foundation.
--
-- products gains the kitchen facts the corner needs:
--   allergens       TEXT holding a JSON array of allergen keys
--                   (the allergen matrix reads it; '' = none
--                   recorded yet, the TEXT/'' house pattern for
--                   JSON columns on products — see tags).
--   unit_conversions TEXT holding a JSON array [{unit, per}]
--                   — per = how many of that unit make ONE
--                   stock unit (1 kg = 1000 g → {unit:'g',
--                   per:1000}). Recipe lines may be written in
--                   any converted unit; the math layer
--                   (server/recipes.js lineStockQty) turns them
--                   back into stock units for cost + depletion.
--   shelf_life_days nullable INTEGER — how long a prepped
--                   batch keeps; NULL = no shelf life recorded.
--
-- New tables (all business-scoped, audit columns like 046):
--   stock_batches     expiry lots: a quantity of one product
--                     at one location with a use-by date. The
--                     FEFO surface reads these; stock itself
--                     still lives in stock_levels — a batch is
--                     a dated slice of it, not a second ledger.
--   waste_entries     the costed waste log: what was thrown
--                     away, why (fixed reason codes:
--                     spoilage|overproduction|prep_mistake|
--                     returned|spillage|other), and the unit
--                     cost snapshot at log time. The matching
--                     stock-out rides a 'write_off' movement;
--                     THIS table is the cost/qty source of
--                     truth for reports.
--   temp_logs         temperature checks: unit, reading,
--                     scale ('C'|'F'), in_range flag and the
--                     corrective action taken. created_at +
--                     created_by carry the who + when (the
--                     357 trail pattern).
--   eighty_six_items  the 86 board: a product marked out at a
--                     location until cleared (cleared_at /
--                     cleared_by stamp the clearing).
--   supplier_invoices a supplier's bill, optionally tied to
--                     the purchase order it bills
--                     (purchase_order_id + po_number snapshot).
--                     lines are JSON [{product_id,
--                     product_name, quantity, unit_cost}]. The
--                     3-way match against the PO is computed at
--                     read time (server/restaurantOps.js), never
--                     stored — the PO can still be received
--                     against after the invoice lands.
--   vendor_price_alerts one open alert per invoice + product
--                     whose billed cost differs from the
--                     product's current cost; answering
--                     'accepted' writes the new cost onto the
--                     product, 'dismissed' leaves it.
--   batch_runs        a batch production run: M makes of a
--                     recipe whose linked prep product gains
--                     yield_qty × M units (one 'produce'
--                     movement) while the recipe's full
--                     expansion is consumed, keyed
--                     cause_movement_id = the produce
--                     movement. lines is the consumed snapshot
--                     [{product_id, product_name, quantity}].
--   staff_meals       staff meals as a usage category: the
--                     dish/product, how many meals, and the
--                     'staff_meal' stock-out movement they
--                     wrote (movement_id NULL when the dish
--                     was at zero — the meal is still
--                     recorded, honestly).
--
-- Additive only, like every migration since 040: products
-- gains three columns, nothing existing is altered.

ALTER TABLE products ADD COLUMN IF NOT EXISTS allergens TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_conversions TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;

CREATE TABLE IF NOT EXISTS stock_batches (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  quantity NUMERIC NOT NULL DEFAULT 0,
  expires_on DATE,
  note TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_batches_business_id ON stock_batches (business_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_business_product ON stock_batches (business_id, product_id);
CREATE INDEX IF NOT EXISTS idx_stock_batches_business_expires ON stock_batches (business_id, expires_on);

CREATE TABLE IF NOT EXISTS waste_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  quantity NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'other',
  unit_cost NUMERIC,
  movement_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waste_entries_business_id ON waste_entries (business_id);
CREATE INDEX IF NOT EXISTS idx_waste_entries_business_product ON waste_entries (business_id, product_id);

CREATE TABLE IF NOT EXISTS temp_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  temperature NUMERIC,
  scale TEXT NOT NULL DEFAULT 'F',
  in_range BOOLEAN NOT NULL DEFAULT TRUE,
  corrective_action TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_temp_logs_business_id ON temp_logs (business_id);

CREATE TABLE IF NOT EXISTS eighty_six_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  cleared_at TIMESTAMPTZ,
  cleared_by TEXT,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eighty_six_business_id ON eighty_six_items (business_id);
CREATE INDEX IF NOT EXISTS idx_eighty_six_business_active ON eighty_six_items (business_id, active);

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  purchase_order_id TEXT,
  po_number TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  invoice_date DATE,
  lines TEXT NOT NULL DEFAULT '[]',
  total NUMERIC,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'accepted')),
  note TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_business_id ON supplier_invoices (business_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_business_po ON supplier_invoices (business_id, purchase_order_id);

CREATE TABLE IF NOT EXISTS vendor_price_alerts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  invoice_id TEXT,
  old_cost NUMERIC,
  new_cost NUMERIC,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed')),
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_price_alerts_business_id ON vendor_price_alerts (business_id);
CREATE INDEX IF NOT EXISTS idx_vendor_price_alerts_business_status ON vendor_price_alerts (business_id, status);

CREATE TABLE IF NOT EXISTS batch_runs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  recipe_id TEXT NOT NULL DEFAULT '',
  recipe_name TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  makes NUMERIC NOT NULL DEFAULT 0,
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  output_qty NUMERIC,
  lines TEXT NOT NULL DEFAULT '[]',
  produce_movement_id TEXT,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batch_runs_business_id ON batch_runs (business_id);
CREATE INDEX IF NOT EXISTS idx_batch_runs_business_recipe ON batch_runs (business_id, recipe_id);

CREATE TABLE IF NOT EXISTS staff_meals (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  recipe_id TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  movement_id TEXT,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_meals_business_id ON staff_meals (business_id);
CREATE INDEX IF NOT EXISTS idx_staff_meals_business_product ON staff_meals (business_id, product_id);

-- The paper invoice itself (her ruling, Nov 23, 2026): an
-- invoice may carry ONE attached file — a photo or PDF of the
-- supplier's paper — stored the house way (base64 in Postgres,
-- served only behind the session + gate, staff-documents
-- pattern) at the universal 25 MB upload cap. One row per
-- invoice; uploading again replaces the paper copy.
CREATE TABLE IF NOT EXISTS supplier_invoice_files (
  invoice_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  data_base64 TEXT NOT NULL,
  uploaded_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_supplier_invoice_files_business
  ON supplier_invoice_files (business_id);
