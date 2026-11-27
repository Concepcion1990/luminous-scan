-- 062_tip_pooling.sql — TIP POOLING + TIP REPORTING RECORDS
-- (Nov 26, 2026; plan release 373, Gap 3, with its round-2
-- records rider, round-2 Gap 10).
--
--   tip_pool_settings   one row per business: the owner's
--                       pool shape — method 'hours' | 'role'
--                       | 'points', the per-role percentages
--                       and the per-person points, both as
--                       JSON in TEXT (the codebase convention).
--   tip_pool_runs       one split of one pool over one
--                       period: the amount, the method it
--                       was split by, and whether the owner
--                       has published the shares to staff.
--   tip_pool_shares     one person's share of one run, with
--                       the clock hours and basis it came
--                       from, and name/role snapshots.
--   tip_report_periods  one tip-reporting period of the year
--                       record: the establishment's gross
--                       receipts for the period and the
--                       allocation method the owner chose
--                       ('gross_receipts' | 'hours' |
--                       'good_faith' — the IRS's own
--                       published methods, as arithmetic).
--   tip_reports         per person, per period: the tips
--                       they reported, their gross receipts,
--                       their hours, and (good-faith method)
--                       the allocation amount the owner
--                       entered.
--
-- Records only: nothing here files anything. business_id
-- carries NO foreign key (the migration-017 lesson); the
-- billing wipe sweep deletes all five tables' rows with
-- the business.

CREATE TABLE IF NOT EXISTS tip_pool_settings (
  business_id TEXT PRIMARY KEY,
  method TEXT NOT NULL DEFAULT 'hours' CHECK (method IN ('hours', 'role', 'points')),
  role_percentages TEXT NOT NULL DEFAULT '{}',
  points TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tip_pool_runs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  pool_amount NUMERIC NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'hours',
  published BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tip_pool_runs_business_idx
  ON tip_pool_runs (business_id, period_start DESC);

CREATE TABLE IF NOT EXISTS tip_pool_shares (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  staff_member_id TEXT NOT NULL,
  person_name TEXT NOT NULL DEFAULT '',
  role_name TEXT NOT NULL DEFAULT '',
  hours NUMERIC NOT NULL DEFAULT 0,
  basis NUMERIC NOT NULL DEFAULT 0,
  share_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tip_pool_shares_business_idx
  ON tip_pool_shares (business_id, run_id, staff_member_id);

CREATE TABLE IF NOT EXISTS tip_report_periods (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  gross_receipts NUMERIC NOT NULL DEFAULT 0,
  allocation_method TEXT NOT NULL DEFAULT 'hours' CHECK (allocation_method IN ('gross_receipts', 'hours', 'good_faith')),
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tip_report_periods_business_idx
  ON tip_report_periods (business_id, period_start DESC);

CREATE TABLE IF NOT EXISTS tip_reports (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  staff_member_id TEXT NOT NULL,
  person_name TEXT NOT NULL DEFAULT '',
  tips_reported NUMERIC NOT NULL DEFAULT 0,
  gross_receipts NUMERIC NOT NULL DEFAULT 0,
  hours NUMERIC NOT NULL DEFAULT 0,
  allocation_amount NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_id, staff_member_id)
);
CREATE INDEX IF NOT EXISTS tip_reports_business_idx
  ON tip_reports (business_id, period_id, staff_member_id);
