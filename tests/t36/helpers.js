/**
 * T36 helpers — the founding-tester comp build (Nov 21, 2026).
 * Boots the real app via the T4 harness (pg-mem + mock Stripe) and
 * adds the comp-list fixtures.
 */
import crypto from 'node:crypto';

export * from '../t4/helpers.js';
import { pool } from '../t4/helpers.js';

export const OPERATOR_EMAIL = 'cperezcarrillo.1990@gmail.com';

export async function insertCompEntry(email, note = '') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO founding_tester_comp (id, email, note, status)
     VALUES ($1, $2, $3, 'active')`,
    [id, String(email).trim().toLowerCase(), note],
  );
  return id;
}

export async function compEntry(email) {
  const { rows } = await pool.query(
    'SELECT * FROM founding_tester_comp WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC',
    [email],
  );
  return rows[0] || null;
}

export async function entitlementOf(businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM entitlements WHERE business_id = $1',
    [businessId],
  );
  return rows[0] || null;
}

export async function countRows(table, businessId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE business_id = $1`,
    [businessId],
  );
  return rows[0].n;
}
