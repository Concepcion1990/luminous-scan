-- 016_pos_plan_gate.sql — POS plan gate (owner's ruling, Nov 13, 2026).
--
-- Till connections are a BUSINESS PLAN ONLY feature (the owner's
-- ruling, like Rewards). A store that connected its till on
-- Business and later moves to Essentials keeps selling at that
-- till; its webhook sales must be neither silently lost nor
-- applied against a plan that does not include POS. They are
-- recorded HELD FOR PLAN instead:
--
--   pos_sale_events.status and pos_sale_lines.status gain the
--   value 'held_plan'. A held-for-plan event's lines are recorded
--   verbatim (status 'held_plan', no movement written) and can be
--   applied — exactly once, through the same ledger — from the
--   Till Connections page once the business is on Business again.
--
-- Only the status CHECKs widen; no columns change. Constraint
-- names differ by engine: real Postgres auto-names them
-- <table>_status_check, while pg-mem (the test database) numbers
-- them <table>_constraint_<n> (the events status check is its
-- constraint_2 — verified by direct insert). So the drops name
-- every candidate, and the rules are re-added under fresh _v16
-- names: whichever candidate was the live one, the end state on
-- both engines enforces exactly the same rules (the provider /
-- source rules may end up stated twice on real Postgres —
-- harmless duplication, noted here on purpose).

ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_status_check;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_1;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_2;
ALTER TABLE pos_sale_events DROP CONSTRAINT IF EXISTS pos_sale_events_constraint_3;
ALTER TABLE pos_sale_events
  ADD CONSTRAINT pos_sale_events_provider_chk_v16
  CHECK (provider IN ('square', 'shopify', 'csv'));
ALTER TABLE pos_sale_events
  ADD CONSTRAINT pos_sale_events_status_chk_v16
  CHECK (status IN ('applied', 'partially_applied', 'held_unmatched', 'refused', 'held_plan'));
ALTER TABLE pos_sale_events
  ADD CONSTRAINT pos_sale_events_source_chk_v16
  CHECK (source IN ('webhook', 'csv'));

ALTER TABLE pos_sale_lines DROP CONSTRAINT IF EXISTS pos_sale_lines_status_check;
ALTER TABLE pos_sale_lines DROP CONSTRAINT IF EXISTS pos_sale_lines_constraint_1;
ALTER TABLE pos_sale_lines
  ADD CONSTRAINT pos_sale_lines_status_chk_v16
  CHECK (status IN ('applied', 'unmatched', 'insufficient_stock', 'ignored', 'held_plan'));
