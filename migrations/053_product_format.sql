-- 053_product_format.sql — the product form batch
-- (post-361 fix batch, Nov 24, 2026):
--
-- The owner's own book-trade field (her ruling, Nov 23, 2026,
-- from hand-testing): a product's Format — Paperback /
-- Hardcover — as a real column on the product, beside Author,
-- the field it rides with through the form, the product view
-- and the import/export surfaces.
--
--   products.format — the format's stored value: the canonical
--     'Paperback' / 'Hardcover' the form's picker writes (the
--     label words translate at render, exactly like Condition),
--     or '' when the owner has not said.
--
-- NOT NULL DEFAULT '' in the shape of every sibling text column
-- on this table (author, condition, publisher — migration 003):
-- existing products are untouched by the change itself; their
-- Format simply starts empty, as an unset field does.

ALTER TABLE products ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT '';
