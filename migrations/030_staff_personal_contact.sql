-- Staff personal contact details (owner ruling, Nov 19, 2026):
-- a staff member's home address and phone number live on their
-- staff record (a check may need to be mailed). They are set
-- only by the owner or a manager trusted with hiring
-- (staff.manage) through the Add/Edit staff member dialog, and
-- the entity read paths strip them for everyone else — the
-- member themselves included: these details tie to legal forms
-- and taxes, and the member's own view of their info arrives in
-- a later Payroll build.
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS personal_address TEXT NOT NULL DEFAULT '';
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS personal_phone TEXT NOT NULL DEFAULT '';
