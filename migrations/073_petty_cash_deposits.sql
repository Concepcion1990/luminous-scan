-- 073_petty_cash_deposits.sql — PETTY CASH + BANK DEPOSIT
-- LOG (Nov 26, 2026; plan Part 7, owner-ruled addition
-- G-A, gap-check G1). ONE small build of GENERAL money:
-- two small records beside the existing manager cash-up /
-- cash count (migration 007's cash_ups, on the Payroll
-- page), for every business with a cash tin — BOTH plans.
--
--   petty_cash_entries  one line per taking from the tin:
--                       the date, the amount, what it was
--                       for, whether the receipt came back
--                       into the tin, and the initials of
--                       who took it.
--   bank_deposits       one line per bank run: how much
--                       left for the bank, when, in what
--                       bag, and the initials of who
--                       carried it — the proof when a
--                       deposit and the bank statement
--                       disagree.
--
-- OWNER-ONLY MONEY: the routes serve these tables to the
-- owner alone (the money visibility follows the
-- owner-only money doctrine, enforced server-side) — no
-- manager or staff read ever carries a row.
--
-- Both logs print as ONE Studio document from the same
-- Payroll section (the Print Rule — preview = print).
--
-- business_id carries NO foreign key (the migration-017
-- lesson); the billing wipe sweep deletes both tables'
-- rows with the business.

CREATE TABLE IF NOT EXISTS petty_cash_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  entry_date DATE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  purpose TEXT NOT NULL DEFAULT '',
  receipt_back BOOLEAN NOT NULL DEFAULT FALSE,
  initials TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_petty_cash_business_id ON petty_cash_entries (business_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_business_date ON petty_cash_entries (business_id, entry_date);

CREATE TABLE IF NOT EXISTS bank_deposits (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  deposit_date DATE NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  bag_ref TEXT NOT NULL DEFAULT '',
  initials TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_business_id ON bank_deposits (business_id);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_business_date ON bank_deposits (business_id, deposit_date);
