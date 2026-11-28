-- 072_pest_calibration.sql — PEST-CONTROL LOG + THERMOMETER
-- CALIBRATION LOG (Nov 26, 2026; plan Part 7, owner-ruled
-- addition G-B, gap-check G2 + G3). ONE small build in the
-- FOOD-SAFETY family (plan release 370): two log shapes the
-- family already knows how to make, on the Food Safety shelf.
--
--   pest_visits       one line per pest-service visit: the
--                     date, the company, the technician, the
--                     areas treated, the findings, and the
--                     next visit due. The pest company's own
--                     report can be FILED with the visit —
--                     stored the documents-machinery way
--                     (base64 in Postgres, served only behind
--                     the session, the documents file types
--                     and the universal 25 MB cap), exactly
--                     like the SDS shelf (migration 059).
--   calibration_logs  one line per ice-point check: the
--                     date (created_at), which thermometer,
--                     the reading and its unit, the outcome
--                     the reading earns (pass at the ice
--                     point — 32 °F / 0 °C — or adjusted),
--                     and the checker's initials. This is
--                     the record that vouches for the
--                     temperature logs.
--
-- Both logs print inside the inspection-ready packet
-- alongside the family's other logs (the packet gathers
-- them client-side, the 370 way — no table change there).
--
-- business_id carries NO foreign key (the migration-017
-- lesson); the billing wipe sweep deletes both tables'
-- rows with the business.

CREATE TABLE IF NOT EXISTS pest_visits (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  visit_date DATE,
  company TEXT NOT NULL DEFAULT '',
  technician TEXT NOT NULL DEFAULT '',
  areas_treated TEXT NOT NULL DEFAULT '',
  findings TEXT NOT NULL DEFAULT '',
  next_visit_on DATE,
  report_filename TEXT NOT NULL DEFAULT '',
  report_content_type TEXT,
  report_size_bytes INTEGER NOT NULL DEFAULT 0,
  report_data_base64 TEXT,
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pest_visits_business_id ON pest_visits (business_id);
CREATE INDEX IF NOT EXISTS idx_pest_visits_business_date ON pest_visits (business_id, visit_date);

CREATE TABLE IF NOT EXISTS calibration_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  thermometer_name TEXT NOT NULL DEFAULT '',
  reading NUMERIC,
  unit TEXT NOT NULL DEFAULT 'F',
  outcome TEXT NOT NULL DEFAULT 'adjusted' CHECK (outcome IN ('pass', 'adjusted')),
  initials TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calibration_logs_business_id ON calibration_logs (business_id);
