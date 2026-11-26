-- 057_barcode_pool.sql — the BARCODE POOL (Nov 25, 2026).
--
-- The owner's spec (print-code-pool/spec.md): inside the Print
-- section, a door that generates barcodes with NO product
-- attached — print them, stick them on merchandise that has no
-- barcode of its own, and scan the item into a product later.
--
-- One row per minted house code. The pool is PER-BUSINESS: a
-- minted code is never handed out twice and never belongs to
-- another business (the code column is unique across the whole
-- table, so a code can only ever sit in one business's pool).
-- Minting creates NO inventory — no product row, no stock level;
-- the code simply waits here, indefinitely, until a product in
-- the same business takes it as one of its codes (the claim is
-- derived at read time from the products table, so a claimed
-- code behaves as a normal product code from then on).
--
-- The code format is the app's own (server/barcodePoolCore.js):
-- SHP-XXXXXXXX — the SHP- prefix marks it as a pool code at a
-- glance, distinct from the per-product generator's SH- house
-- codes and from every real retail code (UPC/EAN/ISBN are all
-- digits), and the label engine draws it as Code 128.
--
-- Scope: BOTH plans. business_id carries NO foreign key (the
-- migration-017 lesson); the wipe sweep deletes these rows
-- explicitly by business_id (server/billing.js).

CREATE TABLE IF NOT EXISTS barcode_pool_codes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  code TEXT NOT NULL,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS barcode_pool_codes_code_key
  ON barcode_pool_codes (code);
CREATE INDEX IF NOT EXISTS barcode_pool_codes_business_idx
  ON barcode_pool_codes (business_id, created_at ASC);
