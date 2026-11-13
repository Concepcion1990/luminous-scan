/**
 * Account recovery kit — core logic (T7 / migration 011).
 *
 * The owner's requirement, from her own experience of being locked
 * out of an email: a customer who loses access to the email their
 * account is under must NOT lose their shop. Sign-in stays email +
 * password only — this module is the emergency exit, not a new door.
 *
 * Pieces:
 *   - Backup codes: a set of one-time spare keys, SHA-256 hashed,
 *     each usable exactly once; regenerating replaces the whole set.
 *   - Backup email: a second, verified address that can receive a
 *     6-digit recovery code (codes live in `account_codes`, minted by
 *     server/otp.js with the T2 hashing/lockout mechanics).
 *   - applyEmailChange: THE carry. One transaction that moves an
 *     account to a new email — users.email, every staff_members row
 *     (access resolution is by email, server/authz.js), and the
 *     trial_history row (merged, never duplicated: an email change
 *     must never mint a second free trial).
 *   - syncStripeCustomerEmail: best-effort post-commit Stripe sync.
 */
import crypto from 'node:crypto';
import { stripeApi, stripeConfigured } from './stripeClient.js';

// -------------------------------------------------------------------
// Backup codes
// -------------------------------------------------------------------

// No 0/O/1/I/L — codes get read off paper and typed by tired people.
const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const BACKUP_CODE_SET_SIZE = 10;

function hashBackupCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/** Typing-tolerant form: upper-cased, dashes/spaces stripped. */
export function normalizeBackupCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateBackupCodePlaintext() {
  const raw = Array.from({ length: 8 }, () =>
    BACKUP_CODE_ALPHABET[crypto.randomInt(BACKUP_CODE_ALPHABET.length)]).join('');
  return { display: `${raw.slice(0, 4)}-${raw.slice(4)}`, normalized: raw };
}

/**
 * Replace the user's whole spare-key set with a fresh one and return
 * the plaintext codes — the ONLY moment they ever exist in the open.
 * Regenerating invalidates every old code, used or not.
 */
export async function generateBackupCodes(client, userId) {
  await client.query('DELETE FROM backup_codes WHERE user_id = $1', [userId]);
  const codes = [];
  for (let i = 0; i < BACKUP_CODE_SET_SIZE; i += 1) {
    const { display, normalized } = generateBackupCodePlaintext();
    const salt = crypto.randomBytes(16).toString('hex');
    await client.query(
      'INSERT INTO backup_codes (id, user_id, code_hash, code_salt) VALUES ($1, $2, $3, $4)',
      [crypto.randomUUID(), userId, hashBackupCode(normalized, salt), salt],
    );
    codes.push(display);
  }
  return codes;
}

