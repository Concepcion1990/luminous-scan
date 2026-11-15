-- 027_tax_rate.sql — the set-once sales tax rate (owner ruling,
-- Nov 15, 2026). One business-level percentage (stored as the
-- typed decimal text, '' = unset), up to 4 decimal places so
-- combined rates like New Mexico GRT fit. New sales orders
-- pre-fill their Tax from it; the order's own Tax stays
-- hand-editable and never writes back here. Products carry no
-- tax field and purchasing keeps its hand-typed tax.
ALTER TABLE businesses ADD COLUMN tax_rate TEXT NOT NULL DEFAULT '';
