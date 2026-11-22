-- 039_staff_documents.sql — The staff documents build (Nov 21, 2026).
--
-- staff_documents: one row per uploaded VERSION of one staff
-- member's paperwork (the owner's rulings, Nov 19 + Nov 20, 2026).
-- A new upload NEVER deletes the previous version: every upload
-- is its own kept row, listed newest-first, openable forever.
-- (The only removal is the owner's deliberate per-version Remove,
-- behind a confirm dialog — an upload itself removes nothing.)
--
-- Storage follows the app's private-file pattern (carrier labels,
-- migration 025; business policy files, migration 032): the bytes
-- live in Postgres as base64 and are served ONLY through the
-- permission-checked route in server/staffDocumentRoutes.js —
-- never through a public URL. Access is the owner, or a manager
-- the owner trusted with the staff.documents tick; the document's
-- own subject has no door at all.
--
-- uploaded_by_name stamps WHO added the version as a NAME, never
-- an email (the owner's Nov 21, 2026 rule: wherever the app says
-- who did something, it stores and shows a name).
--
-- No FK cascade, like the other private-file tables: the account
-- wipe in server/billing.js deletes these rows explicitly, so a
-- person's paperwork dies with the business, never after it.
CREATE TABLE IF NOT EXISTS staff_documents (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  staff_member_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  data_base64 TEXT NOT NULL,
  uploaded_by_id TEXT,
  uploaded_by_staff_id TEXT,
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_documents_member
  ON staff_documents (business_id, staff_member_id, created_at DESC);
