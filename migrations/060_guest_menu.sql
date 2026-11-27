-- Guest menu publications (plan release 371, Nov 26, 2026):
-- the owner's choice of which recipes guests may see, under
-- an unguessable slug. One publication per business.
-- business_id carries NO foreign key (the migration-017
-- lesson); the billing wipe sweep deletes the row with the
-- business.
CREATE TABLE IF NOT EXISTS menu_publications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  recipe_ids TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS menu_publications_business_idx ON menu_publications (business_id);
