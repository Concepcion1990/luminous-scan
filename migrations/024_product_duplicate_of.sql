-- 024_product_duplicate_of.sql — the duplicate marker on products
-- (Nov 14, 2026).
--
-- Duplicating a product mints a copy that is the SAME product for
-- counting purposes: the owner's rule is that a copy never counts
-- as another product ("it should not be counting the copy at all").
-- Until now a copy was recognizable only by its birthmarks — a
-- '-COPY' SKU and its code fields (upc / barcode / qr_code) cleared
-- at duplication time — and nothing durable tied it to the product
-- it was copied from.
--
-- duplicate_of carries that tie from now on: the row id of the
-- product the copy was made from (a copy of a copy points at the
-- original, never at another copy). '' means "not a copy" — every
-- existing row, and every product created any other way. Existing
-- copies keep their legacy birthmarks and are recognized by them
-- (see src/lib/productDuplicates.js); nothing is backfilled, so no
-- product's stored data changes meaning under it.

ALTER TABLE products ADD COLUMN IF NOT EXISTS duplicate_of TEXT NOT NULL DEFAULT '';
