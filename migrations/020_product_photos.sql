-- 020_product_photos.sql — Product photo storage (Nov 14, 2026).
--
-- Product photos were the one dead stub left in the twin: the
-- product form called a Base44 integration that was never
-- implemented, so uploads silently failed. The store logo could
-- live as a data URL on the business row (one image, small), but
-- product photos need a real store: up to 6 per product, served
-- publicly by link (the form's own promise: "Images are stored
-- publicly — anyone with the link can open them").
--
-- Bytes live HERE, in Postgres, not on the app machine: Fly
-- machine disks are ephemeral across deploys, and a photo that
-- vanishes on the next publish is worse than none. The id is an
-- unguessable random UUID; the public route serves by id alone,
-- no session — exactly the link-sharing the form describes.
--
-- The bytes are stored as base64 TEXT, not BYTEA: the codebase's
-- storage convention is text (the logo is a data URL on the
-- business row; JSON rides in TEXT columns), and base64 text is
-- byte-exact on every engine the app runs on — a BYTEA round-trip
-- through the test database's driver is not.
--
-- business_id carries NO foreign key (the migration-017 lesson):
-- the wipe sweep decides what dies with a business; this table's
-- writer never cascades anything. Rows are capped at upload time
-- (image types only, 2 MB — the logo's discipline).

CREATE TABLE IF NOT EXISTS product_photos (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_photos_business_idx
  ON product_photos (business_id);
