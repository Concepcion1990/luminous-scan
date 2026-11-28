-- 066_standing_orders.sql — STANDING ORDERS (Nov 26, 2026;
-- plan release 377, Gap 8b). One recurring staple order,
-- set up once: a name, one supplier, the weekday it is
-- for (NULL = any day), and its lines as JSON
-- [{product_id, product_name, sku, qty, unit_cost}] —
-- the purchase-order line shape, so a standing order can
-- become a draft purchase order without translation.
--
-- A standing order is a TEMPLATE, never an order: making
-- the week's order writes ONE draft purchase order into
-- purchase_orders for the owner to confirm in Purchasing.
-- The app never sends an order on its own (no silent
-- changes, money edition). last_draft_at /
-- last_draft_number are the record of the most recent
-- draft this template produced.
--
-- The supplier price book needs no table: it is computed
-- at read time from the supplier_invoices and
-- purchase_orders rows the app already collects.
--
-- business_id carries NO foreign key (the migration-017
-- lesson); the billing wipe sweep deletes these rows
-- with the business.

CREATE TABLE IF NOT EXISTS standing_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  weekday INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  lines TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  last_draft_at TIMESTAMPTZ,
  last_draft_number TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS standing_orders_business_idx
  ON standing_orders (business_id, name ASC);
