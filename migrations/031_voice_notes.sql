-- 031_voice_notes.sql — Voice notes in team Messages (Nov 19, 2026).
--
-- A message gains a KIND: 'text' (everything that exists today)
-- or 'voice'. A voice message's row carries an empty body; the
-- recording itself lives in message_voice_notes, one row per
-- message, following the app's private-file pattern (product
-- photos in 020, carrier labels in 025): bytes in Postgres as
-- base64, never on the app machine's ephemeral disk, served only
-- behind the session + conversation-access check.
--
-- Every stored recording is MP3: the server converts whatever
-- the phone's browser produced (WebM/Opus on Android, MP4/AAC
-- on iPhone) into the one format every phone plays, so a note
-- recorded on one kind of phone is heard on the other. The
-- conversion changes the container only — never the voice.
-- content_type records the STORED format ('audio/mpeg');
-- duration_ms is the sender-reported length, for display.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';

CREATE TABLE IF NOT EXISTS message_voice_notes (
  message_id TEXT PRIMARY KEY REFERENCES messages (id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  size_bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  data_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_voice_notes_business_idx
  ON message_voice_notes (business_id);
