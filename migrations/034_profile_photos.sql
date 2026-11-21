-- 034_profile_photos.sql — Profile photos + the owner's display
-- name (Nov 21, 2026).
--
-- The owner's rulings (Nov 19, 2026):
--   - Every person gets a photo beside their name in the header.
--     A staff member's or manager's photo appears NOWHERE until
--     the OWNER approves it (approval is the owner's alone — no
--     manager tick exists for this, and nobody approves their own
--     photo). Once approved it shows in the header, in the owner's
--     Staff list, and in Messages, Messenger-style. A change waits
--     the same way; while it waits — and if it is declined — the
--     person's current approved photo stays in place.
--   - The owner sets their own photo with no approval, and sets a
--     real display NAME that replaces the word "Owner" everywhere
--     it appears, on both ends. Until a name is set, "Owner"
--     remains the fallback label.
--
-- The owner's name is the person's own (users.display_name): one
-- name serves every business they own, the way their account
-- email does. Photos are per business, because approval belongs
-- to each business's owner: one row per (business, person) —
-- person_key 'owner' for the business's owner, or the staff
-- member's row id. A row holds at most two pictures: the APPROVED
-- one (the only bytes any client surface may ever be served) and
-- the PENDING one (served only to the business's owner, on the
-- Staff page where the decision lives, and to the person
-- themselves in their own Settings while they wait). The last
-- decision is kept on the row so the person's Settings can tell
-- them plainly what happened — including whether a declined
-- change left an earlier photo in place.
--
-- Bytes follow the app's private-file pattern (product photos
-- 020, carrier labels 025, voice notes 031): base64 TEXT in
-- Postgres, never on the app machine's ephemeral disk, served
-- only behind the session + business-membership check — never
-- through the public /api/photos/:id route.
--
-- business_id carries NO foreign key (the migration-017 lesson);
-- the wipe sweep deletes these rows explicitly by business_id.

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE TABLE IF NOT EXISTS profile_photos (
  business_id TEXT NOT NULL,
  person_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  approved_type TEXT,
  approved_data TEXT,
  approved_at TIMESTAMPTZ,
  pending_type TEXT,
  pending_data TEXT,
  pending_at TIMESTAMPTZ,
  decision TEXT,
  decision_had_approved BOOLEAN NOT NULL DEFAULT FALSE,
  decision_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, person_key)
);

CREATE INDEX IF NOT EXISTS idx_profile_photos_pending
  ON profile_photos (business_id, pending_at);
