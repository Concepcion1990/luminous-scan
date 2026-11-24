-- 051_photo_jobs.sql — Release 366 (Nov 24, 2026):
-- the import photo door fix.
--
-- Release 365's photo door fetched each sheet photo link
-- synchronously inside the import request — one at a time, a
-- 10-second whole-download budget, and no second attempt. On
-- the owner's real 137-product import the picture CDN throttled
-- the server's rapid stream and more than half the photos died
-- on their only try. Worse, the source link was stored nowhere,
-- so nothing could ever retry them.
--
-- This migration gives the fix its two homes:
--
--   products.photo_source_url — the sheet's photo link, kept on
--     the product whether or not any fetch has succeeded. One
--     column turns every future recovery into a data pass
--     instead of file archaeology, and lets the app itself say
--     which products are still missing their photo.
--   products.photo_problem — the plain-words reason the last
--     exhausted fetch could not bring the photo in, shown on the
--     product itself (not only on a dismissible result screen).
--     Empty whenever there is nothing wrong.
--
--   photo_jobs — the durable queue the background worker drains.
--     A row is a promise: this product's photo is being brought
--     in from this link. Rows survive restarts (they are data,
--     not memory), carry their attempt count and next-attempt
--     time for the backoff retries, and remember the request
--     origin their /api/photos/<id> URL is built from.
--
-- Additive only: both product columns default to '', which is
-- exactly what every product created before this migration
-- carries (no link on file, nothing wrong).

ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_problem TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS photo_jobs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_problem TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS photo_jobs_due_idx ON photo_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS photo_jobs_product_idx ON photo_jobs (product_id, status);
CREATE INDEX IF NOT EXISTS photo_jobs_business_idx ON photo_jobs (business_id);
