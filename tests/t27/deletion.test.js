/**
 * T27 — Account-deletion REQUESTS (Nov 14, 2026).
 *
 * The Settings Delete Account card shipped invoking
 * `request-account-deletion`, which the twin's invoke shim never
 * implemented. This phase builds the server side with its
 * designed semantics, and this file holds them:
 *
 *   - POST /api/account/deletion-request { confirmation:
 *     'DELETE' } files a REQUEST FOR REVIEW. The Settings dialog
 *     gates on the current language's delete word client-side
 *     and always sends the function's literal token; anything
 *     else here is a 400.
 *   - Filing stores ONE row and emails a copy to the owner's
 *     support inbox. It deletes NOTHING (user, businesses,
 *     products all intact) and touches NO billing state (the
 *     entitlement row is byte-for-byte the same after filing).
 *   - Recorded once: while pending, a repeat filing returns the
 *     same request — no second row, no second email.
 *   - The status read (GET) is the caller's OWN request only —
 *     the Settings page is not owner-gated (any signed-in user
 *     may ask for their own account), and one user's request is
 *     invisible to another.
 *   - Unauthenticated calls are refused 401.
 *
 * Real Express app over HTTP against pg-mem, same as T23.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  close,
  mailbox,
  ownerWithBusiness,
  pool,
  registerVerifiedUser,
  req,
} from './helpers.js';

after(close);

const SUPPORT_INBOX = 'theluminousbookshop@outlook.com';
const URL = '/api/account/deletion-request';

async function requestRows(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM account_deletion_requests WHERE user_id = $1 ORDER BY created_at ASC',
    [userId],
  );
  return rows;
}

async function snapshotBilling(businessId) {
  const { rows } = await pool.query('SELECT * FROM entitlements WHERE business_id = $1', [businessId]);
  return rows;
}

test('unauthenticated status + filing are refused with 401 and save nothing', async () => {
  const status = await req(URL);
  assert.equal(status.status, 401);
  const filed = await req(URL, { method: 'POST', body: { confirmation: 'DELETE' } });
  assert.equal(filed.status, 401);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM account_deletion_requests');
  assert.equal(rows[0].n, 0);
});

test('status starts empty; filing without the confirmation token is a 400', async () => {
  const { cookie } = await registerVerifiedUser('delete-confirm@example.com');
  const status = await req(URL, { cookie });
  assert.equal(status.status, 200);
  assert.deepEqual(status.json, { pending: false, status: null, requested_at: null });

  const noToken = await req(URL, { method: 'POST', cookie, body: {} });
  assert.equal(noToken.status, 400);
  assert.equal(noToken.json.error, 'deletion_confirmation_required');
  const wrongToken = await req(URL, { method: 'POST', cookie, body: { confirmation: 'ELIMINAR' } });
  assert.equal(wrongToken.status, 400, 'the server takes the function token only — the localized word is the dialog gate');
});

test('happy path: recorded once, nothing deleted, billing untouched, inbox emailed', async () => {
  const { cookie, user, business } = await ownerWithBusiness('delete-owner@example.com', 'Doomed Mug Shop', { plan: 'business' });
  const billingBefore = await snapshotBilling(business.id);
  assert.equal(billingBefore.length, 1);
  const mailBefore = mailbox.filter((m) => m.to === SUPPORT_INBOX).length;

  const filed = await req(URL, { method: 'POST', cookie, body: { confirmation: 'DELETE' } });
  assert.equal(filed.status, 201, filed.text);
  assert.equal(filed.json.success, true);
  assert.equal(filed.json.status, 'requested');
  assert.equal(filed.json.pending, true);
  assert.ok(filed.json.requested_at, 'requested_at is returned for the Settings card');

  // Recorded once in the table…
  const rows = await requestRows(user.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'requested');
  assert.equal(rows[0].user_email, 'delete-owner@example.com');

  // …the status read shows the pending request…
  const status = await req(URL, { cookie });
  assert.equal(status.json.pending, true);
  assert.equal(status.json.status, 'requested');
  assert.equal(status.json.requested_at, filed.json.requested_at);

  // …a repeat filing returns the SAME request (no second row, no second email)…
  const again = await req(URL, { method: 'POST', cookie, body: { confirmation: 'DELETE' } });
  assert.equal(again.json.success, true);
  assert.equal(again.json.requested_at, filed.json.requested_at);
  assert.equal((await requestRows(user.id)).length, 1);

  // …the inbox got exactly one copy, worded as a request for review…
  const copies = mailbox.filter((m) => m.to === SUPPORT_INBOX);
  assert.equal(copies.length, mailBefore + 1);
  const mail = copies[copies.length - 1];
  assert.equal(mail.subject, 'Account deletion request — Luminous StockHaven');
  assert.match(mail.text, /request for review only/i);
  assert.match(mail.text, /delete-owner@example\.com/);

  // …NOTHING was deleted: user, business and products all stand…
  const { rows: userRows } = await pool.query('SELECT id FROM users WHERE id = $1', [user.id]);
  assert.equal(userRows.length, 1);
  const businesses = await req('/api/businesses', { cookie });
  assert.equal(businesses.status, 200);
  assert.ok(businesses.json.items.some((b) => b.id === business.id), 'the workspace still lists');

  // …and billing is byte-for-byte untouched.
  const billingAfter = await snapshotBilling(business.id);
  assert.deepEqual(
    billingAfter.map((r) => ({ ...r, created_at: String(r.created_at), updated_at: String(r.updated_at ?? '') })),
    billingBefore.map((r) => ({ ...r, created_at: String(r.created_at), updated_at: String(r.updated_at ?? '') })),
    'the entitlement row is unchanged by filing',
  );
});

test('requests are per-user: a second signed-in user sees none of the first user’s request', async () => {
  const first = await registerVerifiedUser('delete-first@example.com');
  const second = await registerVerifiedUser('delete-second@example.com');
  const filed = await req(URL, { method: 'POST', cookie: first.cookie, body: { confirmation: 'DELETE' } });
  assert.equal(filed.status, 201);

  const secondStatus = await req(URL, { cookie: second.cookie });
  assert.deepEqual(secondStatus.json, { pending: false, status: null, requested_at: null });

  // And the second user can file their own, independently.
  const secondFiled = await req(URL, { method: 'POST', cookie: second.cookie, body: { confirmation: 'DELETE' } });
  assert.equal(secondFiled.status, 201);
  assert.equal((await requestRows(first.user.id)).length, 1);
  assert.equal((await requestRows(second.user.id)).length, 1);
});

test('an under-review request still counts as pending and blocks duplicates', async () => {
  const { cookie, user } = await registerVerifiedUser('delete-review@example.com');
  const filed = await req(URL, { method: 'POST', cookie, body: { confirmation: 'DELETE' } });
  assert.equal(filed.status, 201);
  await pool.query("UPDATE account_deletion_requests SET status = 'under_review' WHERE user_id = $1", [user.id]);

  const status = await req(URL, { cookie });
  assert.equal(status.json.pending, true);
  assert.equal(status.json.status, 'under_review');

  const again = await req(URL, { method: 'POST', cookie, body: { confirmation: 'DELETE' } });
  assert.equal(again.json.status, 'under_review');
  assert.equal((await requestRows(user.id)).length, 1);
});
