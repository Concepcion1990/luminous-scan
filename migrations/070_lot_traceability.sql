-- 070_lot_traceability.sql — LOT CODES, THE RECALL FINDER
-- AND SUPPLIER TRACEABILITY (Nov 26, 2026; plan Part 7,
-- item 392, round-2 Gap 7 + its two receiving riders + the
-- owner-ruled SUPPLIER TRACEABILITY strengthening of the
-- same evening).
--
-- The receiving/batch record is stock_batches (migration
-- 048): a dated slice of stock for one product at one
-- location. This migration gives that record its lot life:
--
--   stock_batches.lot_code       the lot/batch stamp read
--                                off the case at receiving,
--                                captured PER ITEM with its
--                                supplier (supplier_id +
--                                supplier_name ride the same
--                                row — traceability piece 1).
--   stock_batches.status         'active' | 'pulled' — a
--                                pulled batch is QUARANTINED:
--                                locked from use; the pull
--                                itself is its own record
--                                (lot_pulls below).
--   stock_batches.actual_weight  CATCH-WEIGHT receiving:
--                                for by-weight items, the
--                                weight that ACTUALLY arrived
--                                (+ weight_unit), so the true
--                                cost per pound/kilo — and
--                                the recipe costs standing on
--                                it — stay honest. The
--                                distributor-scale count+
--                                weight-through-everything
--                                version is out of scope.
--
--   stock_movements.lot_code     the lot CARRIED THROUGH
--                                movements: every movement
--                                written for a lot-stamped
--                                batch names the lot, so the
--                                recall finder can answer
--                                "did any of it move?"
--   waste_entries.lot_code       a PULLED lot flows into
--                                the costed waste log with
--                                reason 'recall' and its lot
--                                named on the waste row.
--
--   lot_pulls                    the pull record the health
--                                department and the supplier
--                                ask for afterward: which lot,
--                                which product, how much was
--                                left, why, who pulled it,
--                                and the waste entry + movement
--                                the pull wrote.
--   receiving_checks             the RECEIVING CHECK LOG —
--                                one row per back-door check:
--                                the delivery temperature for
--                                cold goods, and anything
--                                REFUSED with its reason (a
--                                refusal is exactly the
--                                evidence a supplier credit
--                                memo wants attached).
--
-- HONEST SIZING (the plan's own words): this is the
-- restaurant's recall drill, NOT distributor-grade FSMA 204
-- KDE/CTE record-keeping; formal traceability compliance
-- is a heavier build and is not claimed here.
--
-- Additive only, like every migration since 040.

ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS lot_code TEXT NOT NULL DEFAULT '';
ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS supplier_id TEXT NOT NULL DEFAULT '';
ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS supplier_name TEXT NOT NULL DEFAULT '';
ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS actual_weight NUMERIC;
ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS weight_unit TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_stock_batches_business_lot ON stock_batches (business_id, lot_code);
CREATE INDEX IF NOT EXISTS idx_stock_batches_business_supplier ON stock_batches (business_id, supplier_name);

ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS lot_code TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_movements_business_lot ON stock_movements (business_id, lot_code);

ALTER TABLE waste_entries ADD COLUMN IF NOT EXISTS lot_code TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS lot_pulls (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  lot_code TEXT NOT NULL DEFAULT '',
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  quantity NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  waste_entry_id TEXT,
  movement_id TEXT,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lot_pulls_business_id ON lot_pulls (business_id);
CREATE INDEX IF NOT EXISTS idx_lot_pulls_business_lot ON lot_pulls (business_id, lot_code);

CREATE TABLE IF NOT EXISTS receiving_checks (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  lot_code TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  temperature NUMERIC,
  scale TEXT NOT NULL DEFAULT 'F',
  refused BOOLEAN NOT NULL DEFAULT FALSE,
  refusal_reason TEXT NOT NULL DEFAULT '',
  actual_weight NUMERIC,
  weight_unit TEXT NOT NULL DEFAULT '',
  batch_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receiving_checks_business_id ON receiving_checks (business_id);
CREATE INDEX IF NOT EXISTS idx_receiving_checks_business_lot ON receiving_checks (business_id, lot_code);
