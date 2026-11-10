/**
 * T4 cancel / refund / grace / wipe tests (T8, T9, T11, T12 of the
 * adapted matrix) + the grant-transaction atomicity test.
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
  trialCheckout,
  setEntitlement,
  mock,
  JOB_SECRET,
} from './helpers.js';
import { refundWindowFor, withTx, graceStateFor } from '../../server/billing.js';

after(close);
beforeEach(() => {
  mock.reset();
  resetRateLimits();
});

async function paidOwner(email) {
  const owner = await ownerWithBusiness(email);
  await pool.query(
    `INSERT INTO trial_history (id, email, plan, status, source, first_trial_at, consumed_at)
     VALUES ($1, $2, 'essentials', 'consumed', 'stripe_checkout', NOW(), NOW())`,
    [crypto.randomUUID(), owner.email],
  );
  await trialCheckout(owner, owner.business.id, 'essentials');
  return owner;
}

async function cancel(owner, businessId) {
  return req('/api/billing/cancel', {
    method: 'POST',
    body: { business_id: businessId },
    cookie: owner.cookie,
  });
}

test('grant runs inside one Postgres transaction: BEGIN, and ROLLBACK (not COMMIT) on failure', async () => {
  // pg-mem does NOT actually roll back (verified: a row inserted
  // inside BEGIN survives ROLLBACK in pg-mem 3.0.14), so the true
  // rollback proof awaits the real Fly Postgres at deploy. What this
  // test proves is the code discipline: withTx issues BEGIN, runs
  // the writes on ONE client, and on failure issues ROLLBACK and
  // never COMMIT — the shape a real Postgres turns into atomicity.
  const calls = [];
  const fakeClient = {
    query: async (sql) => {
      calls.push(String(sql).trim().toUpperCase().slice(0, 20));
      if (String(sql).includes('FAIL_NOW')) throw new Error('boom');
      return { rows: [] };
    },
    release: () => {},
  };
  const fakePool = { connect: async () => fakeClient };
  await assert.rejects(() =>
    withTx(fakePool, async (client) => {
      await client.query('INSERT INTO subscription_events (id) VALUES (FAIL_NOW)');
    }),
  );
  assert.ok(calls.includes('BEGIN'), 'BEGIN was issued');
  assert.ok(calls.includes('ROLLBACK'), 'ROLLBACK was issued on failure');
  assert.ok(!calls.includes('COMMIT'), 'COMMIT was never issued after the failure');
  const okCalls = [];
  const okClient = {
    query: async (sql) => {
      okCalls.push(String(sql).trim().toUpperCase().slice(0, 20));
      return { rows: [{ id: 'x' }] };
    },
    release: () => {},
  };
  const okPool = { connect: async () => okClient };
  await withTx(okPool, async (client) => {
    await client.query('INSERT INTO subscription_events (id) VALUES (1)');
  });
  assert.ok(okCalls.includes('BEGIN') && okCalls.includes('COMMIT'), 'success path issues BEGIN then COMMIT');
  assert.ok(!okCalls.includes('ROLLBACK'), 'success path never rolls back');
});

test('cancel during trial keeps the full 7 days and never charges', async () => {
  const owner = await ownerWithBusiness('cancel-trial@example.com');
  const { reconcile } = await trialCheckout(owner, owner.business.id, 'essentials');
  const res = await cancel(owner, owner.business.id);
  assert.equal(res.status, 200);
  assert.equal(res.json.state, 'cancellation_recorded');
  assert.equal(res.json.access_until, reconcile.trial_ends_at);
  assert.ok(res.json.grace_ends_at);
  // Stripe confirms cancel_at_period_end.
  const subRow = await pool.query('SELECT * FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(subRow.rows[0].status, 'canceled');
  assert.equal(subRow.rows[0].cancel_at_period_end, true);
  const session = mock.getSession((await pool.query('SELECT provider_checkout_id FROM purchases WHERE business_id = $1', [owner.business.id])).rows[0].provider_checkout_id);
  assert.equal(mock.getSubscription(session.subscription).cancel_at_period_end, true);
  // Grace starts after the trial end, not now.
  const grace = await graceStateFor(pool, owner.business.id, new Date());
  assert.equal(grace.state, 'full_access');
});

test('cancel after paid keeps full access to period end; double-tap is already_canceled', async () => {
  const owner = await paidOwner('cancel-paid@example.com');
  const first = await cancel(owner, owner.business.id);
  assert.equal(first.status, 200);
  assert.equal(first.json.state, 'cancellation_recorded');
  assert.equal(first.json.refund_window_open, true);
  const second = await cancel(owner, owner.business.id);
  assert.equal(second.status, 200);
  assert.equal(second.json.state, 'already_canceled');
  assert.equal(second.json.access_until, first.json.access_until);
  const events = await pool.query("SELECT * FROM subscription_events WHERE kind = 'cancel' AND business_id = $1", [owner.business.id]);
  assert.equal(events.rows.length, 1);
});

test('refund window: open within 72h of the FIRST paid charge, closed after', async () => {
  const owner = await paidOwner('refund-window@example.com');
  const subRow = await pool.query('SELECT provider_subscription_id FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  const subId = subRow.rows[0].provider_subscription_id;
  const open = await refundWindowFor(pool, (await import('../../server/stripeClient.js')).stripeApi, subId);
  assert.equal(open.open, true);
  assert.ok(open.firstChargeAt);
  // A first charge 4 days ago: window closed (trial start does not count).
  const fakeStripe = {
    listInvoicesBySubscription: async () => [{
      id: 'in_old',
      billing_reason: 'subscription_create',
      amount_paid: 1499,
      status: 'paid',
      created: Math.floor(Date.now() / 1000) - 4 * 24 * 60 * 60,
    }],
  };
  const closed = await refundWindowFor(pool, fakeStripe, subId);
  assert.equal(closed.open, false);
  // A $0 trial invoice is not a paid charge: no window at all.
  const trialOnly = {
    listInvoicesBySubscription: async () => [{
      id: 'in_trial',
      billing_reason: 'subscription_create',
      amount_paid: 0,
      status: 'paid',
      created: Math.floor(Date.now() / 1000),
    }],
  };
  const none = await refundWindowFor(pool, trialOnly, subId);
  assert.equal(none.open, false);
  assert.equal(none.firstChargeAt, null);
});

test('grace blocks every write server-side but reads stay open', async () => {
  const owner = await ownerWithBusiness('grace-block@example.com');
  await trialCheckout(owner, owner.business.id, 'essentials');
  // Create a product first (while access is full), then enter grace.
  const product = await req('/api/entities/Product', {
    method: 'POST',
    body: { business_id: owner.business.id, name: 'Bookmark', sku: 'BM-1' },
    cookie: owner.cookie,
  });
  assert.equal(product.status, 201);
  await cancel(owner, owner.business.id);
  // Move the paid period into the past (test-only): now in grace.
  const pastPeriodEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    "UPDATE entitlements SET period_ends_at = $1 WHERE business_id = $2",
    [pastPeriodEnd, owner.business.id],
  );
  const grace = await graceStateFor(pool, owner.business.id, new Date());
  assert.equal(grace.state, 'grace');
  // Reads still work (see products only).
  const read = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: owner.business.id } },
    cookie: owner.cookie,
  });
  assert.equal(read.status, 200);
  assert.equal(read.json.items.length, 1);
  // Writes refuse with grace_read_only.
  const create = await req('/api/entities/Product', {
    method: 'POST',
    body: { business_id: owner.business.id, name: 'Second', sku: 'BM-2' },
    cookie: owner.cookie,
  });
  assert.equal(create.status, 403);
  assert.equal(create.json.error, 'grace_read_only');
  const update = await req(`/api/entities/Product/${product.json.id}`, {
    method: 'PATCH',
    body: { name: 'Changed' },
    cookie: owner.cookie,
  });
  assert.equal(update.status, 403);
  const remove = await req(`/api/entities/Product/${product.json.id}`, {
    method: 'DELETE',
    cookie: owner.cookie,
  });
  assert.equal(remove.status, 403);
  const scan = await req(`/api/businesses/${owner.business.id}/scan/lookup`, {
    method: 'POST',
    body: { code: 'BM-1' },
    cookie: owner.cookie,
  });
  assert.equal(scan.status, 403);
  assert.equal(scan.json.error, 'grace_read_only');
  const exportRes = await req(`/api/businesses/${owner.business.id}/export/products`, { cookie: owner.cookie });
  assert.equal(exportRes.status, 403);
});

test('wipe sweep deletes the account and all its information 15 days after paid-through, keeps TrialHistory', async () => {
  const owner = await paidOwner('wipe-me@example.com');
  await cancel(owner, owner.business.id);
  // Push the paid period 16 days into the past: grace ended yesterday.
  const pastPeriodEnd = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString();
  const pastGraceEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    'UPDATE entitlements SET period_ends_at = $1 WHERE business_id = $2',
    [pastPeriodEnd, owner.business.id],
  );
  await pool.query(
    'UPDATE subscriptions SET grace_ends_at = $1, current_period_end = $2 WHERE business_id = $3',
    [pastGraceEnd, pastPeriodEnd, owner.business.id],
  );
  const res = await req('/api/billing/wipe-sweep', {
    method: 'POST',
    headers: { 'x-job-secret': JOB_SECRET },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.wiped.length, 1);
  assert.equal(res.json.wiped[0].ownerId, owner.user.id);
  // Account + businesses + subscriptions + purchases are gone...
  const user = await pool.query('SELECT * FROM users WHERE id = $1', [owner.user.id]);
  assert.equal(user.rows.length, 0);
  const businesses = await pool.query('SELECT * FROM businesses WHERE owner_id = $1', [owner.user.id]);
  assert.equal(businesses.rows.length, 0);
  const subs = await pool.query('SELECT * FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(subs.rows.length, 0);
  // ...but the TrialHistory row is KEPT (no second trial, ever).
  const history = await pool.query('SELECT * FROM trial_history WHERE email = $1', [owner.email]);
  assert.equal(history.rows.length, 1);
  assert.equal(history.rows[0].status, 'consumed');
});

test('wipe sweep skips an owner who still has a live business, and refuses a bad job secret', async () => {
  const owner = await paidOwner('wipe-skip@example.com');
  // A second, live business for the same owner (inserted directly).
  const secondBusinessId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO businesses (id, owner_id, name, currency, created_by_id) VALUES ($1, $2, 'Live Shop', 'USD', $2)`,
    [secondBusinessId, owner.user.id],
  );
  await setEntitlement(secondBusinessId, { plan: 'business', status: 'active' });
  await cancel(owner, owner.business.id);
  const pastPeriodEnd = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString();
  const pastGraceEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await pool.query('UPDATE entitlements SET period_ends_at = $1 WHERE business_id = $2', [pastPeriodEnd, owner.business.id]);
  await pool.query('UPDATE subscriptions SET grace_ends_at = $1, current_period_end = $2 WHERE business_id = $3', [pastGraceEnd, pastPeriodEnd, owner.business.id]);
  const badSecret = await req('/api/billing/wipe-sweep', {
    method: 'POST',
    headers: { 'x-job-secret': 'wrong-secret' },
  });
  assert.equal(badSecret.status, 401);
  const res = await req('/api/billing/wipe-sweep', {
    method: 'POST',
    headers: { 'x-job-secret': JOB_SECRET },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.wiped.length, 0);
  assert.equal(res.json.skipped.length, 1);
  assert.equal(res.json.skipped[0].reason, 'owner_has_live_business');
  const user = await pool.query('SELECT * FROM users WHERE id = $1', [owner.user.id]);
  assert.equal(user.rows.length, 1);
});

test('cancel refuses strangers and workspaces with no verified subscription', async () => {
  const owner = await ownerWithBusiness('cancel-guards@example.com');
  const stranger = await ownerWithBusiness('cancel-stranger@example.com');
  await trialCheckout(owner, owner.business.id, 'essentials');
  const strangerCall = await cancel(stranger, owner.business.id);
  assert.equal(strangerCall.status, 403);
  const noSub = await cancel(stranger, stranger.business.id);
  assert.equal(noSub.status, 400);
  assert.equal(noSub.json.error, 'no_verified_subscription_record');
});
