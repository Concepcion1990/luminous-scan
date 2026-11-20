-- 032_business_policies.sql — The owner's own store policies +
-- terms & conditions (Nov 19, 2026).
--
-- In Settings the owner of a business writes TWO per-business
-- documents: Store Policies (the house rules for how the app and
-- the store are used in THEIR business — an owner may put their
-- entire store policy in) and Terms & Conditions. EACH document
-- accepts typed text OR an uploaded file — both options offered,
-- either or. The documents are per-business only: nothing an
-- owner writes ever appears in another business, and nothing
-- here is platform-wide (Luminous StockHaven's own policies and
-- terms stay with the app, in the legal pages).
--
-- Typed text lives on the business row, following the welcome
-- script precedent (migration 029): the owner's own words,
-- stored as written, never translated. An uploaded file lives
-- in business_policy_files, following the app's private-file
-- pattern (product photos in 020, carrier labels in 025, voice
-- notes in 031): bytes in Postgres as base64, never on the app
-- machine's ephemeral disk, served only through the
-- authenticated, business-scoped route in
-- server/businessPolicyRoutes.js. One file per document:
-- replacing an upload replaces the row.
--
-- A document is in exactly one of three states — empty, text,
-- or file. Saving text deletes the file row for that document;
-- uploading a file clears the text. business_id carries NO
-- foreign key (the migration-017 lesson); the wipe sweep
-- deletes these rows explicitly by business_id alongside its
-- other defense-in-depth deletes (server/billing.js).

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS store_policies_text TEXT NOT NULL DEFAULT '';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS store_terms_text TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS business_policy_files (
  business_id TEXT NOT NULL,
  doc_kind TEXT NOT NULL,
  content_type TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (business_id, doc_kind)
);

CREATE INDEX IF NOT EXISTS business_policy_files_business_idx
  ON business_policy_files (business_id);
