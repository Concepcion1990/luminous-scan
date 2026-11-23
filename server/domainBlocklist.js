/**
 * Signup domain blocklist — core (Nov 22, 2026).
 *
 * The platform operator keeps a list of email DOMAINS that may
 * not be used to create a NEW account. A website signup form
 * cannot see a visitor's email provider ahead of time, but the
 * app can refuse the creation itself — that refusal is what
 * lives here. The list starts empty; the operator adds domains
 * as the need arises (server/blocklistRoutes.js, operator
 * only, mirroring the founding-tester comp list).
 *
 * THE RULES (owner's design, Nov 19, 2026):
 * - Matching is on the email's domain part, case-insensitive,
 *   EXACT-domain: blocking example.com does not block
 *   mail.example.com — a subdomain is blocked only when it is
 *   listed itself. No wildcard guessing.
 * - The refusal is plain and neutral: it never accuses, never
 *   says "blocked", never names this list. The wording lives in
 *   the apiErrors registry (apiErrors.signupEmailUnavailable),
 *   rendered in the reader's language by the client.
 * - EXISTING ACCOUNTS ARE UNAFFECTED: this module is consulted
 *   only at the moment a new account would be created. An
 *   account that already exists with a listed domain signs in,
 *   verifies and re-registers exactly as before.
 * - INVITES ARE NOT EXEMPT (owner's reversal, Nov 22, 2026):
 *   as first shipped, an email with a pending staff invite
 *   bypassed the block, on the reasoning that an invite is
 *   owner-chosen rather than a public signup. The owner
 *   reversed that the same day — "stop invites too" — so the
 *   block now applies to EVERY new account, invited or not.
 */

/**
 * The domain part of an email address, normalized for
 * comparison: lowercased, trailing dot stripped. Returns ''
 * when the input has no usable domain part.
 */
export function emailDomainOf(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 0) return '';
  return value.slice(at + 1).replace(/\.+$/, '');
}

/**
 * Normalize an operator-supplied domain for storage: a bare
 * domain, an @domain, or a full email address (the part after
 * the last @ is what gets listed); case, surrounding whitespace
 * and a trailing dot are normalized away.
 */
export function normalizeDomain(input) {
  let domain = String(input || '').trim().toLowerCase();
  if (domain.includes('@')) domain = domain.slice(domain.lastIndexOf('@') + 1);
  return domain.replace(/^@+/, '').replace(/\.+$/, '').trim();
}

/**
 * A listable domain: at least one dot, no spaces, no @, no empty
 * labels. Deliberately permissive about the label characters
 * (punycode and non-ASCII domains pass, exactly as the signup
 * email validator already passes them) — this is a typo guard,
 * not a second email validator.
 */
export function isValidDomain(domain) {
  return typeof domain === 'string'
    && domain.length > 0
    && domain.length <= 253
    && /^[^\s@.]+(\.[^\s@.]+)+$/.test(domain);
}

/** Is this exact domain on the active list? */
export async function isDomainBlocked(db, domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM blocked_email_domains
      WHERE LOWER(domain) = $1 AND status = 'active' LIMIT 1`,
    [normalized],
  );
  return rows.length > 0;
}

/**
 * The one enforcement question the register door asks when —
 * and only when — it is about to CREATE a new account: is this
 * signup refused by the blocklist? True when the email's
 * domain is actively listed — for every new account, staff
 * invites included (the owner's Nov 22, 2026 reversal; the
 * invite exemption this function originally carried is gone).
 */
export async function signupBlockedForEmail(db, email) {
  const domain = emailDomainOf(email);
  if (!domain) return false;
  return isDomainBlocked(db, domain);
}
