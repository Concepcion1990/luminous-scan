#!/usr/bin/env node
/**
 * Seed a TEST-ONLY owner + business — T2.
 *
 *   DATABASE_URL=... SEED_OWNER_EMAIL=... SEED_OWNER_PASSWORD=... node scripts/seed-test-owner.js
 *
 * Creates (idempotently — safe to re-run) a verified owner user and the
 * business "The Luminous Book Shop, LLC" with an owner membership, for
 * LOCAL / TEST USE ONLY.
 *
 * NEVER auto-run: nothing calls this on boot, and it is never run
 * against a production database. Live seeding waits for Postgres
 * provisioning on Fly plus the owner's first real login — real
 * accounts are created through /register, not through this script.
 *
 * Defaults are obviously-test values; pass real test credentials via
 * env when you need a specific login. The password is hashed with
 * bcrypt like any other password — never stored or printed plaintext.
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { hashPassword } from '../server/passwords.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || '';
const EMAIL = (process.env.SEED_OWNER_EMAIL || 'owner-test@theluminousbookshop.test').toLowerCase();
const PASSWORD = process.env.SEED_OWNER_PASSWORD || 'TestOwnerPass123';
const BUSINESS_NAME = process.env.SEED_BUSINESS_NAME || 'The Luminous Book Shop, LLC';

if (!DATABASE_URL || DATABASE_URL.startsWith('pg-mem:')) {
  console.error('seed-test-owner: set DATABASE_URL to a real Postgres connection string (pg-mem is not supported here).');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('seed-test-owner: refusing to run with NODE_ENV=production — test seeding is never run live.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let user = (await client.query('SELECT * FROM users WHERE email = $1', [EMAIL])).rows[0];
    if (!user) {
      const passwordHash = await hashPassword(PASSWORD);
      user = (
        await client.query(
          `INSERT INTO users (id, email, password_hash, email_verified)
           VALUES ($1, $2, $3, TRUE) RETURNING *`,
          [crypto.randomUUID(), EMAIL, passwordHash],
        )
      ).rows[0];
      console.log(`seed-test-owner: created verified test owner ${EMAIL} (id ${user.id})`);
    } else {
      if (!user.email_verified) {
        await client.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [user.id]);
      }
      console.log(`seed-test-owner: test owner ${EMAIL} already exists (id ${user.id})`);
    }
    let business = (
      await client.query('SELECT * FROM businesses WHERE owner_id = $1 AND name = $2', [user.id, BUSINESS_NAME])
    ).rows[0];
    if (!business) {
      business = (
        await client.query(
          `INSERT INTO businesses (id, owner_id, name, tagline, currency, created_by_id)
           VALUES ($1, $2, $3, '', 'USD', $2) RETURNING *`,
          [crypto.randomUUID(), user.id, BUSINESS_NAME],
        )
      ).rows[0];
      console.log(`seed-test-owner: created business "${BUSINESS_NAME}" (id ${business.id})`);
    } else {
      console.log(`seed-test-owner: business "${BUSINESS_NAME}" already exists (id ${business.id})`);
    }
    const membership = (
      await client.query(
        'SELECT * FROM business_memberships WHERE business_id = $1 AND user_id = $2',
        [business.id, user.id],
      )
    ).rows[0];
    if (!membership) {
      await client.query(
        `INSERT INTO business_memberships (id, business_id, user_id, role, created_by_id)
         VALUES ($1, $2, $3, 'owner', $3)`,
        [crypto.randomUUID(), business.id, user.id],
      );
      console.log('seed-test-owner: created owner membership');
    }
    if (!user.active_business_id) {
      await client.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [business.id, user.id]);
    }
    await client.query('COMMIT');
    console.log('seed-test-owner: done. Log in with the test owner email + password (never a live credential).');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error('seed-test-owner failed:', error.message);
  process.exit(1);
} finally {
  await pool.end();
}
