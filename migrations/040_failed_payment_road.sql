-- 040_failed_payment_road.sql — the failed-payment road
-- (owner's ruling Nov 19, 2026; staff-access ruling Nov 20, 2026;
-- built Nov 21, 2026, release 341).
--
-- A verified invoice.payment_failed starts a 14-day FULL-USE grace.
-- Day 15 the subscription is cancelled; 15 VIEW-ONLY days follow
-- (every role can look, nobody can change anything, staff can
-- still reach their own pay stubs — the shift bracket does not
-- gate those days); then the Nov 7 cancel→wipe sweep deletes the
-- account exactly as it does for a voluntary cancel.
--
-- The road's markers live on the subscriptions row (the billing
-- record of truth) and are MIRRORED onto the entitlements row,
-- which is what the access gate reads:
--   payment_failed_at       the FIRST verified failure of the
--                           current episode (retries never move it)
--   payment_grace_ends_at   payment_failed_at + 14 days: full use
--                           ends, cancellation + view-only begin
--   payment_warning_sent_at (subscriptions only) the ledger claim
--                           for the owner's one warning (bell +
--                           email) fired 3 days before grace ends
--   payment_road_canceled_at (subscriptions only) when the day-15
--                           transition ran app-side
--
-- A verified payment (invoice.paid grant, or the subscription
-- returning to active) clears every marker in the grant's own
-- transaction — recovery leaves no trace. Founding-tester comped
-- workspaces have no subscriptions row at all, so they can never
-- enter this road.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_grace_ends_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_warning_sent_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_road_canceled_at TIMESTAMPTZ;

ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ;
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS payment_grace_ends_at TIMESTAMPTZ;
