-- 019_pos_providers_deletion.sql — POS provider expansion + the
-- account-deletion REQUEST endpoint (owner's batch, Nov 14, 2026).
--
-- PART 1 — the six remaining till providers join the shared POS
-- core (migration 015): clover, toast, lightspeed, zettle
-- (PayPal Zettle), stripe_terminal, wix. The only schema change
-- is the provider CHECK on the three POS tables that carry one:
-- pos_connections, pos_sale_events and pos_item_mappings widen to
-- the full provider set ('csv' stays an events/mappings-only
-- pseudo-provider, never a connection). pos_sale_lines carries
-- no provider column (its provider is its event's), so it is
-- untouched.
--
-- Constraint names differ by engine (the migration-016 lesson):
-- real Postgres auto-names them <table>_provider_check, pg-mem
-- (the test database) numbers them <table>_constraint_<n>, and
-- migration 016 already re-added the EVENTS provider rule under
-- a _v16 name. So — exactly like 016 — the drops name every
-- candidate and the rules are re-added under fresh _v19 names.
-- Whichever candidate was live, the end state on both engines
-- enforces exactly the same set (a rule may end up stated twice
-- on real Postgres — harmless duplication, on purpose).
--
-- PART 2 — account_deletion_requests: the Settings "Delete
-- account" flow's server side. The flow is a REQUEST FOR REVIEW
-- by design: submitting it stores a row and notifies the owner;
-- it deletes nothing and cancels nothing (the actual deletion,
-- when a request is approved, runs through the existing
-- cancel-to-wipe machinery, never from this table's writer).
-- user_id / user_email are snapshots with NO foreign key, in the
-- migration-017 support_reports shape: a request must survive
-- the account it concerns, so the review history never cascades
-- away with the shop.

ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_provider_check;
ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_constraint_1;
ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_constraint_2;
ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_constraint_3;
ALTER TABLE pos_connections DROP CONSTRAINT IF EXISTS pos_connections_constraint_4;
ALTER TABLE pos_connections
  ADD CONSTRAINT pos_connections_provider_chk_v19
  CHECK (provider IN ('square', 'shopify', 'clover', 'toast', 'lightspeed', 'zettle', 'stripe_terminal', 'wix'));

ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_provider_check;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_provider_chk_v16;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_1;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_2;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_3;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_4;
ALTER TABLE pos_sale_events
  ADD CONSTRAINT pos_sale_events_provider_chk_v19
  CHECK (provider IN ('square', 'shopify', 'clover', 'toast', 'lightspeed', 'zettle', 'stripe_terminal', 'wix', 'csv'));

ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_provider_check;
ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_constraint_1;
ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_constraint_2;
ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_constraint_3;
ALTER TABLE pos_item_mappings DROP CONSTRAINT IF EXISTS pos_item_mappings_constraint_4;
ALTER TABLE pos_item_mappings
  ADD CONSTRAINT pos_item_mappings_provider_chk_v19
  CHECK (provider IN ('square', 'shopify', 'clover', 'toast', 'lightspeed', 'zettle', 'stripe_terminal', 'wix', 'csv'));

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'under_review', 'completed', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_user_created ON account_deletion_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_created ON account_deletion_requests (created_at DESC);
