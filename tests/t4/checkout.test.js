/**
 * T4 checkout + reconcile tests (T1–T3, T10 of the adapted matrix).
 * Real Express routes over HTTP against pg-mem, mock Stripe transport.
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
  mock,
} from './helpers.js';

after(close);
beforeEach(() => {
  mock.reset();
  resetRateLimits();
});

test('readiness reports ready from real config', async () => {
  const owner = await registerVerifiedUser('ready@example.com');
  const res = await req('/api/billing/readiness', { cookie: owner.cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.ready, true);
  assert.equal(res.json.stripe_mode, 'test');
  assert.equal(res.json.webhook_configured, true);
  assert.equal(res.json.test_prices_configured, true);
  assert.deepEqual(res.json.attestations, {
    fulfillment_tests_passed: true,
    test_containment_verified: true,
    checkout_enabled: true,
  });
});

test('readiness gate: checkout fails closed while attestations are unset', async () => {
  const owner = await ownerWithBusiness('gate@example.com');
  const before = process.env.STRIPE_CHECKOUT_ENABLED;
  process.env.STRIPE_CHECKOUT_ENABLED = 'false';
  try {
    const res = await req('/api/billing/checkout', {
      method: 'POST',
      body: { plan: 'essentials', business_id: owner.business.id },
      cookie: owner.cookie,
    });
    assert.equal(res.status, 503);
    assert.equal(res.json.error, 'stripe_not_configured');
  } finally {
    process.env.STRIPE_CHECKOUT_ENABLED = before;
  }
  const readiness = await req('/api/billing/readiness', { cookie: owner.cookie });
  assert.equal(readiness.json.ready, true);
});

test('checkout refuses bad plans, strangers, and signed-out callers', async () => {
  const owner = await ownerWithBusiness('checkout-guards@example.com');
  const stranger = await registerVerifiedUser('checkout-stranger@example.com');
  const badPlan = await req('/api/billing/checkout', {
    method: 'POST', body: { plan: 'mobile', business_id: owner.business.id }, cookie: owner.cookie,
  });
  assert.equal(badPlan.status, 400);
  const strangerCall = await req('/api/billing/checkout', {
    method: 'POST', body: { plan: 'essentials', business_id: owner.business.id }, cookie: stranger.cookie,
  });
  assert.equal(strangerCall.status, 403);
  const signedOut = await req('/api/billing/checkout', {
    method: 'POST', body: { plan: 'essentials', business_id: owner.business.id },
  });
  assert.equal(signedOut.status, 401);
});

test('trial checkout creates a pending purchase first, then reconcile grants trialing', async () => {
  const owner = await ownerWithBusiness('trial-grant@example.com');
  const checkout = await req('/api/billing/checkout', {
    method: 'POST',
    body: { plan: 'essentials', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(checkout.status, 200);
  assert.equal(checkout.json.trial_eligible, true);
  assert.ok(String(checkout.json.url).startsWith('https://checkout.stripe.com/pay/'));
  // Pending purchase exists BEFORE the customer leaves (and before reconcile).
  const purchases = await pool.query('SELECT * FROM purchases WHERE business_id = $1', [owner.business.id]);
  assert.equal(purchases.rows.length, 1);
  assert.equal(purchases.rows[0].status, 'pending');
  assert.equal(purchases.rows[0].provider_checkout_id, checkout.json.session_id);

  const reconcile = await req('/api/billing/reconcile', {
    method: 'POST',
    body: { session_id: checkout.json.session_id, business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(reconcile.status, 200);
  assert.equal(reconcile.json.state, 'granted');
  assert.equal(reconcile.json.plan, 'essentials');
  assert.equal(reconcile.json.status, 'trialing');
  const trialEnds = Date.parse(reconcile.json.trial_ends_at);
  assert.ok(trialEnds > Date.now() + 6 * 24 * 60 * 60 * 1000);
  assert.ok(trialEnds <= Date.now() + 7 * 24 * 60 * 60 * 1000 + 60_000);

  const ent = await pool.query('SELECT * FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].status, 'trialing');
  assert.equal(ent.rows[0].plan, 'essentials');
  const sub = await pool.query('SELECT * FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(sub.rows[0].status, 'trialing');
  assert.ok(sub.rows[0].provider_subscription_id.startsWith('sub_'));
  const done = await pool.query("SELECT * FROM purchases WHERE business_id = $1", [owner.business.id]);
  assert.equal(done.rows[0].status, 'completed');
});

test('reconcile is idempotent: a second call is already_active, no duplicate rows', async () => {
  const owner = await ownerWithBusiness('trial-twice@example.com');
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const again = await req('/api/billing/reconcile', {
    method: 'POST',
    body: { session_id: checkout.session_id, business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.state, 'already_active');
  const subs = await pool.query('SELECT * FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(subs.rows.length, 1);
  const ents = await pool.query('SELECT * FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ents.rows.length, 1);
});

test('reconcile refuses a session for another workspace and an unknown session', async () => {
  const owner = await ownerWithBusiness('reconcile-guard@example.com');
  const other = await ownerWithBusiness('reconcile-other@example.com');
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const wrongBusiness = await req('/api/billing/reconcile', {
    method: 'POST',
    body: { session_id: checkout.session_id, business_id: other.business.id },
    cookie: owner.cookie,
  });
  assert.equal(wrongBusiness.status, 400);
  const unknown = await req('/api/billing/reconcile', {
    method: 'POST',
    body: { session_id: 'cs_does_not_exist', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(unknown.status, 404);
  // No entitlement was granted by either refusal.
  const ents = await pool.query('SELECT * FROM entitlements WHERE business_id = $1', [other.business.id]);
  assert.equal(ents.rows.length, 0);
});

test('no-second-trial (TrialHistory hit): the same email pays in full up front', async () => {
  const owner = await ownerWithBusiness('returning@example.com');
  await trialCheckout(owner, owner.business.id, 'essentials');
  // A second business for the same owner (inserted directly — the
  // Essentials cap would refuse a second one through the API).
  const secondBusinessId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO businesses (id, owner_id, name, currency, created_by_id) VALUES ($1, $2, 'Second Shop', 'USD', $2)`,
    [secondBusinessId, owner.user.id],
  );
  await pool.query(
    `INSERT INTO business_memberships (id, business_id, user_id, role, created_by_id) VALUES ($1, $2, $3, 'owner', $3)`,
    [crypto.randomUUID(), secondBusinessId, owner.user.id],
  );
  const second = await req('/api/billing/checkout', {
    method: 'POST',
    body: { plan: 'business', business_id: secondBusinessId },
    cookie: owner.cookie,
  });
  assert.equal(second.status, 200);
  assert.equal(second.json.trial_eligible, false);
  assert.ok(second.json.message.includes('has subscribed before'));
  const reconcile = await req('/api/billing/reconcile', {
    method: 'POST',
    body: { session_id: second.json.session_id, business_id: secondBusinessId },
    cookie: owner.cookie,
  });
  assert.equal(reconcile.json.state, 'granted');
  assert.equal(reconcile.json.status, 'active');
  assert.equal(reconcile.json.plan, 'business');
});

test('no-second-trial (Stripe hit): TrialHistory wiped, Stripe still refuses the trial', async () => {
  const owner = await ownerWithBusiness('stripe-memory@example.com');
  await trialCheckout(owner, owner.business.id, 'essentials');
  // The local memory is gone — Stripe's own records are the second memory.
  await pool.query('DELETE FROM trial_history WHERE email = $1', [owner.email]);
  const secondBusinessId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO businesses (id, owner_id, name, currency, created_by_id) VALUES ($1, $2, 'Second Shop', 'USD', $2)`,
    [secondBusinessId, owner.user.id],
  );
  await pool.query(
    `INSERT INTO business_memberships (id, business_id, user_id, role, created_by_id) VALUES ($1, $2, $3, 'owner', $3)`,
    [crypto.randomUUID(), secondBusinessId, owner.user.id],
  );
  const second = await req('/api/billing/checkout', {
    method: 'POST',
    body: { plan: 'essentials', business_id: secondBusinessId },
    cookie: owner.cookie,
  });
  assert.equal(second.status, 200);
  assert.equal(second.json.trial_eligible, false);
});

test('trial-eligibility endpoint answers plainly for fresh and returning emails', async () => {
  const fresh = await ownerWithBusiness('eligible-fresh@example.com');
  const checkFresh = await req(`/api/billing/trial-eligibility?business_id=${fresh.business.id}`, { cookie: fresh.cookie });
  assert.equal(checkFresh.json.trial_eligible, true);
  await trialCheckout(fresh, fresh.business.id, 'essentials');
  const checkUsed = await req(`/api/billing/trial-eligibility?business_id=${fresh.business.id}`, { cookie: fresh.cookie });
  assert.equal(checkUsed.json.trial_eligible, false);
  assert.ok(checkUsed.json.message.includes('has subscribed before'));
});

test('grandfathered business is never granted to by checkout', async () => {
  const owner = await registerVerifiedUser('grandfathered@example.com');
  const businessId = '6aeaec9b141cfe26e5a411be';
  await pool.query(
    `INSERT INTO businesses (id, owner_id, name, currency, created_by_id) VALUES ($1, $2, 'Complimentary', 'USD', $2)`,
    [businessId, owner.user.id],
  );
  await pool.query(
    `INSERT INTO business_memberships (id, business_id, user_id, role, created_by_id) VALUES ($1, $2, $3, 'owner', $3)`,
    [crypto.randomUUID(), businessId, owner.user.id],
  );
  const res = await req('/api/billing/checkout', {
    method: 'POST',
    body: { plan: 'essentials', business_id: businessId },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'complimentary_business_account_protected');
});

test('a Business customer is never offered a fresh Essentials checkout (no-second-subscription trap)', async () => {
  const owner = await ownerWithBusiness('trap@example.com');
  await trialCheckout(owner, owner.business.id, 'business');
  const again = await req('/api/billing/checkout', {
    method: 'POST',
    body: { plan: 'essentials', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(again.status, 409);
  assert.equal(again.json.error, 'already_subscribed');
});

test('paid checkout (returning email, no trial) grants active, not trialing', async () => {
  const owner = await ownerWithBusiness('paid-grant@example.com');
  // Pre-consume the trial so checkout offers no trial (paid up front).
  await pool.query(
    `INSERT INTO trial_history (id, email, plan, status, source, first_trial_at, consumed_at)
     VALUES ($1, $2, 'essentials', 'consumed', 'stripe_checkout', NOW(), NOW())`,
    [crypto.randomUUID(), owner.email],
  );
  const checkout = await req('/api/billing/checkout', {
    method: 'POST',
    body: { plan: 'essentials', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(checkout.json.trial_eligible, false);
  const reconcile = await req('/api/billing/reconcile', {
    method: 'POST',
    body: { session_id: checkout.json.session_id, business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(reconcile.json.state, 'granted');
  assert.equal(reconcile.json.status, 'active');
  const ent = await pool.query('SELECT * FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].status, 'active');
  assert.equal(ent.rows[0].trial_ends_at, null);
});
