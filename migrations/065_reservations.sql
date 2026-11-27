-- 065_reservations.sql — RESERVATIONS BOOK + WALK-IN
-- WAITLIST + DEPOSIT LINE (Nov 26, 2026; plan release 376
-- with its two Part 7 riders).
--
--   reservations      one booking in the book: date and
--                     time, party name and size, phone and
--                     email, the table or section as a
--                     simple owner-named label, where it
--                     came from (phone / walk-in), its
--                     status, its notes, and the DEPOSIT
--                     LINE — deposit_amount + deposit_how,
--                     a record of a deposit already taken,
--                     never a payment and never a card hold.
--                     reminder_opt_in is the guest's own
--                     acceptance (Q6): only a guest who
--                     said yes is ever reminded, by email
--                     and by text. The two reminder_*_at
--                     stamps are the send record, one per
--                     channel, claimed by the reminder
--                     sweep before it sends.
--   waitlist_entries  tonight's living queue: name, party
--                     size, the wait they were quoted,
--                     phone and email. Handing over a
--                     number to be texted when the table
--                     is ready IS the opt-in for that text.
--                     ready_notified_at / ready_channel are
--                     the record of the "your table is
--                     ready" word; the quoted wait stays on
--                     the row after the party is seated,
--                     no-showed or dropped — the record is
--                     kept.
--
-- Guest contact details live only in these tables, in this
-- book — nothing here is exported anywhere.
--
-- business_id carries NO foreign key (the migration-017
-- lesson); the billing wipe sweep deletes both tables'
-- rows with the business.

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  res_date TEXT NOT NULL,
  res_time TEXT NOT NULL DEFAULT '',
  party_name TEXT NOT NULL DEFAULT '',
  party_size INTEGER NOT NULL DEFAULT 0,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  table_label TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'phone' CHECK (source IN ('phone', 'walk-in')),
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'seated', 'no-show', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  deposit_amount NUMERIC NOT NULL DEFAULT 0,
  deposit_how TEXT NOT NULL DEFAULT '',
  reminder_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_email_sent_at TIMESTAMPTZ,
  reminder_text_sent_at TIMESTAMPTZ,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reservations_business_idx
  ON reservations (business_id, res_date ASC, res_time ASC);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  party_name TEXT NOT NULL DEFAULT '',
  party_size INTEGER NOT NULL DEFAULT 0,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  quoted_wait_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'seated', 'no-show', 'dropped')),
  ready_notified_at TIMESTAMPTZ,
  ready_channel TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS waitlist_business_idx
  ON waitlist_entries (business_id, created_at ASC);
