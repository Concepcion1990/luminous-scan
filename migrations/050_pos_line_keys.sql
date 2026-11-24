-- 050_pos_line_keys.sql — Release 364 (Nov 23, 2026):
-- the three-key storefront matcher.
--
-- The owner's ruling (Nov 23, 2026): a storefront sale
-- matches its product by "either the SKU and the UPC as
-- well as the ISBN — those three, you know, either or"
-- (both plans). Release 362 matched eBay lines by SKU
-- alone, because that is all its lines carried. For the
-- widened matcher to judge a line by the key it actually
-- arrived with — on the notification road, on the
-- catch-up sweep, and again when a held line is retried
-- after linking — the line row itself must remember its
-- UPC and its ISBN beside its SKU.
--
-- Additive only: two columns, both defaulting to '',
-- which is exactly what every line recorded before this
-- migration carries (no UPC, no ISBN on the line). The
-- matcher treats a pre-050 line's stored barcode as its
-- UPC key, so held lines from the till era keep the road
-- they always had.

ALTER TABLE pos_sale_lines ADD COLUMN IF NOT EXISTS upc TEXT NOT NULL DEFAULT '';
ALTER TABLE pos_sale_lines ADD COLUMN IF NOT EXISTS isbn TEXT NOT NULL DEFAULT '';
