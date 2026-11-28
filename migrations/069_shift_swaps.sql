-- 069_shift_swaps.sql — SHIFT SWAPS, COVERS AND THE
-- OPEN-SHIFT POOL, PLUS STAFF AVAILABILITY (Nov 26, 2026;
-- plan Part 7, item 391, round-2 Gap 2; GENERAL, both
-- plans — her Q1–Q4 pattern: staff tools that serve
-- everyone go to everyone).
--
-- shift_swap_requests: one row per offer. A "shift" here is
-- a row of the recurring week (work_schedules: one row per
-- person per weekday), so an offer SNAPSHOTS the shift it
-- names (weekday + start/end) at offer time; approval
-- re-weighs the live schedule against the snapshot and
-- refuses rather than applying a swap to a shift that has
-- since changed.
--
--   kind 'pool'  — the shift is offered to the open pool;
--                  any active coworker in the SAME role may
--                  claim it (accepted_by_id is set at the
--                  claim).
--   kind 'trade' — the shift is offered to ONE named
--                  same-role coworker (target_id) in
--                  exchange for that coworker's own shift,
--                  snapshotted in the target_* columns.
--
--   status walks: pending → accepted → approved (a manager
--   decided yes and the schedule rows were rewritten in the
--   same transaction) / declined; pending or accepted →
--   cancelled (the requester withdrew) or declined (the
--   named coworker refused a trade, or a manager declined
--   with a reason). NOTHING lands without manager approval:
--   work_schedules is only ever rewritten by the approval
--   door.
--
-- staff_availability: one row per person per weekday —
-- the person's OWN record of when they can work. No row
-- means "not set" (no preference recorded); a row with
-- available = FALSE means they cannot work that day; a row
-- with start/end times means they can work inside that
-- window. Only the person themselves writes their rows.
--
-- Both tables carry the workforce family's foreign keys
-- (migration 007's shape): the business wipe cascades
-- through businesses / staff_members like the rest of the
-- workforce tables.

CREATE TABLE IF NOT EXISTS shift_swap_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES staff_members (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pool', 'trade')),
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  target_id TEXT REFERENCES staff_members (id) ON DELETE CASCADE,
  target_weekday SMALLINT CHECK (target_weekday BETWEEN 0 AND 6),
  target_start_time TEXT,
  target_end_time TEXT,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'approved', 'declined', 'cancelled')),
  accepted_by_id TEXT,
  decision_reason TEXT NOT NULL DEFAULT '',
  decided_by_id TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_business ON shift_swap_requests (business_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_availability (
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_member_id TEXT NOT NULL REFERENCES staff_members (id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  available BOOLEAN NOT NULL DEFAULT TRUE,
  start_time TEXT,
  end_time TEXT,
  note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, staff_member_id, weekday)
);
