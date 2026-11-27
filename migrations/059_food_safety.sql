-- 059_food_safety.sql — THE FOOD-SAFETY FILE, COMPLETED
-- (Nov 26, 2026; plan release 370, Gap 6 of the restaurant-gap
-- research + the round-2 riders: extra certificate classes
-- and the SDS shelf).
--
-- The temperature logs (migration 048) gain their completed
-- rule in code, not here: an out-of-range reading now REQUIRES
-- its corrective-action note before the entry stands (the
-- entity validator refuses it without one). This migration
-- adds the family's three new tables:
--
--   safety_logs    the cooling, reheating and sanitizer logs —
--                  the SAME log shape as temp_logs (what was
--                  checked, the reading, its unit, in or out of
--                  range, the corrective action when it missed,
--                  who + when in the audit columns). `kind` says
--                  which log a row belongs to; `unit` is the
--                  reading's own unit ('F' | 'C' | 'ppm').
--   food_certs     food-handler certificate tracking, per
--                  person: the certificate class (the basic
--                  food-handler card plus the round-2 widened
--                  family — ServSafe manager, alcohol-server,
--                  and owner-named classes), its issue and
--                  expiry dates. The member's NAME rides as a
--                  snapshot so the shelf still reads if the
--                  roster changes. Access rides the
--                  staff-documents machinery (the
--                  `staff.documents` tick pattern, release 340).
--   sds_sheets     the SDS shelf (round-2 rider): safety data
--                  sheets for the chemicals the kitchen uses,
--                  stored the documents-machinery way (base64
--                  in Postgres, served only behind the session),
--                  per business. Staff-READABLE without a tick
--                  (OSHA hazard communication: the sheets must
--                  be accessible to the staff who use them);
--                  adding one rides the staff-documents tick
--                  pattern, removing one is the owner's alone.
--
-- business_id carries NO foreign key (the migration-017
-- lesson); the billing wipe sweep deletes all three tables'
-- rows with the business.

CREATE TABLE IF NOT EXISTS safety_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cooling', 'reheating', 'sanitizer')),
  subject_name TEXT NOT NULL DEFAULT '',
  location_id TEXT,
  location_name TEXT NOT NULL DEFAULT '',
  reading NUMERIC,
  unit TEXT NOT NULL DEFAULT 'F',
  in_range BOOLEAN NOT NULL DEFAULT TRUE,
  corrective_action TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_safety_logs_business_id ON safety_logs (business_id);
CREATE INDEX IF NOT EXISTS idx_safety_logs_business_kind ON safety_logs (business_id, kind);

CREATE TABLE IF NOT EXISTS food_certs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  staff_member_id TEXT NOT NULL DEFAULT '',
  member_name TEXT NOT NULL DEFAULT '',
  cert_class TEXT NOT NULL DEFAULT 'food_handler',
  class_label TEXT NOT NULL DEFAULT '',
  issued_on DATE,
  expires_on DATE,
  note TEXT NOT NULL DEFAULT '',
  created_by_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_food_certs_business_id ON food_certs (business_id);
CREATE INDEX IF NOT EXISTS idx_food_certs_business_member ON food_certs (business_id, staff_member_id);
CREATE INDEX IF NOT EXISTS idx_food_certs_business_expires ON food_certs (business_id, expires_on);

CREATE TABLE IF NOT EXISTS sds_sheets (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  data_base64 TEXT NOT NULL,
  uploaded_by_id TEXT,
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sds_sheets_business_id ON sds_sheets (business_id);
