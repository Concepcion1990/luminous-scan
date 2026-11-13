-- 011_recovery.sql — Account recovery kit.
--
-- The spare-key machinery for a customer who loses access to the
-- email their account is under (the owner's own lived experience):
--
--   users.backup_email            a second address the account holder
--                                 verified while safely signed in;
--                                 recovery codes are sent here.
--   users.backup_email_verified   only a VERIFIED backup email can
--                                 receive recovery codes.
--   users.pending_backup_email    the address awaiting its code.
--   users.pending_new_email       the address a change-email flow is
--                                 verifying; promoted to users.email
--                                 only when its code checks out.
--   sessions.scope                'full' (a normal sign-in) or
--                                 'recovery' (a short-lived session
--                                 granted by a spare key; it can reach
--                                 ONLY the change-email flow — enforced
--                                 in server/app.js).
--   account_codes                 emailed 6-digit codes for the kit
--                                 (backup-email verification, recovery
--                                 entry, new-email confirmation) —
--                                 hashed exactly like otp_codes (T2),
--                                 in their own table so the T2 purpose
--                                 CHECK on otp_codes stays untouched.
--   backup_codes                  the one-time spare keys themselves:
--                                 SHA-256(salt + code) only, never
--                                 plaintext; each row works once.
--
-- Sign-in stays email + password only (owner's standing decision):
-- none of this adds a sign-in door. The recovery session is an
-- emergency exit that opens onto exactly one room — change email.

ALTER TABLE users ADD COLUMN backup_email TEXT;
ALTER TABLE users ADD COLUMN backup_email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN pending_backup_email TEXT;
ALTER TABLE users ADD COLUMN pending_new_email TEXT;

ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'full';

CREATE TABLE IF NOT EXISTS account_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('backup_email', 'recover', 'change_email')),
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_codes_user_purpose ON account_codes (user_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS backup_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user_id ON backup_codes (user_id);
