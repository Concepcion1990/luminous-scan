-- 010_offboarding.sql
--
-- Offboarding hardening: removing a staff member must end their
-- access and purge their direct-deposit bank details, but it must
-- NEVER erase the business's books. Migration 007 put
-- ON DELETE CASCADE on every staff_member_id foreign key — including
-- pay_stubs and time_entries, which are payroll history. On real
-- Postgres (and pg-mem, which enforces cascades too) deleting a
-- StaffMember row would silently wipe that person's issued pay
-- stubs and clock history along with them.
--
-- The fix: pay_stubs and time_entries keep their staff_member_id
-- column as a plain historical reference (pay_stubs.person_name is
-- denormalized, so the books still say whose stub it was), but the
-- foreign key — and with it the cascade — goes away. The remaining
-- 007 cascades (work_schedules, time_off_requests, work_tasks,
-- pay_profiles, direct_deposit_details) cover operational data and
-- stay exactly as they are; the direct-deposit purge is ALSO done
-- explicitly in server/entities.js so it never depends on cascade
-- enforcement.
--
-- Constraint names: Postgres auto-names an inline column FK
-- "<table>_<column>_fkey"; pg-mem names it "<table>_<column>_fk".
-- Both spellings are dropped with IF EXISTS, so each engine drops
-- its own and treats the other statement as a no-op.
ALTER TABLE pay_stubs DROP CONSTRAINT IF EXISTS pay_stubs_staff_member_id_fkey;
ALTER TABLE pay_stubs DROP CONSTRAINT IF EXISTS pay_stubs_staff_member_id_fk;
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_staff_member_id_fkey;
ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_staff_member_id_fk;
