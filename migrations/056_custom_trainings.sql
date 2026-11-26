-- 056_custom_trainings.sql — "Add your own training" (Nov 25, 2026).
--
-- The training-page sectioning build's second half: at the very
-- end of the Training page, a box mirroring the release-321
-- Settings policies/terms machinery (migration 032) and the
-- owner's-quiz machinery (migration 033), in its new home.
--
-- The owner writes their OWN trainings — a title and the material
-- (their OSHA rules, their precautions, their way of doing
-- things) — typed in or uploaded as a file, either or, exactly
-- like the policies documents. Each training carries its own
-- quiz the owner builds: UNLIMITED questions, multiple-choice
-- and written-answer mixed freely in one quiz. The owner sets
-- the passing score per training. Written answers are judged the
-- owner's choice, per training: 'auto' (checked near-exact
-- against the owner's answer key, on the spot) or 'review' (sent
-- to the owner, who marks the training pass or sends it back).
--
-- Assignment is by tick: custom_training_assignments holds
-- exactly the staff members the owner ticked for each training —
-- only they see it and owe the quiz. Multiple trainings can be
-- created from the one box; there is no limit.
--
-- Scope: BOTH plans, per-business private — nothing an owner
-- writes ever appears in another business. Completion is
-- server-checked like every lesson (release 334 pattern): an
-- attempt is scored on the server, and a training counts done
-- only when a passed attempt stands (in review mode, when the
-- owner marks it passed). The OWNER never takes their own quiz
-- (quiz-exempt, like every quiz in the app).
--
-- business_id carries NO foreign key (the migration-017 lesson);
-- the wipe sweep deletes these rows explicitly by business_id
-- (server/billing.js).

CREATE TABLE IF NOT EXISTS custom_trainings (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  material_text TEXT NOT NULL DEFAULT '',
  pass_percent INTEGER NOT NULL DEFAULT 80,
  written_mode TEXT NOT NULL DEFAULT 'auto' CHECK (written_mode IN ('auto', 'review')),
  created_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS custom_trainings_business_idx
  ON custom_trainings (business_id, created_at ASC);

CREATE TABLE IF NOT EXISTS custom_training_files (
  training_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS custom_training_files_business_idx
  ON custom_training_files (business_id);

CREATE TABLE IF NOT EXISTS custom_training_questions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  training_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  question TEXT NOT NULL,
  choices JSONB NOT NULL DEFAULT '[]',
  correct_index INTEGER,
  expected_answer TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS custom_training_questions_training_idx
  ON custom_training_questions (business_id, training_id, position ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS custom_training_assignments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  training_id TEXT NOT NULL,
  person_key TEXT NOT NULL,
  person_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (training_id, person_key)
);
CREATE INDEX IF NOT EXISTS custom_training_assignments_person_idx
  ON custom_training_assignments (business_id, person_key, created_at ASC);

CREATE TABLE IF NOT EXISTS custom_training_attempts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  training_id TEXT NOT NULL,
  person_key TEXT NOT NULL,
  person_name TEXT NOT NULL DEFAULT '',
  answers JSONB NOT NULL DEFAULT '[]',
  total INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  score_percent INTEGER,
  status TEXT NOT NULL DEFAULT 'passed',
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS custom_training_attempts_person_idx
  ON custom_training_attempts (business_id, person_key, training_id, created_at DESC);
