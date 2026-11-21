-- 037_founding_tester_comp.sql — The founding-tester comp build
-- (Nov 21, 2026).
--
-- Ten real businesses (five English-based, five Spanish-based,
-- one spot reserved for a restaurant) test the app before
-- launch; in exchange, Business is FREE FOR LIFE for them. The
-- owner controls who is on the list — nobody self-serves onto
-- it, and the list's existence is never advertised anywhere in
-- the app or the signup flow.
--
-- founding_tester_comp: the operator-only list. Only the
-- platform operator (the publisher/operator account) can view,
-- add, or end entries — the routes live in
-- server/compRoutes.js behind the publisher identity check.
-- An entry is an EMAIL: when a new account signs up with a
-- listed email, its workspace is born on Business with the
-- founding-tester mark (an entitlements row whose status is
-- 'founding_tester' — app data only, never a Stripe object),
-- and it never sees checkout, a trial, or a bill.
--
-- status: 'active' while the invitation stands, 'ended' when
-- the operator ends the entry or when the account itself is
-- fully deleted (the ONLY way a granted comp ends — the wipe
-- sweep marks the entry in the same transaction that deletes
-- the user). Ending a list entry never revokes a workspace
-- that was already granted.
--
-- founding_tester_comp_config: the program's single settings
-- row. The cap starts at 10 and is stored (not hard-coded) so
-- the operator can raise it later without a code change.
CREATE TABLE IF NOT EXISTS founding_tester_comp (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  claimed_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_by_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_founding_tester_comp_email ON founding_tester_comp (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_founding_tester_comp_status ON founding_tester_comp (status);

CREATE TABLE IF NOT EXISTS founding_tester_comp_config (
  id INTEGER PRIMARY KEY,
  cap INTEGER NOT NULL DEFAULT 10
);
INSERT INTO founding_tester_comp_config (id, cap) VALUES (1, 10)
  ON CONFLICT (id) DO NOTHING;
