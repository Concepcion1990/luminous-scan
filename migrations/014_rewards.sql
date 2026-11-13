-- 014_rewards.sql — Rewards & incentives (Rewards phase).
--
-- A reward is issued INSIDE one business to one team member
-- (a staff_members row — the business OWNER is never a recipient
-- and has no row to receive with). The giver is the owner or a
-- manager: giver_user_id is the account that gave it,
-- giver_staff_id is set for a manager giver (the owner has no
-- staff row), and giver_role snapshots 'owner' | 'manager' so the
-- void hierarchy (giver or owner; a manager never voids the
-- owner's gift) survives later role changes.
--
-- kind: 'percent_off' uses percent_value; 'gift_card' uses amount
-- + currency; 'custom' uses detail (the giver's own words — the
-- "any incentive" case). title/description are always the giver's
-- words. Recipient and actor NAMES are snapshotted on the row so
-- the business's reward history survives offboarding (the same
-- lesson migration 010 taught for pay stubs: never let a staff-row
-- delete cascade away the books).
--
-- code: a human-friendly redemption code, unique PER BUSINESS
-- (UNIQUE (business_id, code)) — 8 characters from the unambiguous
-- backup-code alphabet (no I, L, O, 0 or 1), shown grouped as
-- XXXX-XXXX. The recipient shows it at the till; an owner/manager
-- marks it redeemed in the app. Live POS redemption arrives with
-- the POS phase — the code lives in the app until then.
--
-- status: 'active' | 'redeemed' | 'void'. redeemed_* and voided_*
-- record who closed the reward and when.

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  recipient_staff_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  recipient_email TEXT NOT NULL DEFAULT '',
  giver_user_id TEXT,
  giver_staff_id TEXT,
  giver_name TEXT NOT NULL DEFAULT '',
  giver_role TEXT NOT NULL DEFAULT 'owner' CHECK (giver_role IN ('owner', 'manager')),
  kind TEXT NOT NULL CHECK (kind IN ('percent_off', 'gift_card', 'custom')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  percent_value NUMERIC,
  amount NUMERIC,
  currency TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'void')),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at TIMESTAMPTZ,
  redeemed_by_id TEXT,
  redeemed_by_staff_id TEXT,
  redeemed_by_name TEXT NOT NULL DEFAULT '',
  redeemed_by_role TEXT NOT NULL DEFAULT '',
  voided_at TIMESTAMPTZ,
  voided_by_id TEXT,
  voided_by_staff_id TEXT,
  voided_by_name TEXT NOT NULL DEFAULT '',
  voided_by_role TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, code)
);
CREATE INDEX IF NOT EXISTS idx_rewards_business_created ON rewards (business_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_rewards_recipient ON rewards (business_id, recipient_staff_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_rewards_giver ON rewards (business_id, giver_user_id, issued_at DESC);
