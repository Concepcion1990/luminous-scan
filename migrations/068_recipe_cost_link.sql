-- 068_recipe_cost_link.sql — RECIPE COSTS FOLLOW THE NEWEST
-- INVOICE PRICE (Nov 26, 2026; plan Part 7, item 390 —
-- the wire between release 361's supplier invoices and
-- release 359's recipe costing).
--
-- The check behind this build found the wire half-built:
-- an invoice's lines were compared against product costs
-- to open vendor price alerts, and answering an alert
-- 'accepted' wrote the new cost onto the product — but
-- APPROVING an invoice (its status moving to 'accepted')
-- updated nothing, and no recipe anywhere recorded which
-- invoice price its costs stood on.
--
-- The only new storage is the recipe's own cost note: the
-- columns below record, on each recipe standing on an
-- ingredient whose cost just moved, WHICH ingredient moved,
-- the invoice price it now stands on, and the invoice it
-- came from (number + supplier + when). The note is written
-- by the server alone (invoice approval, or a price alert
-- answered 'accepted'); a recipe read shows it only to the
-- owner / a restaurant.money holder, exactly like the cost
-- figures themselves, and the read shaping drops it when
-- the ingredient no longer stands in the recipe.
--
-- Recipe COSTS need no storage: they are computed at read
-- time from the products' current costs (shapeRecipeMoney),
-- so updating the product's cost re-costs every recipe
-- standing on it the moment it is read.

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_note_product_id TEXT NOT NULL DEFAULT '';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_note_product_name TEXT NOT NULL DEFAULT '';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_note_price NUMERIC;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_note_invoice_id TEXT NOT NULL DEFAULT '';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_note_invoice_number TEXT NOT NULL DEFAULT '';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_note_supplier_name TEXT NOT NULL DEFAULT '';
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS cost_note_at TIMESTAMPTZ;
