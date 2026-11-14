-- 021_default_location.sql — Every business starts with its store
-- location (Nov 14, 2026).
--
-- A fresh business used to get NO location at all, so a new
-- customer could not stock anything: every location picker was an
-- empty dropdown whose only answer was a scolding. The owner's
-- ruling: the one store location simply IS there (renameable in
-- Locations like any other). Business creation now seeds it in
-- the same transaction (server/authRoutes.js), and
-- server/defaultLocation.js heals at runtime if a business is
-- ever found with none.
--
-- This backfill covers every business that already exists with
-- zero locations — including the owner's live test workspace,
-- which heals at deploy with no action from her. The id is
-- deterministic ('default-' || business_id) so the insert is
-- idempotent and race-safe; businesses that already have
-- locations are never touched.

INSERT INTO locations (id, business_id, name, kind)
SELECT 'default-' || businesses.id, businesses.id,
       CASE WHEN businesses.name = '' THEN 'Main location' ELSE businesses.name END,
       'store'
FROM businesses
LEFT JOIN locations ON locations.business_id = businesses.id
WHERE locations.id IS NULL
ON CONFLICT (id) DO NOTHING;
