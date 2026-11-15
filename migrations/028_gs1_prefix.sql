-- 028_gs1_prefix.sql — GS1 mode for the code generator (owner
-- ruling, Nov 15, 2026). An owner who licenses a GS1 company
-- prefix enters it once in Settings; the generator then mints
-- TRUE retail GTINs from her own numbers.
--
-- gs1_prefix: the typed digits ('' = unset), validated strictly
-- at the Settings PATCH (digits, 6–10 — the company-prefix range
-- that supports GTIN-12 minting). The app never invents one.
--
-- minted_gtins: the spent-numbers ledger. Item references are
-- assigned sequentially per (business, prefix, kind) and are
-- NEVER reused — this table is the record that survives product
-- deletes, so a deleted product's GTIN stays spent forever. The
-- unique constraints make the guarantee structural, not hopeful.
ALTER TABLE businesses ADD COLUMN gs1_prefix TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS minted_gtins (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  prefix TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_reference INTEGER NOT NULL,
  gtin TEXT NOT NULL,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, gtin),
  UNIQUE (business_id, prefix, kind, item_reference)
);

CREATE INDEX IF NOT EXISTS minted_gtins_business_idx
  ON minted_gtins (business_id, prefix, kind);
