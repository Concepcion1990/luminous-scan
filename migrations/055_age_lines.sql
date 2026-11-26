-- 055_age_lines.sql — the age check build (Nov 25, 2026):
-- the owner's age lines for the license-scan age check
-- (Road B, her ruling the same day: the owner sets the lines
-- for their own place's law; the app ships sensible defaults).
--
-- Three whole-age lines on the business record:
--   age_alcohol  21 — the US alcohol line
--   age_tobacco  21 — US federal tobacco has been 21 since
--                     December 2019
--   age_other    18 — other age-restricted goods
--
-- The columns carry the defaults so every existing business
-- reads with the shipped lines until its owner sets their
-- own. Nothing about any ID scan is EVER stored — the check
-- keeps nothing whatsoever (the spec's hard rule); these
-- columns hold only the owner's own numbers.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS age_alcohol INTEGER NOT NULL DEFAULT 21;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS age_tobacco INTEGER NOT NULL DEFAULT 21;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS age_other INTEGER NOT NULL DEFAULT 18;
