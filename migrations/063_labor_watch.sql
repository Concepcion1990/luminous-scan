-- 063_labor_watch.sql — LABOR TARGET + OVERTIME/BREAK
-- WARNINGS (Nov 26, 2026; plan release 374, Gap 13, Q4
-- ruled Nov 25, 2026).
--
--   labor_watch_settings  one row per business: the
--                       owner's own watch numbers. Every
--                       column is nullable — NULL means
--                       the owner has not set that watch
--                       and the engine stays silent about
--                       it. There is deliberately NO
--                       default dressed up as a rule: the
--                       overtime line, how close counts as
--                       approaching, when a break is
--                       expected and how long it is, and
--                       the hours window are the owner's
--                       numbers for their own place
--                       (GENERAL warnings, both plans).
--                       labor_target_pct + expected_sales
--                       are the RESTAURANT face (Business-
--                       only): the target the projected
--                       labor % is measured against, and
--                       the expected sales for the week
--                       that give the percentage its
--                       denominator.
--
-- business_id carries NO foreign key (the migration-017
-- lesson); the billing wipe sweep deletes this table's
-- rows with the business.

CREATE TABLE IF NOT EXISTS labor_watch_settings (
  business_id TEXT PRIMARY KEY,
  overtime_hours NUMERIC,
  warn_within_hours NUMERIC,
  break_after_hours NUMERIC,
  break_minutes INTEGER,
  window_start TEXT,
  window_end TEXT,
  labor_target_pct NUMERIC,
  expected_sales NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
