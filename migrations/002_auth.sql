-- 002_auth.sql — T2 auth + businesses (plan §5.1, §4.3).
--
-- Tables:
--   users                twin accounts (email + password, verification state)
--   sessions             revocable server-side sessions (cookie holds id+signature)
--   otp_codes            emailed 6-digit codes, HASHED (never plaintext),
--                        single-use, 10-minute expiry, max 5 attempts
--   businesses           owner businesses (created_by_id = provenance)
--   business_memberships user <-> business links (role owner/member)
--
-- Conventions: ids are app-generated UUIDs (TEXT) so no DB extension is
-- needed; audit columns created_at / updated_at on every row; emails are
-- stored lowercased and unique. TrialHistory is T4 — deliberately NOT
-- created here. No Entitlement/Subscription rows are created by auth.
-- Passwords are bcrypt hashes (see server/passwords.js); OTP codes are
-- SHA-256(salt + code) — see server/otp.js. Neither is ever plaintext.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  -- FK to businesses is added below (businesses is created after users).
  active_business_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_user_purpose ON otp_codes (user_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  created_by_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_businesses_owner_id ON businesses (owner_id);

CREATE TABLE IF NOT EXISTS business_memberships (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_by_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON business_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_business_id ON business_memberships (business_id);

-- Deferred FK: users.active_business_id -> businesses.id (businesses is
-- created after users in this file, so the constraint is added here).
-- This file runs exactly once per database (tracked in schema_migrations),
-- so no IF NOT EXISTS guard is needed.
ALTER TABLE users
  ADD CONSTRAINT users_active_business_id_fk
  FOREIGN KEY (active_business_id) REFERENCES businesses (id) ON DELETE SET NULL;
