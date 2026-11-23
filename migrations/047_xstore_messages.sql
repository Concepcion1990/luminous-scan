-- 047_xstore_messages.sql — Cross-store messages (Nov 23,
-- 2026): the owner's second messaging door.
--
-- The in-store inbox (008) is hard-scoped to ONE business: a
-- thread is a pair of people inside one store, and the owner
-- found she could only ever pick people from the store she was
-- standing in. Her ruling: leave that inbox exactly as it is,
-- and add a NEW door whose scope is the ACCOUNT — everyone
-- under one owner, across all their businesses (two, three,
-- up to five). Any member of a Business account (owner,
-- manager, staff) can message any other member of the SAME
-- account, whichever business they belong to.
--
-- The scope key is therefore account_owner_id — the user id of
-- the owner whose businesses these are. Every table carries
-- it and every query in server/xstoreMessageRoutes.js filters
-- by it, so a thread can never leak across accounts: both
-- participants are validated against the account's directory
-- (the owner + active staff rows of the owner's businesses,
-- resolved to signed-in users) before a thread can exist.
--
-- A participant here is a signed-in USER, not a staff row: one
-- person can hold staff rows in several of the account's
-- businesses and is still ONE person in this door. The pair is
-- stored normalized (participant_a_user_id <
-- participant_b_user_id) with a UNIQUE constraint per account,
-- so a pair can only ever have ONE cross-store thread.
--
-- xstore_messages.delivered_at is stamped by the server at
-- insert: the message has landed in the other person's account
-- inbox (this app delivers to a server-side inbox; there is no
-- device hop to wait for). read_at is the per-message read
-- stamp, set when the other participant opens the conversation
-- — a thread is strictly 1:1, so each message has exactly ONE
-- possible reader and one nullable stamp is unambiguous. The
-- owner's read state is hidden from non-owners at the shaping
-- layer (the Nov 19, 2026 read-receipt law), never by the data.
--
-- Voice notes mirror 031: the recording lives in
-- xstore_voice_notes, one row per voice message, converted to
-- MP3 by the same server path (server/voiceNote.js) before
-- anything is stored, and served only from the door's own file
-- route behind the same participant check as the thread.
--
-- Business-only: the routes refuse any account whose governing
-- plan is not Business (the plan_gated refusal), the nav door
-- and the lessons carry the feature key, and nothing of this
-- schema is ever read for an Essentials account. Additive
-- only: the 008 inbox tables are untouched.

CREATE TABLE IF NOT EXISTS xstore_threads (
  id TEXT PRIMARY KEY,
  account_owner_id TEXT NOT NULL,
  participant_a_user_id TEXT NOT NULL,
  participant_b_user_id TEXT NOT NULL,
  origin_business_id TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_owner_id, participant_a_user_id, participant_b_user_id),
  CHECK (participant_a_user_id < participant_b_user_id)
);
CREATE INDEX IF NOT EXISTS idx_xstore_threads_account
  ON xstore_threads (account_owner_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_xstore_threads_a
  ON xstore_threads (account_owner_id, participant_a_user_id);
CREATE INDEX IF NOT EXISTS idx_xstore_threads_b
  ON xstore_threads (account_owner_id, participant_b_user_id);

CREATE TABLE IF NOT EXISTS xstore_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES xstore_threads (id) ON DELETE CASCADE,
  account_owner_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'text',
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_xstore_messages_thread
  ON xstore_messages (thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_xstore_messages_unread
  ON xstore_messages (thread_id, read_at);

CREATE TABLE IF NOT EXISTS xstore_voice_notes (
  message_id TEXT PRIMARY KEY REFERENCES xstore_messages (id) ON DELETE CASCADE,
  account_owner_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  data_base64 TEXT NOT NULL
);
