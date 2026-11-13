-- 017_support_reports.sql — In-app issue reporting (Support phase).
--
-- A signed-in user of ANY role, on ANY plan — including a workspace
-- whose subscription has not been paid yet — can file a "Report a
-- problem" note from Settings. A person locked out by a bug needs
-- the door most, so the endpoint is account-level (never plan-gated)
-- and the row is the record of truth: the notification email to the
-- owner is a copy, and its failure never loses the report.
--
-- business_id carries NO foreign key on purpose, and names/roles
-- are snapshotted on the row: a report must survive the business
-- (or the whole account) being deleted by the wipe sweep — the
-- snapshot is what the report said at the time, and the support
-- history must not cascade away with the shop (the same lesson
-- migration 010 taught for pay stubs). user_id likewise carries no
-- FK: the reporter email snapshot keeps the reply path readable
-- even after the account is gone.
--
-- context holds the fixing details the app attaches automatically
-- (page, plan, locale, user-agent) as JSON in TEXT, per the
-- codebase's JSON-in-TEXT convention (migrations 003/005/007).
-- No inventory data is ever stored here.

CREATE TABLE IF NOT EXISTS support_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reporter_email TEXT NOT NULL DEFAULT '',
  business_id TEXT,
  business_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('broken', 'looks_wrong', 'idea', 'other')),
  message TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_reports_user_created ON support_reports (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_reports_created ON support_reports (created_at DESC);
