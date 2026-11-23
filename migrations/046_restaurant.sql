-- 046_restaurant.sql — Release 359 (Nov 23, 2026): the
-- restaurant corner's foundation.
--
-- Tables:
--   recipes  a dish: the owner's recipe for one sellable
--            product (or a sub-recipe other dishes use). Lines
--            are JSON, the house pattern: a product line
--            {kind:'product', product_id, product_name, sku,
--            unit, quantity, yield_pct} or a sub-recipe line
--            {kind:'recipe', recipe_id, recipe_name, quantity}
--            (quantity = units of the sub-recipe's output).
--            status 'draft' never depletes; only 'active'
--            recipes take ingredients off the shelf when the
--            linked product sells. yield_qty is how many units
--            of the dish ONE make produces; q_factor_pct is the
--            costing-only extra (salt, oil, garnish — research:
--            3–5%) and never changes a depletion quantity.
--            location_id is the prep zone, named from the
--            business's own Locations.
--   pars     one par level per product (optionally per
--            location): how much should be on the shelf.
--            pack_size + supplier ride the par because products
--            carry no pack size of their own — the order guide
--            rounds the need UP to this pack, for this supplier.
--
-- stock_movements gains cause_movement_id: a depletion
-- ('consume') row names the SALE movement that caused it. The
-- pair (business_id, cause_movement_id) is the idempotency key
-- (a redelivered sale depletes once) and the reversal key
-- (reversing the sale restores exactly its own consume rows).
--
-- Additive only, like every migration since 040: no existing
-- table is altered beyond the one new nullable column.

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active')),
  yield_qty NUMERIC NOT NULL DEFAULT 1,
  q_factor_pct NUMERIC NOT NULL DEFAULT 0,
  photo_url TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  lines TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recipes_business_id ON recipes (business_id);
CREATE INDEX IF NOT EXISTS idx_recipes_business_product ON recipes (business_id, product_id);
CREATE INDEX IF NOT EXISTS idx_recipes_business_status ON recipes (business_id, status);

CREATE TABLE IF NOT EXISTS pars (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  par_qty NUMERIC NOT NULL DEFAULT 0,
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  pack_size NUMERIC NOT NULL DEFAULT 1,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pars_business_id ON pars (business_id);
CREATE INDEX IF NOT EXISTS idx_pars_business_product ON pars (business_id, product_id);

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS cause_movement_id TEXT;
CREATE INDEX IF NOT EXISTS idx_movements_business_cause ON stock_movements (business_id, cause_movement_id);
