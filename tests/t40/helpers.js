/**
 * T40 helpers — the signup domain blocklist build (Nov 22, 2026).
 * Boots the real app via the T4 harness (pg-mem + mock Stripe) and
 * adds the blocklist fixtures.
 */
export * from '../t4/helpers.js';
import { pool } from '../t4/helpers.js';

export const OPERATOR_EMAIL = 'cperezcarrillo.1990@gmail.com';

export async function blockedDomainRow(domain) {
  const { rows } = await pool.query(
    'SELECT * FROM blocked_email_domains WHERE LOWER(domain) = LOWER($1) ORDER BY created_at DESC',
    [domain],
  );
  return rows[0] || null;
}

export async function userRow(email) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [String(email).trim().toLowerCase()],
  );
  return rows[0] || null;
}