export async function countUnusedBackupCodes(client, userId) {
  const { rows } = await client.query(
    'SELECT COUNT(*)::int AS n FROM backup_codes WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
  return rows[0]?.n ?? 0;
}

/**
 * Try to spend one spare key. Returns true exactly once per code:
 * a match stamps used_at inside the caller's transaction, so a
 * second presentation of the same code finds no live row.
 */
export async function consumeBackupCode(client, userId, input) {
  const normalized = normalizeBackupCode(input);
  if (normalized.length !== 8) return false;
  const { rows } = await client.query(
    'SELECT id, code_hash, code_salt FROM backup_codes WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
  for (const row of rows) {
    const candidate = hashBackupCode(normalized, row.code_salt);
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(row.code_hash, 'hex');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      await client.query('UPDATE backup_codes SET used_at = NOW() WHERE id = $1', [row.id]);
      return true;
    }
  }
  return false;
}

// -------------------------------------------------------------------
// Trial history carry
// -------------------------------------------------------------------

// A consumed trial outranks everything: once a person has HAD their
// trial, no address shuffle may hand them another one.
const TRIAL_STATUS_RANK = { eligible: 0, needs_review: 1, reserved: 2, consumed: 3 };

/**
 * Move/merge the trial_history row from oldEmail to newEmail.
 * - only old exists  → the row is renamed;
 * - both exist       → merged into the new email's row (strongest
 *                      status wins, earliest trial start kept) and
 *                      the old row is deleted — one row per person,
 *                      never two grants;
 * - neither          → nothing (the new email is genuinely fresh).
 */
export async function mergeTrialHistory(client, oldEmail, newEmail) {
  const old = String(oldEmail || '').toLowerCase();
  const neu = String(newEmail || '').toLowerCase();
  if (!old || !neu || old === neu) return;
  const { rows: oldRows } = await client.query('SELECT * FROM trial_history WHERE email = $1', [old]);
  if (!oldRows.length) return;
  const oldRow = oldRows[0];
  const { rows: newRows } = await client.query('SELECT * FROM trial_history WHERE email = $1', [neu]);
  if (!newRows.length) {
    await client.query('UPDATE trial_history SET email = $2 WHERE email = $1', [old, neu]);
    return;
  }
  const newRow = newRows[0];
  const winner = (TRIAL_STATUS_RANK[oldRow.status] ?? 0) >= (TRIAL_STATUS_RANK[newRow.status] ?? 0)
    ? oldRow.status
    : newRow.status;
  const starts = [oldRow.first_trial_at, newRow.first_trial_at].filter(Boolean)
    .map((d) => new Date(d).getTime());
  const firstTrialAt = starts.length ? new Date(Math.min(...starts)).toISOString() : null;
  const consumeds = [oldRow.consumed_at, newRow.consumed_at].filter(Boolean)
    .map((d) => new Date(d).getTime());
  const consumedAt = consumeds.length ? new Date(Math.max(...consumeds)).toISOString() : null;
  await client.query(
    'UPDATE trial_history SET status = $2, first_trial_at = $3, consumed_at = $4 WHERE email = $1',
    [neu, winner, firstTrialAt, consumedAt],
  );
  await client.query('DELETE FROM trial_history WHERE email = $1', [old]);
}

// -------------------------------------------------------------------
// THE carry: an account moves to a new email
// -------------------------------------------------------------------

function statusStrength(status) {
  if (status === 'active') return 3;
  if (status === 'invited') return 2;
  if (status === 'suspended') return 1;
  return 0;
}

/**
 * Atomically move the account `userId` to `newEmail`. MUST be called
 * inside a transaction (the caller wraps it). Throws a shaped error
 * ({ status, code, message }) for the expected refusals:
 *   400 same_email   — the new email IS the current one;
 *   409 email_in_use — another account already lives under it.
 *
 * Staff rows: every staff_members row keyed to the old email (every
 * business) is re-keyed, so the person's jobs survive untouched —
 * roles, permissions and workforce history hang off the row id,
 * which does not change. If one business already has a row under the
 * NEW email (an owner pre-invited the new address), the two rows are
 * reconciled to ONE: the stronger status wins (active > invited >
 * suspended), ties keep the row being re-keyed (it carries the
 * person's working history); the loser row is deleted. A person
 * never holds access under both emails.
 *
 * The backup email follows the same logic as a spare key: if it
 * equals the new main email it is cleared (a spare key that opens
 * the front door is not a spare).
 */
export async function applyEmailChange(client, userId, newEmailRaw) {
  const newEmail = String(newEmailRaw || '').trim().toLowerCase();
  const { rows: userRows } = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
  const user = userRows[0];
  if (!user) {
    throw Object.assign(new Error('Account not found.'), { status: 404, code: 'user_not_found' });
  }
  const oldEmail = String(user.email).toLowerCase();
  if (newEmail === oldEmail) {
    throw Object.assign(new Error('That is already the email on this account.'), { status: 400, code: 'same_email' });
  }
  const { rows: clash } = await client.query(
    'SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2',
    [newEmail, userId],
  );
  if (clash.length) {
    throw Object.assign(
      new Error('Another account already uses that email. Use a different email, or sign in to that account instead.'),
      { status: 409, code: 'email_in_use' },
    );
  }

  // Staff rows: re-key, reconciling same-business duplicates.
  const { rows: conflicts } = await client.query(
    `SELECT old_row.id AS old_id, old_row.status AS old_status,
            new_row.id AS new_id, new_row.status AS new_status
       FROM staff_members old_row
       JOIN staff_members new_row
         ON new_row.business_id = old_row.business_id
        AND LOWER(new_row.email) = $2
      WHERE LOWER(old_row.email) = $1 AND new_row.id <> old_row.id`,
    [oldEmail, newEmail],
  );
  for (const conflict of conflicts) {
    if (statusStrength(conflict.new_status) > statusStrength(conflict.old_status)) {
      // The new-email row is the stronger record: drop the old row;
      // the blanket re-key below then has nothing left to move here.
      await client.query('DELETE FROM staff_members WHERE id = $1', [conflict.old_id]);
    } else {
      await client.query('DELETE FROM staff_members WHERE id = $1', [conflict.new_id]);
    }
  }
  await client.query('UPDATE staff_members SET email = $2 WHERE LOWER(email) = $1', [oldEmail, newEmail]);

  await mergeTrialHistory(client, oldEmail, newEmail);

  const backupCleared = user.backup_email && String(user.backup_email).toLowerCase() === newEmail;
  await client.query(
    `UPDATE users
        SET email = $2,
            pending_new_email = NULL,
            backup_email = CASE WHEN $3 THEN NULL ELSE backup_email END,
            backup_email_verified = CASE WHEN $3 THEN FALSE ELSE backup_email_verified END,
            pending_backup_email = CASE WHEN $3 THEN NULL ELSE pending_backup_email END,
            updated_at = NOW()
      WHERE id = $1`,
    [userId, newEmail, backupCleared],
  );
  return { oldEmail, newEmail };
}

// -------------------------------------------------------------------
// Stripe customer email — best effort, post-commit
// -------------------------------------------------------------------

/**
 * Keep Stripe's customer records pointing at the account's current
 * email (receipts and Stripe-side lookups key off it). Best-effort
 * BY DESIGN: the in-app carry is the source of truth, so a Stripe
 * hiccup is logged, never surfaced as a failed email change. Finds
 * customers two ways: the subscription rows of businesses this user
 * owns, and Stripe's own by-email lookup under the old address.
 * Never throws; returns a small summary for logs/tests.
 */
export async function syncStripeCustomerEmail(pool, userId, oldEmail, newEmail) {
  if (!stripeConfigured()) return { skipped: 'stripe_not_configured', updated: 0 };
  try {
    const customerIds = new Set();
    if (pool) {
      const { rows } = await pool.query(
        `SELECT DISTINCT s.provider_customer_id AS cid
           FROM subscriptions s
           JOIN businesses b ON b.id = s.business_id
          WHERE b.owner_id = $1 AND s.provider_customer_id IS NOT NULL AND s.provider_customer_id <> ''`,
        [userId],
      );
      for (const row of rows) customerIds.add(row.cid);
    }
    try {
      const found = await stripeApi.listCustomersByEmail(String(oldEmail || '').toLowerCase());
      for (const customer of found || []) {
        if (customer && customer.id) customerIds.add(customer.id);
      }
    } catch (lookupError) {
      console.error('[twin] Stripe customer lookup for email sync failed:', lookupError.message);
    }
    let updated = 0;
    for (const customerId of customerIds) {
      try {
        await stripeApi.updateCustomer(customerId, { email: newEmail });
        updated += 1;
      } catch (updateError) {
        console.error(`[twin] Stripe customer ${customerId} email sync failed:`, updateError.message);
      }
    }
    return { updated };
  } catch (error) {
    console.error('[twin] Stripe email sync failed:', error.message);
    return { updated: 0, error: error.message };
  }
}

/** Shoulder-surfing-safe rendering of an email for status responses. */
export function maskEmail(email) {
  const [namePart, domainPart] = String(email || '').split('@');
  if (!namePart || !domainPart) return null;
  const head = namePart.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(3, namePart.length - 2))}@${domainPart}`;
}
