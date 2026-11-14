-- 023_customer_addresses.sql — The rolling 90-day customer
-- address book (Nov 14, 2026).
--
-- A customer's ship-to address is saved PER CUSTOMER (per
-- business) so a returning customer's next order can use it
-- without re-typing. The identity key is the customer's email
-- when the order carries one, else their name (see
-- server/customerAddresses.js). Every new order from that
-- customer refreshes the window — a fresh 90 days from that
-- order — and the newest address replaces the stored one. After
-- 90 days with no order, the reusable address is PURGED by the
-- daily sweep family (it rides the wipe-sweep job).
--
-- The purge governs only this reusable copy: an individual order
-- keeps the address that was on it as part of its own record.

CREATE TABLE IF NOT EXISTS customer_addresses (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  customer_key TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  name_norm TEXT NOT NULL DEFAULT '',
  ship_street TEXT NOT NULL DEFAULT '',
  ship_city TEXT NOT NULL DEFAULT '',
  ship_region TEXT NOT NULL DEFAULT '',
  ship_postal TEXT NOT NULL DEFAULT '',
  ship_country TEXT NOT NULL DEFAULT '',
  last_order_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, customer_key)
);

CREATE INDEX IF NOT EXISTS idx_customer_addresses_expiry ON customer_addresses (expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_name ON customer_addresses (business_id, name_norm);
