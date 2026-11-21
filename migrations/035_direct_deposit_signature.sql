-- 035_direct_deposit_signature.sql — The direct-deposit build
-- (Nov 21, 2026): an electronic signature on the in-app form, the
-- SEALED completed form the owner receives, and an honest
-- correction path.
--
-- The owner's flow (ruled Nov 19, 2026): the member fills the
-- in-app form, SIGNS it (types their name, chooses a signature
-- style — that is their true electronic signature), and submits.
-- What the owner receives is a sealed completed-form document:
-- viewable, downloadable, printable, already signed, editable by
-- NOBODY. The owner's only editable piece is a fresh blank form.
--
-- Storage shape:
--   - direct_deposit_details (migration 007) keeps its role as the
--     CURRENT state per member: it gains the signature columns and
--     a correction_requested flag (the owner sent the form back;
--     the status stays 'submitted' because the sealed form still
--     stands until the corrected one replaces it — the API
--     presents the flag as the 'correction_requested' status).
--   - direct_deposit_submissions is the sealed record: one
--     immutable row per submission, written in the same
--     transaction that updates the details row. A correction
--     inserts a NEW row and stamps the previous current row
--     superseded_at — a sealed form is never edited, only
--     replaced, and the chain stays readable.
--
-- Privacy: the full bank numbers live in these two tables and
-- leave the server only through the owner's form read and the
-- member's own masked views. Removal of a staff member purges
-- the submissions with the details row (entities.js deletes both
-- in the removal transaction; the cascades below are the
-- backstop), exactly like the details themselves (migration 007's
-- standing rule — bank details do not outlive the membership;
-- pay stubs and time entries are the ones that stay).

ALTER TABLE direct_deposit_details
  ADD COLUMN IF NOT EXISTS signature_name TEXT NOT NULL DEFAULT '';
ALTER TABLE direct_deposit_details
  ADD COLUMN IF NOT EXISTS signature_style TEXT NOT NULL DEFAULT '';
ALTER TABLE direct_deposit_details
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

ALTER TABLE direct_deposit_details
  ADD COLUMN IF NOT EXISTS correction_requested BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS direct_deposit_submissions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  staff_member_id TEXT NOT NULL REFERENCES staff_members (id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT 'checking' CHECK (account_type IN ('checking', 'savings')),
  routing_number TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  signature_name TEXT NOT NULL DEFAULT '',
  signature_style TEXT NOT NULL DEFAULT '',
  signed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dd_submissions_member
  ON direct_deposit_submissions (business_id, staff_member_id, submitted_at DESC);

-- Backfill: every member whose details already stand submitted
-- gains their sealed record from the details row as it stands.
-- The signature columns are empty — those forms predate the
-- signature step, and the record says so honestly rather than
-- inventing a signature nobody made.
INSERT INTO direct_deposit_submissions
  (id, business_id, staff_member_id, bank_name, account_type, routing_number,
   account_number, signature_name, signature_style, signed_at, submitted_at)
SELECT 'backfill-' || d.staff_member_id::text,
       d.business_id, d.staff_member_id, d.bank_name, d.account_type,
       d.routing_number, d.account_number, '', '', NULL,
       COALESCE(d.submitted_at, d.updated_at)
  FROM direct_deposit_details d
  LEFT JOIN direct_deposit_submissions s
    ON s.business_id = d.business_id AND s.staff_member_id = d.staff_member_id
 WHERE d.status = 'submitted'
   AND s.id IS NULL;
