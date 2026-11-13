-- 008_inbox.sql — Workforce inbox follow-up: 1:1 team messaging
-- inside the app (the notifications themselves live in
-- workforce_notifications from 007; this migration adds the
-- conversation tables).
--
-- A "participant" is a PERSON in the workforce sense: a staff_members
-- row, or the business OWNER, who is not a staff row. Each participant
-- has a key inside a business: the staff_member_id for team members,
-- the literal 'owner' for the business owner. A thread is one pair of
-- people in one business; the pair is stored normalized
-- (participant_a_key < participant_b_key) with a UNIQUE constraint so
-- a pair can only ever have ONE thread per business.
--
-- Participant user ids and display names are denormalized onto the
-- thread at creation: notifications and inbox lists key off users,
-- and a thread list should not need a join per row. If a person is
-- later renamed, old threads keep the name they started with — the
-- same trade-off workforce_notifications.actor_name already makes.
--
-- messages.read_at is the per-message read stamp. A thread is
-- strictly 1:1, so each message has exactly ONE possible reader —
-- the other participant — and one nullable stamp is unambiguous.
-- A participant's unread count for a thread is their received
-- messages with read_at IS NULL.
--
-- PRIVACY (the owner's rule): a person can list, read and post ONLY
-- in threads they participate in. The business owner may LIST and
-- READ every thread in their own business (oversight of their store)
-- but may only POST in threads where they are a participant. All of
-- this is enforced server-side in workforceRoutes.js; these tables
-- hold no access logic of their own.

CREATE TABLE IF NOT EXISTS message_threads (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  participant_a_key TEXT NOT NULL,
  participant_b_key TEXT NOT NULL,
  participant_a_user_id TEXT NOT NULL,
  participant_b_user_id TEXT NOT NULL,
  participant_a_staff_id TEXT,
  participant_b_staff_id TEXT,
  participant_a_name TEXT NOT NULL DEFAULT '',
  participant_b_name TEXT NOT NULL DEFAULT '',
  participant_a_role TEXT NOT NULL DEFAULT 'staff',
  participant_b_role TEXT NOT NULL DEFAULT 'staff',
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, participant_a_key, participant_b_key),
  CHECK (participant_a_key < participant_b_key)
);
CREATE INDEX IF NOT EXISTS idx_message_threads_business ON message_threads (business_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_threads_a ON message_threads (business_id, participant_a_key);
CREATE INDEX IF NOT EXISTS idx_message_threads_b ON message_threads (business_id, participant_b_key);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES message_threads (id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL,
  sender_staff_id TEXT,
  sender_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages (thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages (thread_id, read_at);
