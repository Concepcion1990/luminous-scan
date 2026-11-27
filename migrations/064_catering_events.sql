-- 064_catering_events.sql — CATERING & PRIVATE EVENTS, THE
-- SIMPLE VERSION (Nov 26, 2026; plan release 375, Gap 11).
--
--   catering_events  one booked party: its name, date and
--                    time, party size, the host's name and
--                    phone, its status, its notes, and its
--                    menu — the business's own recipes with
--                    the servings picked for each, as JSON
--                    in TEXT (the codebase convention).
--                    event_total + deposit are OWNER-ONLY
--                    MONEY: the routes strip both (and the
--                    balance they imply) for every non-owner
--                    reader, and the staff copy of the event
--                    sheet never prints them.
--
-- The simple version only, deliberately: no contracts, no
-- e-signatures, no payments taken here — the deposit is a
-- record of money already taken, the way the owner took it.
--
-- business_id carries NO foreign key (the migration-017
-- lesson); the billing wipe sweep deletes this table's
-- rows with the business.

CREATE TABLE IF NOT EXISTS catering_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL,
  event_time TEXT NOT NULL DEFAULT '',
  party_size INTEGER NOT NULL DEFAULT 0,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'done', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  menu TEXT NOT NULL DEFAULT '[]',
  event_total NUMERIC NOT NULL DEFAULT 0,
  deposit NUMERIC NOT NULL DEFAULT 0,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS catering_events_business_idx
  ON catering_events (business_id, event_date ASC);
