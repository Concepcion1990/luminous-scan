/**
 * T53 helpers — release 356, business #2 inherits the plan
 * (Nov 23, 2026). Boots the real app via the T4 harness
 * (pg-mem + mock Stripe) and adds the comp-list fixture from T36.
 */
import crypto from 'node:crypto';

export * from '../t4/helpers.js';
import { pool } from '../t4/helpers.js';

export async function insertCompEntry(email, note = '') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO founding_tester_comp (id, email, note, status)
     VALUES ($1, $2, $3, 'active')`,
    [id, String(email).trim().toLowerCase(), note],
  );
  return id;
}

export async function entitlementRowOf(businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM entitlements WHERE business_id = $1',
    [businessId],
  );
  return rows[0] || null;
}

export async function subscriptionRowOf(businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM subscriptions WHERE business_id = $1',
    [businessId],
  );
  return rows[0] || null;
}
