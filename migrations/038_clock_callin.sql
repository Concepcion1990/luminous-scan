-- 038_clock_callin.sql — The clock build (Nov 21, 2026).
--
-- Three additions, all from the owner's rulings of Nov 20, 2026
-- (~9:14 PM + ~9:24 PM) and her hand-proofs of Nov 21:
--
-- call_in_windows: the call-in window. A staff member may clock
-- in only when a scheduled shift covers now, or when a call-in
-- window is open for them. The window is opened per person by
-- the owner, or by a manager holding the staff.clock tick; it
-- stays open until that person clocks out (the usual 10-minute
-- grace follows), and while open it is also that person's
-- sign-in path through the shift bracket. The opener can close
-- it early. Nothing closes it automatically. At most one open
-- window per person per business (enforced in the routes and by
-- the partial unique index below).
--
-- time_entries.called_in: a clock-in that rode an open call-in
-- window is marked, so the record says "Called in" instead of
-- pretending the shift was scheduled.
--
-- time_entries.missed_flagged_at: the missed-clock-out ledger.
-- The flag itself is computed live (an open entry whose
-- scheduled shift end has passed); this column only records
-- that the owner / ticked managers have already been BELLED
-- about it, so the bell rings exactly once. Set by the sweep
-- (and lazily when a clock admin reads the entries) in the same
-- statement that claims the row.
CREATE TABLE IF NOT EXISTS call_in_windows (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  staff_member_id TEXT NOT NULL,
  opened_by_id TEXT,
  opened_by_staff_id TEXT,
  opened_by_name TEXT NOT NULL DEFAULT '',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by_id TEXT,
  closed_by_staff_id TEXT,
  closed_by_name TEXT NOT NULL DEFAULT '',
  close_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_call_in_windows_member ON call_in_windows (business_id, staff_member_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_in_windows_one_open
  ON call_in_windows (business_id, staff_member_id) WHERE closed_at IS NULL;

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS called_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS missed_flagged_at TIMESTAMPTZ;
