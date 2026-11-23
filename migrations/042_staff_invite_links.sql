-- 042_staff_invite_links.sql — Single-use staff invite links
-- (Nov 22, 2026).
--
-- The owner's ruling (Nov 22, 2026): "that one link that the
-- owner sends over to their staff member is used only once
-- and if they don't use it when they click on it then the
-- owner has to send another link." Before this migration the
-- invite email's link carried NO secret at all — it was the
-- register page with the invited email prefilled, and the
-- staff_members row matched by email was the whole invite.
--
-- These columns give each staff row ONE live invite link:
--   invite_token_hash  SHA-256 of the token in the emailed
--                      URL (the token itself is never stored).
--   invite_claim_hash  SHA-256 of the claim secret held by
--                      the browser session that first opened
--                      the link — the "same visit" proof.
--   invite_link_state  'fresh' (sent, never opened) ->
--                      'opened' (first open claimed it) ->
--                      'used' (the signup completed, or the
--                      signed-in email owner accepted) or
--                      'spent' (a different session presented
--                      a wrong claim — the link is dead).
--   invite_issued_at / invite_opened_at: the stamps.
--
-- Every (re)send of the invite email mints a fresh token and
-- overwrites these columns, so the previous link dies the
-- instant a new one is sent. Rows whose columns are NULL are
-- LEGACY invites (sent before this build; their plain
-- ?email= links are already in inboxes) and keep the old
-- email-match activation — see server/inviteLinks.js and the
-- flip guard in server/staff.js.
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS invite_token_hash TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS invite_claim_hash TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS invite_link_state TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS invite_issued_at TIMESTAMPTZ;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS invite_opened_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_staff_members_invite_token ON staff_members (invite_token_hash) WHERE invite_token_hash IS NOT NULL;
