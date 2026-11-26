-- 054_paper_trail.sql — Release 378 (Nov 25, 2026): the
-- paper-trail smalls, the restaurant build-it-all program's
-- second build (plan release 368 in the build plan).
--
-- Two new tables, both business-scoped with the house audit
-- columns (046's shape):
--
--   credit_memos    a supplier credit against ONE supplier
--                   invoice (361): the delivery was short or
--                   the goods were bad, and the supplier made
--                   it right on paper. The memo's supplier is
--                   a snapshot of the invoice's own supplier
--                   (the server derives it, never the client).
--                   status 'applied' counts against what the
--                   invoice is still owed; 'void' keeps the
--                   record without counting — a mistake is
--                   voided, never erased. The cap lives in
--                   the entity validator: the applied memos
--                   against an invoice never exceed the
--                   invoice's own total.
--
--   log_book_entries the manager log book (the owner's Q2
--                   ruling, Nov 25, 2026: FOR EVERYONE — a
--                   general feature, both plans, not a
--                   restaurant table): one dated entry per
--                   shift, the official record a team hands
--                   from shift to shift. body is the entry;
--                   shift_label is the writer's own name for
--                   the shift ('Tuesday close'), optional;
--                   author_name is the writer's display name,
--                   stamped by the server at create — entries
--                   are named, never anonymous, and never an
--                   email address.
--
-- Additive only, like every migration since 040: two new
-- tables, nothing existing is altered.

CREATE TABLE IF NOT EXISTS credit_memos (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  invoice_id TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  credit_number TEXT NOT NULL DEFAULT '',
  credit_date DATE,
  amount NUMERIC,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'void')),
  note TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_memos_business_id ON credit_memos (business_id);
CREATE INDEX IF NOT EXISTS idx_credit_memos_business_invoice ON credit_memos (business_id, invoice_id);

CREATE TABLE IF NOT EXISTS log_book_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  shift_label TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_log_book_entries_business_id ON log_book_entries (business_id);
CREATE INDEX IF NOT EXISTS idx_log_book_entries_business_created ON log_book_entries (business_id, created_at);
