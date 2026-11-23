-- 045_time_trails.sql — time trails (owner's spec, queued
-- Nov 22, 2026; built in release 357). Every record that moves
-- through stages carries a trail of stamps: DATE + TIME on every
-- stamp, and WHO performed each stage. The stage stamps that
-- already existed were written by the client (shipped_at /
-- shipped_by, approved_at / approved_by, completed_at /
-- completed_by, applied_at / applied_by, cancelled_at with no
-- actor at all); from this release the SERVER stamps them at the
-- transition, in server/entities.js, and the client's word for a
-- stamp is never taken.
--
-- This migration only ADDS the missing columns — additive, all
-- nullable or defaulted, nothing backfilled. Existing records
-- keep honest history: they show their real created stamp (and
-- any stage stamp truly written before) and gain stamps only
-- for stages that happen from go-live onward. Nothing here
-- invents a stamp for a stage that predates the build.
--
-- The *_by columns hold the actor's display NAME as stamped at
-- the transition (the house attribution shape); the *_by_id
-- columns hold the actor's user id so reads can resolve the
-- person's CURRENT display name, and an actor whose account is
-- gone resolves to a neutral fallback instead of a stale name.

-- Orders: Packed and Delivered had no stamp at all; Cancelled
-- had a time but no actor; Shipped had no actor id.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packed_by_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_by TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_by_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_by_id TEXT;

-- Returns: Rejected had no stamp at all; Approved and Completed
-- had no actor id.
ALTER TABLE returns ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS rejected_by TEXT NOT NULL DEFAULT '';
ALTER TABLE returns ADD COLUMN IF NOT EXISTS rejected_by_id TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS approved_by_id TEXT;
ALTER TABLE returns ADD COLUMN IF NOT EXISTS completed_by_id TEXT;

-- Counts: Sent-for-review, Saved (a draft save of the lines) and
-- Cancelled had no stamp at all; Applied had no actor id.
ALTER TABLE count_sessions ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ;
ALTER TABLE count_sessions ADD COLUMN IF NOT EXISTS saved_by TEXT NOT NULL DEFAULT '';
ALTER TABLE count_sessions ADD COLUMN IF NOT EXISTS saved_by_id TEXT;
ALTER TABLE count_sessions ADD COLUMN IF NOT EXISTS review_at TIMESTAMPTZ;
ALTER TABLE count_sessions ADD COLUMN IF NOT EXISTS review_by TEXT NOT NULL DEFAULT '';
ALTER TABLE count_sessions ADD COLUMN IF NOT EXISTS review_by_id TEXT;
ALTER TABLE count_sessions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE count_sessions ADD COLUMN IF NOT EXISTS cancelled_by TEXT NOT NULL DEFAULT '';
ALTER TABLE count_sessions ADD COLUMN IF NOT EXISTS cancelled_by_id TEXT;
ALTER TABLE count_sessions ADD COLUMN IF NOT EXISTS applied_by_id TEXT;
