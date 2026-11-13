-- 015_pos.sql — POS / till connections (POS phase).
--
-- The owner's decision (Nov 12, 2026): subscribers connect their
-- POS system so that when somebody purchases merchandise at the
-- till, it also reflects in the app's inventory. Square and
-- Shopify POS land together on ONE shared core; Clover, Toast,
-- Lightspeed, PayPal Zettle, Stripe Terminal and Wix POS arrive
-- later as new adapters over these same tables — a new provider
-- is a normalizer + a webhook route, never a rewrite.
--
-- pos_connections — one row per (business, provider):
--   status: 'not_connected' | 'connected' | 'error'.
--   provider_account_id: the provider-side identity a webhook
--     uses to find this business (Square merchant id; Shopify
--     shop domain).
--   provider_location_id: the provider-side till/store id.
--   location_id: the app location this till's sales deduct from
--     (set by the owner; falls back to the business's first
--     location when unset).
--   credentials: provider credential material (Shopify access
--     token; Square OAuth tokens) as JSON text. SERVER-SIDE ONLY:
--     no code path selects this column into an API response (the
--     public connection shape is a whitelist — see server/
--     posRoutes.js). There is no at-rest encryption convention in
--     this codebase (secrets otherwise live in env); the column
--     exclusion is the control, noted in the POS report.
--
-- pos_sale_events — one row per provider sale. The idempotency
--   anchor is UNIQUE (business_id, provider, external_sale_id):
--   a webhook retry, a provider redelivery, or a re-imported CSV
--   batch can never record the same sale twice.
--   status: 'applied' | 'partially_applied' | 'held_unmatched' |
--     'refused'. source: 'webhook' | 'csv'.
--   total is stored AS REPORTED by the provider (never recomputed
--   from lines — the till is the source of truth for money).
--
-- pos_sale_lines — one row per sold item:
--   provider_item_key: the stable provider-side item identity
--     mappings hang off (Square catalog variation id; Shopify
--     'variant:<id>'; the code itself for CSV rows).
--   status: 'applied' | 'unmatched' | 'insufficient_stock' |
--     'ignored' (zero-quantity rows). movement_id is set once the
--     line has written its SALE movement through the stock ledger
--     (server/movements.js — never a parallel stock writer).
--
-- pos_item_mappings — (business_id, provider, provider_item_key)
--   UNIQUE → product_id. Once saved, a mapping matches future
--   sales automatically and can apply the lines already held.

CREATE TABLE IF NOT EXISTS pos_connections (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('square', 'shopify')),
  status TEXT NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected', 'connected', 'error')),
  label TEXT NOT NULL DEFAULT '',
  provider_account_id TEXT NOT NULL DEFAULT '',
  provider_location_id TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  credentials TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_pos_connections_account ON pos_connections (provider, provider_account_id);

CREATE TABLE IF NOT EXISTS pos_sale_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  connection_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('square', 'shopify', 'csv')),
  external_sale_id TEXT NOT NULL,
  sold_at TIMESTAMPTZ,
  location_label TEXT NOT NULL DEFAULT '',
  total_amount NUMERIC,
  total_currency TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'held_unmatched' CHECK (status IN ('applied', 'partially_applied', 'held_unmatched', 'refused')),
  source TEXT NOT NULL DEFAULT 'webhook' CHECK (source IN ('webhook', 'csv')),
  summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, provider, external_sale_id)
);
CREATE INDEX IF NOT EXISTS idx_pos_events_business_created ON pos_sale_events (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pos_sale_lines (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES pos_sale_events (id) ON DELETE CASCADE,
  provider_item_key TEXT NOT NULL DEFAULT '',
  item_label TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  quantity NUMERIC NOT NULL DEFAULT 0,
  product_id TEXT,
  movement_id TEXT,
  status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('applied', 'unmatched', 'insufficient_stock', 'ignored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pos_lines_event ON pos_sale_lines (event_id);
CREATE INDEX IF NOT EXISTS idx_pos_lines_held ON pos_sale_lines (business_id, status, provider_item_key);

CREATE TABLE IF NOT EXISTS pos_item_mappings (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('square', 'shopify', 'csv')),
  provider_item_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, provider, provider_item_key)
);
CREATE INDEX IF NOT EXISTS idx_pos_mappings_business ON pos_item_mappings (business_id, provider);
