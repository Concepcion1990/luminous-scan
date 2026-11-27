-- 058_checklists.sql — CHECKLISTS (Nov 26, 2026; plan release
-- 369, Gap 2 of the restaurant-gap research, the owner's Q1
-- ruling of Nov 24, 2026: a GENERAL feature for EVERY business
-- on BOTH plans — "Do it for everyone").
--
-- The checklist ENGINE, built cleanly so a later food-safety
-- build (the mock-inspection self-check, plan 370) reuses it:
--
--   checklist_templates    a named list of items the owner
--                          builds (opening, closing, cleaning,
--                          anything else). An item may require
--                          PROOF — a photo, a scan, or a typed
--                          temperature — before it can be
--                          ticked. A template is ASSIGNED by
--                          role or by shift and runs on a
--                          schedule: daily, weekly (same
--                          weekday), or once (its start date).
--   checklist_instances    one template materialised for one
--                          day: the item list is SNAPSHOT at
--                          materialisation, so editing a
--                          template never rewrites a day that
--                          already happened. Unique per
--                          (template, run_date) — a day is
--                          materialised exactly once.
--   checklist_completions  one row per ticked item: WHO ticked
--                          it (server-stamped name, never an
--                          email, never anonymous), WHEN, and
--                          the proof the item required.
--
-- Template management rides an owner-grant tick,
-- `checklists.manage`, off by default (her standing doctrine
-- for staff-facing powers); ticking items off is plain staff
-- work and needs no tick. business_id carries NO foreign key
-- (the migration-017 lesson); the billing wipe sweep deletes
-- all three tables' rows with the business.

CREATE TABLE IF NOT EXISTS checklist_templates (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  assign_type TEXT NOT NULL DEFAULT 'everyone',
  assign_value TEXT NOT NULL DEFAULT '',
  schedule TEXT NOT NULL DEFAULT 'daily',
  weekday INTEGER,
  start_date TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS checklist_templates_business_idx
  ON checklist_templates (business_id, created_at ASC);

CREATE TABLE IF NOT EXISTS checklist_instances (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  title TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  assign_type TEXT NOT NULL DEFAULT 'everyone',
  assign_value TEXT NOT NULL DEFAULT '',
  run_date TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS checklist_instances_template_day_key
  ON checklist_instances (template_id, run_date);
CREATE INDEX IF NOT EXISTS checklist_instances_business_day_idx
  ON checklist_instances (business_id, run_date DESC);

CREATE TABLE IF NOT EXISTS checklist_completions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  completed_by_id TEXT,
  completed_by_name TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proof_type TEXT NOT NULL DEFAULT 'none',
  proof_value TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS checklist_completions_item_key
  ON checklist_completions (instance_id, item_id);
CREATE INDEX IF NOT EXISTS checklist_completions_business_idx
  ON checklist_completions (business_id, instance_id);
