-- 033_training_builds.sql — The training builds (Nov 20, 2026).
--
-- Four rulings land here:
--
-- 1. TRAINING INTEGRITY. The Workforce "First training" task's
--    Done button must check real training completion, so work
--    tasks gain a `kind`: 'task' for ordinary tasks, 'training'
--    for a task whose Done is gated on the assignee's training
--    being genuinely finished. Rows the owner already titled
--    "First training" are that task in her own words, so the
--    backfill marks them.
--
--    Every lesson gains a quiz (answered correctly before the
--    lesson counts complete — the owner is exempt), and a member
--    can leave the owner a comment on a lesson. Quiz attempts and
--    comments file into training_quiz_results /
--    training_lesson_comments, read back through the person's
--    staff record on the Training page's Team section. No bell
--    rings per lesson; the ONE all-training-done bell is an
--    existence-checked workforce_notifications row written by
--    server/trainingCore.js.
--
-- 2. THE OWNER'S QUIZ on her own Store Policies + Terms (the
--    release-321 documents). policy_questions holds the owner's
--    questions per document (multiple choice with a marked
--    correct choice, or open with an expected answer — unlimited
--    count, owner-written only). policy_quiz_settings holds the
--    owner's passing line per document. policy_quiz_attempts
--    holds each person's run: their chosen + typed answers, the
--    multiple-choice score, and the review state (a typed answer
--    the owner has not accepted yet keeps needs_review true; the
--    owner may accept it or send the training back).
--
-- business_id carries NO foreign key (the migration-017 lesson);
-- the wipe sweep deletes these rows explicitly by business_id.

ALTER TABLE work_tasks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'task';

UPDATE work_tasks SET kind = 'training'
 WHERE kind = 'task' AND LOWER(title) = 'first training';

CREATE TABLE IF NOT EXISTS training_quiz_results (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  person_key TEXT NOT NULL,
  person_name TEXT NOT NULL DEFAULT '',
  lesson_id TEXT NOT NULL,
  total INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  passed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS training_quiz_results_person_idx
  ON training_quiz_results (business_id, person_key, created_at DESC);

CREATE TABLE IF NOT EXISTS training_lesson_comments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  person_key TEXT NOT NULL,
  person_name TEXT NOT NULL DEFAULT '',
  lesson_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS training_lesson_comments_person_idx
  ON training_lesson_comments (business_id, person_key, created_at DESC);

CREATE TABLE IF NOT EXISTS policy_questions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  doc_kind TEXT NOT NULL,
  kind TEXT NOT NULL,
  question TEXT NOT NULL,
  choices JSONB NOT NULL DEFAULT '[]',
  correct_index INTEGER,
  expected_answer TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS policy_questions_business_idx
  ON policy_questions (business_id, doc_kind, position ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS policy_quiz_settings (
  business_id TEXT NOT NULL,
  doc_kind TEXT NOT NULL,
  pass_percent INTEGER NOT NULL DEFAULT 80,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, doc_kind)
);

CREATE TABLE IF NOT EXISTS policy_quiz_attempts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  doc_kind TEXT NOT NULL,
  person_key TEXT NOT NULL,
  person_name TEXT NOT NULL DEFAULT '',
  answers JSONB NOT NULL DEFAULT '[]',
  mc_total INTEGER NOT NULL DEFAULT 0,
  mc_correct INTEGER NOT NULL DEFAULT 0,
  score_percent INTEGER,
  status TEXT NOT NULL DEFAULT 'passed',
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS policy_quiz_attempts_person_idx
  ON policy_quiz_attempts (business_id, person_key, doc_kind, created_at DESC);
