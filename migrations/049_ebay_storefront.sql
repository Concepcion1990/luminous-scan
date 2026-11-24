-- 049_ebay_storefront.sql — Release 362 (Nov 23, 2026):
-- the eBay storefront connection.
--
-- The owner's ruling (Nov 23, 2026): storefront connections
-- are BOTH PLANS — a seller connects their eBay storefront
-- once, and from then on an eBay sale drops the product's
-- count in the app by itself, recorded like a sale scanned
-- out. (Till connections stay Business only; a storefront
-- is not a till.) One-way only: eBay → app.
--
-- Mechanically eBay is one more provider over the shared
-- POS core (migrations 015/016/019): the same connections,
-- events, lines and mappings tables, the same idempotency
-- anchor, the same ledger writer. This migration only:
--
--   1. widens the provider CHECKs on pos_connections,
--      pos_sale_events and pos_item_mappings to admit
--      'ebay' (pos_sale_lines carries no provider column);
--   2. widens the pos_sale_events source CHECK to admit
--      'sweep' — the catch-up pull of eBay orders is a
--      third arrival road beside 'webhook' and 'csv';
--   3. adds ebay_sweep_state — one row per eBay connection
--      carrying the catch-up sweep's watermark, so a missed
--      notification never loses a sale;
--   4. adds ebay_account_deletions — the audit row for the
--      MARKETPLACE_ACCOUNT_DELETION notifications eBay
--      mandates its subscribers handle: when an eBay user
--      asks eBay to delete their data, any connection of
--      theirs here is severed and the handling is recorded.
--      The app stores no eBay buyer data, so the seller's
--      own connection material is all there is to remove.
--
-- Constraint names differ by engine (the migration-016/019
-- lesson): real Postgres auto-names them <table>_<col>_check
-- plus the _v16/_v19 names those migrations re-added, while
-- pg-mem (the test database) numbers them
-- <table>_constraint_<n>. The drops name every candidate and
-- the rules are re-added under fresh _v49 names: whichever
-- candidate was live, the end state on both engines enforces
-- exactly the same sets (a rule may end up stated twice on
-- real Postgres — harmless duplication, on purpose, exactly
-- as 016 and 019 did).

ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_provider_check;
ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_provider_chk_v19;
ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_constraint_1;
ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_constraint_2;
ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_constraint_3;
ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_constraint_4;
ALTER TABLE pos_connections
  ADD CONSTRAINT pos_connections_provider_chk_v49
  CHECK (provider IN ('square', 'shopify', 'clover', 'toast', 'lightspeed', 'zettle', 'stripe_terminal', 'wix', 'ebay'));

ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_provider_check;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_provider_chk_v16;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_provider_chk_v19;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_status_check;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_status_chk_v16;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_source_check;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_source_chk_v16;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_1;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_2;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_3;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_4;
ALTER TABLE pos_sale_events
  ADD CONSTRAINT pos_sale_events_provider_chk_v49
  CHECK (provider IN ('square', 'shopify', 'clover', 'toast', 'lightspeed', 'zettle', 'stripe_terminal', 'wix', 'csv', 'ebay'));
ALTER TABLE pos_sale_events
  ADD CONSTRAINT pos_sale_events_status_chk_v49
  CHECK (status IN ('applied', 'partially_applied', 'held_unmatched', 'refused', 'held_plan'));
ALTER TABLE pos_sale_events
  ADD CONSTRAINT pos_sale_events_source_chk_v49
  CHECK (source IN ('webhook', 'csv', 'sweep'));

ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_provider_check;
ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_provider_chk_v19;
ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_constraint_1;
ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_constraint_2;
ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_constraint_3;
ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_constraint_4;
ALTER TABLE pos_item_mappings
  ADD CONSTRAINT pos_item_mappings_provider_chk_v49
  CHECK (provider IN ('square', 'shopify', 'clover', 'toast', 'lightspeed', 'zettle', 'stripe_terminal', 'wix', 'csv', 'ebay'));

CREATE TABLE IF NOT EXISTS ebay_sweep_state (
  connection_id TEXT PRIMARY KEY REFERENCES pos_connections (id) ON DELETE CASCADE,
  last_sweep_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ebay_account_deletions (
  id TEXT PRIMARY KEY,
  ebay_user_id TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ebay_account_deletions_user ON ebay_account_deletions (ebay_user_id, received_at DESC);
