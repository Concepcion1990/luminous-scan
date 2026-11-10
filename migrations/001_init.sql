-- 001_init.sql — T1 migration scaffolding.
--
-- The twin starts with an empty database (plan §5.1: no data migration;
-- test data is recreated fresh in T7). Entity tables land with the
-- phases that build them (users/businesses in T2, inventory in T3,
-- billing in T4), so this first file is deliberately a no-op: it exists
-- to prove the runner applies versioned files in order and records
-- them in schema_migrations before any real table exists.
--
-- Convention: one file per change, `<nnn>_<name>.sql`, applied once,
-- never edited after it has run anywhere. New tables go in new files.

SELECT 1;
