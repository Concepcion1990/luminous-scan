-- 006_t6.sql — T6 (offline-first sync, cross-store requests, business identity).
--
-- Business identity columns: the twin's businesses table (002) only
-- carried name/tagline/currency, so Settings could never save a logo,
-- brand color, contact details or language — entities.Business.update
-- rejected as not-implemented. These columns make the record real.
-- Printed documents keep carrying the business NAME only (T5
-- white-label rule); the logo is the store's branding for the app
-- chrome. The app name stays Luminous Stockhaven and is not stored
-- here — it is not changeable.
--
-- sync_changes: idempotency ledger for the offline queue. One row per
-- applied queued change, keyed by (business_id, idempotency_key);
-- a replay of the same key returns the stored result instead of
-- applying twice. Failed changes are NOT stored: a change that fails
-- validation (e.g. not enough stock at that moment) may succeed on a
-- later retry, and the client — not the server — decides when a
-- validation failure is permanent.
--
-- cross_store_requests: a store asking another store in the same
-- business group to ship stock over, or bring it over within ~2 days.
-- Business-only by nature (Essentials has one store, nowhere else
-- to look); the server enforces that, never the browser.

ALTER TABLE businesses ADD COLUMN logo_url TEXT NOT NULL DEFAULT '';
ALTER TABLE businesses ADD COLUMN brand_color TEXT NOT NULL DEFAULT '#145042';
ALTER TABLE businesses ADD COLUMN contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE businesses ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE businesses ADD COLUMN website TEXT NOT NULL DEFAULT '';
ALTER TABLE businesses ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE businesses ADD COLUMN timezone TEXT NOT NULL DEFAULT '';
ALTER TABLE businesses ADD COLUMN date_format TEXT NOT NULL DEFAULT 'MMM d, yyyy';
ALTER TABLE businesses ADD COLUMN unit_system TEXT NOT NULL DEFAULT 'imperial';
ALTER TABLE businesses ADD COLUMN language TEXT NOT NULL DEFAULT 'en';

CREATE TABLE IF NOT EXISTS sync_changes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  result TEXT NOT NULL,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_sync_changes_business ON sync_changes (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cross_store_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  target_business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'ship',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  requested_by_id TEXT,
  requested_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cross_store_requests_target ON cross_store_requests (target_business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_store_requests_source ON cross_store_requests (business_id, created_at DESC);
