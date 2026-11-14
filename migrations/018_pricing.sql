-- 018_pricing.sql — Clearance + rollback pricing (Business plan).
--
-- The owner's design (Nov 13, 2026), in her Walmart words:
--   * CLEARANCE is a permanent markdown: the product is marked
--     clearance with a lower price, and it stays down until someone
--     changes it back.
--   * ROLLBACK is a temporary sale: a sale price with a start and an
--     end date. The regular price is RETAINED in `price` the whole
--     time and shown alongside the sale price; when the end date
--     passes the effective price returns to regular BY ITSELF.
--
-- So the regular price is never overwritten: `price` stays the
-- regular price forever, and the markdown lives in its own columns.
-- The effective price is DERIVED at read/render time from the
-- window (src/lib/pricing.js) — no daily job, no state to go stale:
--   pricing_mode = 'clearance' and clearance_price set
--     -> effective = clearance_price (permanent)
--   pricing_mode = 'rollback' and sale_price set and
--     sale_start <= today <= sale_end (either bound optional)
--     -> effective = sale_price (temporary)
--   otherwise -> effective = price
--
-- Dates are calendar dates (YYYY-MM-DD text): a rollback runs whole
-- days in the business's own calendar, like a shelf-edge sale sign.
--
-- Plan rule (server/entities.js): the pricing fields may only be
-- SET on the Business plan (403 pricing_business_only otherwise),
-- and reads on any other plan see the fields stripped to defaults —
-- the data is kept, never lost, and applies again if the business
-- returns to Business (the POS held-sale pattern, migration 016).

ALTER TABLE products ADD COLUMN IF NOT EXISTS pricing_mode TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE products ADD COLUMN IF NOT EXISTS clearance_price NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_start TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_end TEXT;
