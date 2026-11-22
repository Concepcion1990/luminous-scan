-- 041_blocked_email_domains.sql — The signup domain blocklist
-- (Nov 22, 2026).
--
-- A platform-level list of email DOMAINS the operator (the
-- publisher identity, and nobody else) has chosen to refuse at
-- PUBLIC signup: an account-creation attempt whose email domain
-- is on this list is refused before anything is created, with a
-- plain, neutral message that never names this list. The list
-- starts EMPTY — the operator adds domains as the need arises;
-- nothing is seeded here.
--
-- blocked_email_domains: one row per domain ever listed.
-- status: 'active' while the domain is refused, 'removed' when
-- the operator takes it off (a status flip, never a row delete,
-- mirroring the founding-tester comp list — the history of what
-- was blocked when stays auditable, and re-adding a removed
-- domain revives its row). Matching is exact-domain,
-- case-insensitive: the stored domain is normalized
-- (lowercase, no leading @, no trailing dot) at write time and
-- compared against the email's domain part, lowercased.
--
-- Existing accounts are never touched by this list: it is read
-- only at the moment a NEW account would be created (and not
-- even then when the email carries a pending staff invite —
-- invites are owner-chosen, not public signups; see
-- server/domainBlocklist.js).
CREATE TABLE IF NOT EXISTS blocked_email_domains (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  removed_at TIMESTAMPTZ,
  created_by_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_blocked_email_domains_domain ON blocked_email_domains (LOWER(domain));
CREATE INDEX IF NOT EXISTS idx_blocked_email_domains_status ON blocked_email_domains (status);
