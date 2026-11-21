/**
 * Founding-tester comp — core (Nov 21, 2026).
 *
 * Ten real businesses test the app before launch; in exchange,
 * Business is FREE FOR LIFE for them. The owner (the platform
 * operator) controls the list of email addresses — nobody
 * self-serves onto it, and nothing in the app or the signup
 * flow ever hints that the list exists.
 *
 * THE MARK lives in the app's own data, never in Stripe: an
 * entitlements row with plan 'business' and status
 * 'founding_tester'. No Stripe customer, no subscription, no
 * card, no trial is ever created for a comped account, so the
 * later test-mode → live-payments switch cannot touch them,
 * and no trial machinery (countdown, reminder emails, the
 * failed-payment road) ever applies.
 *
 * THE COMP ENDS ONLY on full account deletion (her rule): the
 * wipe sweep marks the list entry ended in the same transaction
 * that deletes the user. Ending a list entry by hand never
 * revokes a workspace that was already granted.
 */
import crypto from 'node:crypto';

/** The publisher/operator login — mirrors src/lib/publisherAccess.js. */
export const OPERATOR_OWNER_EMAIL = 'cperezcarrillo.1990@gmail.com';

/** The publisher's own business — mirrors server/billing.js
 *  (kept local so this module never imports billing.js: the wipe
 *  sweep in billing.js imports from here). */
const GRANDFATHERED_BUSINESS_ID = '6aeaec9b141cfe26e5a411be';

export const FOUNDING_TESTER_STATUS = 'founding_tester';
export const DEFAULT_COMP_CAP = 10;

export function normalizeCompEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * The operator, identified the same way as everywhere else in
 * this codebase (src/lib/publisherAccess.js,
 * /api/billing/publisher-access): the app-owner login, or the
 * owner of the publisher's own grandfathered business. Fails
 * closed: anyone else is not the operator.
 */
export async function isOperatorUser(pool, user) {
  if (!user) return false;
  if (normalizeCompEmail(user.email) === OPERATOR_OWNER_EMAIL) return true;
  if (!user.id) return false;
  const { rows } = await pool.query(
    'SELECT 1 FROM businesses WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [GRANDFATHERED_BUSINESS_ID, user.id],
  );
  return rows.length > 0;
}

/** The active comp entry for an email, or null. */
export async function activeCompEntryForEmail(pool, email) {
  const normalized = normalizeCompEmail(email);
  if (!normalized) return null;
  const { rows } = await pool.query(
    `SELECT * FROM founding_tester_comp
      WHERE LOWER(email) = $1 AND status = 'active'
      ORDER BY created_at ASC LIMIT 1`,
    [normalized],
  );
  return rows[0] ?? null;
}

/** The program cap (stored, raisable by the operator; default 10). */
export async function compCap(pool) {
  const { rows } = await pool.query(
    'SELECT cap FROM founding_tester_comp_config WHERE id = 1 LIMIT 1',
  );
  const cap = Number(rows[0]?.cap);
  return Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : DEFAULT_COMP_CAP;
}

/**
 * Grant the comp to one business: its entitlement is born (or
 * rewritten) as Business / founding_tester, with no trial and
 * no period end — it does not expire. Runs on whatever queryable
 * it is handed (pool or transaction client) so the business-
 * creation door can grant inside its own transaction. Also
 * stamps the list entry's claimed_at the first time any
 * workspace is granted from it. Returns the entitlement row.
 */
export async function grantFoundingTester(db, { businessId, ownerId, ownerEmail }) {
  const { rows } = await db.query(
    `INSERT INTO entitlements (id, business_id, plan, status, trial_ends_at, period_ends_at, created_by_id, created_by)
     VALUES ($1, $2, 'business', $3, NULL, NULL, $4, $5)
     ON CONFLICT (business_id) DO UPDATE SET
       plan = 'business',
       status = EXCLUDED.status,
       trial_ends_at = NULL,
       period_ends_at = NULL,
       updated_at = NOW()
     RETURNING *`,
    [crypto.randomUUID(), businessId, FOUNDING_TESTER_STATUS, ownerId, ownerEmail],
  );
  await db.query(
    `UPDATE founding_tester_comp SET claimed_at = NOW(), updated_at = NOW()
      WHERE LOWER(email) = $1 AND status = 'active' AND claimed_at IS NULL`,
    [normalizeCompEmail(ownerEmail)],
  );
  return rows[0];
}

/**
 * End every active comp entry for an email — called by the wipe
 * sweep in the same transaction that deletes the account (the
 * ONLY way a granted comp ends). Returns how many entries ended.
 */
export async function endCompEntriesForEmail(db, email) {
  const normalized = normalizeCompEmail(email);
  if (!normalized) return 0;
  const { rows } = await db.query(
    `UPDATE founding_tester_comp
        SET status = 'ended', ended_at = NOW(), updated_at = NOW()
      WHERE LOWER(email) = $1 AND status = 'active'
      RETURNING id`,
    [normalized],
  );
  return rows.length;
}
