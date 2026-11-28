-- 074_void_comp_log.sql — VOID & COMP LOG (Nov 26, 2026;
-- plan Part 7, owner-ruled addition G-C, gap-check round 3).
-- ONE small build of RESTAURANT money: the register of
-- voids and comps on the Invoices & Money shelf.
--
--   void_comp_entries  one line per void or comp: which
--                      kind it was, its value, the reason,
--                      and who approved it. The date/time
--                      (created_at) and who recorded it
--                      (created_by) ride along in the
--                      house log shape, stamped by the
--                      server at the moment of recording.
--
-- HAND-ENTERED, HONESTLY: until a live till feed exists,
-- a person types each entry — nothing in this table
-- arrives from a till, and the feature's own copy says
-- so. No fake till claims anywhere.
--
-- OWNER/MANAGER MONEY: the routes serve this table to
-- the owner and managers only (the money line the app's
-- money surfaces already use) — a plain staff read or
-- write is refused server-side before any row is read.
--
-- The log prints as a Studio document from its own page
-- (the Print Rule — preview = print).
--
-- business_id carries NO foreign key (the migration-017
-- lesson); the billing wipe sweep deletes this table's
-- rows with the business.

CREATE TABLE IF NOT EXISTS void_comp_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'void',
  amount NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  approver TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_void_comp_business_id ON void_comp_entries (business_id);
CREATE INDEX IF NOT EXISTS idx_void_comp_business_created ON void_comp_entries (business_id, created_at);
