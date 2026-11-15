-- Import activity events (owner ruling, Nov 15, 2026): a Create or
-- Update import that lands at zero stock writes no stock movement —
-- correctly, since no stock moved — but the import itself is part of
-- the inventory's story and must appear in Recent inventory activity
-- and the full history. One row per committed import: the operation,
-- how many products it touched, when. This is an ACTIVITY record,
-- never a stock movement: nothing reads it for stock math, counts
-- or reconciliation. Receive imports write no row here — they
-- already speak through their real per-product receipts.
CREATE TABLE IF NOT EXISTS import_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT '',
  product_count INTEGER NOT NULL DEFAULT 0,
  batch_ref TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_events_business_id ON import_events (business_id);
