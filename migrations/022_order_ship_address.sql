-- 022_order_ship_address.sql — Customer ship-to address on orders
-- (Nov 14, 2026).
--
-- An order that will be shipped needs the customer's address ON
-- the order — "it's in there and they're able to in the print
-- area print out this order." The address is a business record on
-- the order itself, like the customer's name and phone already
-- are. The Nov 13 label ruling is untouched: the shipping label
-- still accepts a print-time address and never saves it — when an
-- order carries a stored address the label simply starts from it;
-- when it doesn't, the label flow behaves exactly as before.
-- All fields optional; an order with none behaves as it always has.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_street TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_city TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_region TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_postal TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_country TEXT NOT NULL DEFAULT '';
