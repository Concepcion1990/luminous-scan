-- 061_equipment.sql — EQUIPMENT RECORDS (Nov 26, 2026; plan
-- release 372, Gap 7 of the restaurant-gap research, the
-- owner's Q3 ruling of Nov 25, 2026: a GENERAL feature for
-- EVERY business that has machines, on BOTH plans — "do the
-- same thing for every business").
--
--   equipment_machines  one row per machine: bought when,
--                       warranty end, who services it, and
--                       the identifying details the owner
--                       wants kept (kind, make/model, serial,
--                       where it lives, notes). purchase_price
--                       is MONEY — owner/manager territory,
--                       stripped server-side for everyone else.
--   equipment_upkeep    the machine's recurring upkeep tasks
--                       (owner-named, owner-set cycle in days):
--                       last done + next due; the due state is
--                       computed, never stored stale.
--   equipment_events    the machine's history: breakdown
--                       reports (staff, via the owner-grant
--                       tick `equipment.report`, with a photo)
--                       and repairs (owner/manager: what was
--                       done, its cost, its outcome; a repair
--                       can close the breakdown it answers).
--
-- business_id carries NO foreign key (the migration-017
-- lesson); the billing wipe sweep deletes all three tables'
-- rows with the business.

CREATE TABLE IF NOT EXISTS equipment_machines (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  make_model TEXT NOT NULL DEFAULT '',
  serial_number TEXT NOT NULL DEFAULT '',
  location_name TEXT NOT NULL DEFAULT '',
  purchased_date TEXT,
  purchase_price NUMERIC,
  warranty_end TEXT,
  service_name TEXT NOT NULL DEFAULT '',
  service_phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS equipment_machines_business_idx
  ON equipment_machines (business_id, created_at ASC);

CREATE TABLE IF NOT EXISTS equipment_upkeep (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cycle_days INTEGER NOT NULL DEFAULT 30,
  last_done_date TEXT,
  next_due_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS equipment_upkeep_business_idx
  ON equipment_upkeep (business_id, machine_id, next_due_date ASC);

CREATE TABLE IF NOT EXISTS equipment_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('breakdown', 'repair')),
  description TEXT NOT NULL DEFAULT '',
  photo TEXT,
  cost NUMERIC,
  outcome TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  breakdown_id TEXT,
  reported_by_id TEXT,
  reported_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS equipment_events_business_idx
  ON equipment_events (business_id, machine_id, created_at DESC);
