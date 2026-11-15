-- 025_shipping_labels_doc_style.sql — Carrier label records +
-- per-business document style (Nov 14, 2026).
--
-- SCOPE A: a business can keep the carrier-bought shipping label
-- file (PDF / PNG / JPG) ON the order it belongs to, permanently,
-- as its own record — "on hand just in case something happens"
-- (owner ruling). The app never sells postage and never shows a
-- postage price: the carrier stays the source of price truth, so
-- this table stores the carrier's own file, byte-exact.
--
-- Unlike product photos (public by link, by the form's promise),
-- a shipping label carries a customer's name and address, so the
-- bytes are PRIVATE: they are served only through the
-- authenticated, business-scoped route in server/t6Routes.js —
-- never through the public /api/photos/:id route. One label per
-- order: replacing an upload replaces the row.
--
-- Bytes are base64 TEXT, the codebase's storage convention (see
-- migration 020). business_id carries NO foreign key (the
-- migration-017 lesson); the wipe sweep deletes these rows
-- explicitly by business_id alongside its other defense-in-depth
-- deletes.
--
-- SCOPE B: businesses.doc_style holds the Document Style Studio
-- choices as one JSON object (color, font, border, header/footer
-- decoration picture URLs) — validated and normalized by
-- validateBusinessPatch in server/authRoutes.js, resolved
-- client-side by src/lib/docStyle.js. Empty string = no style
-- saved; documents print exactly as they always have.

CREATE TABLE IF NOT EXISTS order_shipping_labels (
  order_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_shipping_labels_business_idx
  ON order_shipping_labels (business_id);

ALTER TABLE businesses ADD COLUMN doc_style TEXT NOT NULL DEFAULT '';
