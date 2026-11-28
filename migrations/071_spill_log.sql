-- 071_spill_log.sql — SPILL & BREAKAGE LOG (Nov 26, 2026;
-- plan Part 7, item 392A, owner-ruled addition).
--
-- One row per spill or breakage at the bar: when it
-- happened (created_at), the item, how much was spilled
-- or broken, why (the reason, in the logger's words), and
-- who recorded it (created_by). The log lives with the
-- BAR-COUNTING family: it exists only while the owner has
-- bar counting turned on for the business (migration 067,
-- businesses.bar_counting_enabled).
--
-- LOSS, THE WASTE LOG'S WAY: a spill is loss exactly the
-- way the waste log (release 361, migration 048) treats
-- loss — the entry snapshots the product's current cost
-- (unit_cost), the stock-out rides ONE 'write_off'
-- movement through recordMovementTx (stock_movements,
-- movement_id here), and a costed row lands in
-- waste_entries with reason 'spill' or 'breakage'
-- (waste_entry_id here), so variance and the accounting
-- ledger see the loss once, in the family's own books.
-- No second depletion path is invented. When the shelf
-- holds less than the entry claims, the movement is
-- refused for insufficient stock and the entry still
-- records with movement_id NULL — the waste log's clamp:
-- the spill happened; the count was already off.
--
-- MONEY: unit_cost is stored on the row whoever logged
-- it, but the pour cost (quantity × unit cost) is SHAPED
-- at read: it rides the payload ONLY for the owner
-- (owner-only money, the bar family's discipline as the
-- plan rules for 392A). Everyone else's payload carries
-- neither unit_cost nor total_cost.
--
-- Additive only, like every migration since 040.

CREATE TABLE IF NOT EXISTS spill_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  quantity NUMERIC NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'spill',
  reason TEXT NOT NULL DEFAULT '',
  unit_cost NUMERIC,
  movement_id TEXT,
  waste_entry_id TEXT,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spill_entries_business_id ON spill_entries (business_id);
CREATE INDEX IF NOT EXISTS idx_spill_entries_business_product ON spill_entries (business_id, product_id);
