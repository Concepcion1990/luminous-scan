/**
 * T11 offboarding — when the owner removes a staff member, that
 * person's access to the business dies on the spot, including a
 * session they are still signed in with; their direct-deposit bank
 * details are purged; and the business's books (issued pay stubs,
 * time entries) survive untouched.
 *
 * Why this works architecturally (server/sessions.js +
 * server/authz.js): the session cookie is only a bearer for a
 * server-side session row holding the USER id — no business
 * membership is ever cached in it. Every protected request re-runs
 * resolveAccess, which re-reads the live staff_members row and
 * requires status 'active' plus the provenance check. Delete (or
 * suspend) the row and the very next request resolves to no access.
 * These tests prove that end-to-end over HTTP, per business.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
  createProducts,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

const WF = (bid) => `/api/businesses/${bid}/workforce`;
const TR = (bid) => `/api/businesses/${bid}/training`;

/** Insert a trusted staff row (created by the business owner). */
async function insertStaffRow(business, ownerId, email, { status = 'active', name = 'Sam Staff' } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, $3, $4, 'user', 'preset-sales', 'Sales clerk', '[]', $5, $6)`,
    [id, business.id, name, email, status, ownerId],
  );
  return id;
}

async function productQuery(cookie, businessId) {
  return req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: businessId } },
    cookie,
  });
}

// ---- Session death on removal ----------------------------------------------

test('removal: the same live session loses the business on every surface, on the very next request', async () => {
  const a = await ownerWithBusiness('off-a-owner@example.com');
  const b = await ownerWithBusiness('off-b-owner@example.com');
  const person = await registerVerifiedUser('off-person@example.com');
  const staffIdA = await insertStaffRow(a.business, a.user.id, person.email);
  await insertStaffRow(b.business, b.user.id, person.email);
  const [product] = await createProducts(a.cookie, a.business.id, [{ name: 'Offboarding Widget', sku: 'OFF-1' }]);

  // Before removal, the person's session works everywhere in A, and in B.
  assert.equal((await productQuery(person.cookie, a.business.id)).json.items.length, 1);
  assert.equal((await req(`/api/entities/Product/${product.id}`, { cookie: person.cookie })).status, 200);
  assert.equal((await req(`${WF(a.business.id)}/notifications`, { cookie: person.cookie })).status, 200);
  assert.equal((await req(`${TR(a.business.id)}/state`, { cookie: person.cookie })).status, 200);
  assert.equal((await req(`${WF(a.business.id)}/messages/threads`, { cookie: person.cookie })).status, 200);
  assert.equal((await productQuery(person.cookie, b.business.id)).status, 200);

  // The owner removes them from business A.
  const removed = await req(`/api/businesses/${a.business.id}/staff/${staffIdA}`, {
    method: 'DELETE',
    cookie: a.cookie,
  });
  assert.equal(removed.status, 200);

  // The SAME session cookie, immediately after: nothing of A remains.
  // List reads scope to accessible businesses (empty, nothing leaks);
  // single-row reads and every route family refuse outright.
  assert.equal((await productQuery(person.cookie, a.business.id)).json.items.length, 0, 'product list yields nothing of A');
  assert.equal((await req(`/api/entities/Product/${product.id}`, { cookie: person.cookie })).status, 403, 'product read denied');
  assert.equal((await req(`${WF(a.business.id)}/notifications`, { cookie: person.cookie })).status, 403, 'workforce denied');
  assert.equal((await req(`${TR(a.business.id)}/state`, { cookie: person.cookie })).status, 403, 'training denied');
  assert.equal((await req(`${WF(a.business.id)}/messages/threads`, { cookie: person.cookie })).status, 403, 'messaging denied');
  assert.equal(
    (await req(`/api/businesses/${a.business.id}/staff/me`, { cookie: person.cookie })).status,
    404,
    'no staff record remains for them in A',
  );

  // The denial is per-business: the account is alive, still signed in,
  // and business B — where they still work — is completely untouched.
  assert.equal((await req('/api/auth/me', { cookie: person.cookie })).status, 200, 'the account itself is not logged out');
  assert.equal((await req(`${TR(b.business.id)}/state`, { cookie: person.cookie })).status, 200, 'business B still open to them');
  assert.equal((await req(`${WF(b.business.id)}/notifications`, { cookie: person.cookie })).status, 200);

  // And the owner of A is unaffected.
  assert.equal((await productQuery(a.cookie, a.business.id)).json.items.length, 1);
});

// ---- The books survive; the bank details do not -----------------------------

test('removal purges direct-deposit details but issued pay stubs and time entries survive', async () => {
  const a = await ownerWithBusiness('off-books-owner@example.com');
  const sam = await registerVerifiedUser('off-books-sam@example.com');
  const sue = await registerVerifiedUser('off-books-sue@example.com');
  const samId = await insertStaffRow(a.business, a.user.id, sam.email, { name: 'Sam Staff' });
  const sueId = await insertStaffRow(a.business, a.user.id, sue.email, { name: 'Sue Staff' });

  // The books: one payroll run, one issued stub, one clock entry for Sam.
  const runId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO payroll_runs (id, business_id, period_start, period_end, created_by_id) VALUES ($1, $2, $3, $4, $5)',
    [runId, a.business.id, '2026-11-02', '2026-11-08', a.user.id],
  );
  const stubId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO pay_stubs (id, run_id, business_id, staff_member_id, person_name, gross, net, pushed)
     VALUES ($1, $2, $3, $4, 'Sam Staff', 500, 430, TRUE)`,
    [stubId, runId, a.business.id, samId],
  );
  const entryId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO time_entries (id, business_id, staff_member_id, clock_in_at, clock_out_at)
     VALUES ($1, $2, $3, '2026-11-10T15:00:00Z', '2026-11-10T23:00:00Z')`,
    [entryId, a.business.id, samId],
  );
  // Direct-deposit details for BOTH members (submitted bank details).
  for (const [staffId, account] of [[samId, '111111111'], [sueId, '222222222']]) {
    await pool.query(
      `INSERT INTO direct_deposit_details (business_id, staff_member_id, status, bank_name, routing_number, account_number)
       VALUES ($1, $2, 'submitted', 'Test Bank', '021000021', $3)`,
      [a.business.id, staffId, account],
    );
  }

  const removed = await req(`/api/businesses/${a.business.id}/staff/${samId}`, {
    method: 'DELETE',
    cookie: a.cookie,
  });
  assert.equal(removed.status, 200);

  const count = async (sql, params) => (await pool.query(sql, params)).rows[0].n;
  assert.equal(await count('SELECT COUNT(*)::int AS n FROM staff_members WHERE id = $1', [samId]), 0, 'the staff row is gone');
  assert.equal(
    await count('SELECT COUNT(*)::int AS n FROM direct_deposit_details WHERE business_id = $1 AND staff_member_id = $2', [a.business.id, samId]),
    0,
    "Sam's direct-deposit bank details are purged",
  );
  assert.equal(
    await count('SELECT COUNT(*)::int AS n FROM direct_deposit_details WHERE business_id = $1 AND staff_member_id = $2', [a.business.id, sueId]),
    1,
    "Sue's direct-deposit details are untouched",
  );
  const stub = (await pool.query('SELECT * FROM pay_stubs WHERE id = $1', [stubId])).rows[0];
  assert.ok(stub, "Sam's issued pay stub survives the removal");
  assert.equal(stub.person_name, 'Sam Staff', 'the stub still says whose it was');
  assert.equal(Number(stub.net), 430);
  assert.equal(
    await count('SELECT COUNT(*)::int AS n FROM time_entries WHERE id = $1', [entryId]),
    1,
    "Sam's time entry survives the removal",
  );
});

// ---- A deleted invitation cannot activate -----------------------------------

test('an invited-then-deleted member cannot activate by signing in afterwards', async () => {
  const a = await ownerWithBusiness('off-invite-owner@example.com');

  // The invite is issued, then the owner changes their mind and
  // deletes the row before the person ever signs in.
  const goneId = await insertStaffRow(a.business, a.user.id, 'off-gone-invite@example.com', { status: 'invited' });
  const removed = await req(`/api/businesses/${a.business.id}/staff/${goneId}`, {
    method: 'DELETE',
    cookie: a.cookie,
  });
  assert.equal(removed.status, 200);

  // The person signs up anyway. Activation flips only rows that
  // exist — theirs does not — so nothing is resurrected and the
  // business stays closed to them.
  const late = await registerVerifiedUser('off-gone-invite@example.com');
  const rows = await pool.query('SELECT * FROM staff_members WHERE LOWER(email) = LOWER($1)', [late.email]);
  assert.equal(rows.rows.length, 0, 'no staff row was resurrected by sign-in');
  assert.equal((await productQuery(late.cookie, a.business.id)).json.items.length, 0);
  assert.equal((await req(`${TR(a.business.id)}/state`, { cookie: late.cookie })).status, 403);

  // Control: an invitation that is NOT deleted activates on sign-in
  // exactly as before, so the negative above is not vacuous.
  await insertStaffRow(a.business, a.user.id, 'off-kept-invite@example.com', { status: 'invited' });
  const kept = await registerVerifiedUser('off-kept-invite@example.com');
  const keptRows = await pool.query('SELECT * FROM staff_members WHERE LOWER(email) = LOWER($1)', [kept.email]);
  assert.equal(keptRows.rows.length, 1);
  assert.equal(keptRows.rows[0].status, 'active', 'the kept invitation activated on sign-in');
  assert.equal((await req(`${TR(a.business.id)}/state`, { cookie: kept.cookie })).status, 200);
});

// ---- Suspension: the same per-request guarantee ------------------------------

test('suspension denies the live session per request; reactivation restores it', async () => {
  const a = await ownerWithBusiness('off-suspend-owner@example.com');
  const sam = await registerVerifiedUser('off-suspend-sam@example.com');
  const samId = await insertStaffRow(a.business, a.user.id, sam.email);
  await createProducts(a.cookie, a.business.id, [{ name: 'Suspend Widget', sku: 'OFF-S1' }]);

  assert.equal((await productQuery(sam.cookie, a.business.id)).json.items.length, 1);
  assert.equal((await req(`${WF(a.business.id)}/notifications`, { cookie: sam.cookie })).status, 200);

  // The owner suspends the member (the shipped staff PATCH path).
  const suspended = await req(`/api/businesses/${a.business.id}/staff/${samId}`, {
    method: 'PATCH',
    body: { status: 'suspended' },
    cookie: a.cookie,
  });
  assert.equal(suspended.status, 200);

  // resolveAccess requires status 'active', so the SAME session is
  // denied on the very next request — without being logged out.
  assert.equal((await productQuery(sam.cookie, a.business.id)).json.items.length, 0, 'suspended: product list yields nothing');
  assert.equal((await req(`${WF(a.business.id)}/notifications`, { cookie: sam.cookie })).status, 403, 'suspended: workforce denied');
  assert.equal((await req('/api/auth/me', { cookie: sam.cookie })).status, 200, 'suspension is not a logout');

  // Reactivation restores the same session — proof the denial was
  // the live status check, not any session destruction.
  const restored = await req(`/api/businesses/${a.business.id}/staff/${samId}`, {
    method: 'PATCH',
    body: { status: 'active' },
    cookie: a.cookie,
  });
  assert.equal(restored.status, 200);
  assert.equal((await productQuery(sam.cookie, a.business.id)).json.items.length, 1, 'reactivated: access returns');
});
