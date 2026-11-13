-- 009_training.sql — Training phase: per-person lesson progress
-- and training assignments (manual + the role-grant flag).
--
-- PEOPLE: the workforce identity convention (see 008): a person is
-- keyed inside a business by their staff_member_id, or the literal
-- 'owner' for the business owner (who is not a staff row). Person
-- user ids and display names are denormalized onto each row, the
-- same trade-off workforce_notifications and message_threads make:
-- lists should not need a join per row.
--
-- training_progress: one row per person per finished lesson.
-- Marking complete is idempotent — the UNIQUE constraint makes a
-- double-tap a no-op rather than a second row.
--
-- training_assignments: one assignment teaches ONE module (a set of
-- lesson ids captured at assignment time, as JSON-in-TEXT to match
-- the codebase convention). source is 'manual' (owner/manager picked
-- it) or 'role_grant' (created automatically when the person's role
-- or permissions grew — the owner's training-flag rule). due_date
-- NULL means no deadline; a deadline is a business-local calendar
-- date. status/completed_at are a cache: whether an assignment is
-- really complete is derived from training_progress (every lesson
-- in lesson_ids finished), and the routes refresh the cache when
-- they read or when the last lesson lands.
--
-- warning_sent_at records the most recent overdue warning; the
-- warning itself is a workforce_notifications bell, like every
-- other team event.

CREATE TABLE IF NOT EXISTS training_progress (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  person_key TEXT NOT NULL,
  person_user_id TEXT,
  person_name TEXT NOT NULL DEFAULT '',
  lesson_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, person_key, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_training_progress_business ON training_progress (business_id, person_key);
CREATE INDEX IF NOT EXISTS idx_training_progress_lesson ON training_progress (business_id, lesson_id);

CREATE TABLE IF NOT EXISTS training_assignments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  assignee_key TEXT NOT NULL,
  assignee_staff_id TEXT,
  assignee_user_id TEXT,
  assignee_name TEXT NOT NULL DEFAULT '',
  assignee_level TEXT NOT NULL DEFAULT 'staff',
  module TEXT NOT NULL,
  lesson_ids TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'role_grant')),
  assigned_by_user_id TEXT,
  assigned_by_staff_id TEXT,
  assigned_by_name TEXT NOT NULL DEFAULT '',
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'completed')),
  completed_at TIMESTAMPTZ,
  warning_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_assignments_business ON training_assignments (business_id, assignee_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_training_assignments_module ON training_assignments (business_id, module);
