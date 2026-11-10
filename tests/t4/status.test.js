/**
 * T4 status / publisher-access / grant-evidence tests.
 * Status re-reads from Stripe (not just the local record); the
 * publisher gate is server-side yes/no; evidence mapping refuses
 * wrong prices, wrong currencies, and non-grantable statuses.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
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
import { evidenceFromSubscription } from '../../server/stripeEvidence.js';

after(close);
beforeEach(() => {
  mock.reset();
  resetRateLimits();
});

test('status re-reads from Stripe: a past-due change at Stripe shows up without a local write', async () => {
  const owner = await ownerWithBusiness('status-reread@example.com');
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const first = await req(`/api/billing/status?business_id=${owner.business.id}`, { cookie: owner.cookie });
  assert.equal(first.status, 200);
  assert.equal(first.json.state, 'verified');
  assert.equal(first.json.provider, 'stripe');
  assert.equal(first.json.billing_status, 'TRIALING');
  assert.equal(first.json.plan, 'essentials');
  // Stripe-side change only (no local write): the next read shows it.
  const session = mock.getSession(checkout.session_id);
  mock.failPayment(session.subscription);
  const second = await req(`/api/billing/status?business_id=${owner.business.id}`, { cookie: owner.cookie });
  assert.equal(second.json.billing_status, 'PAST_DUE');
  // And the local record was kept honest by the re-read.
  const sub = await pool.query('SELECT status FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(sub.rows[0].status, 'past_due');
});

test('status with no subscription is unavailable (never a fake success)', async () => {
  const owner = await ownerWithBusiness('status-none@example.com');
  const res = await req(`/api/billing/status?business_id=${owner.business.id}`, { cookie: owner.cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.state, 'unavailable');
  const stranger = await registerVerifiedUser('status-stranger@example.com');
  const forbidden = await req(`/api/billing/status?business_id=${owner.business.id}`, { cookie: stranger.cookie });
  assert.equal(forbidden.status, 403);
  const signedOut = await req(`/api/billing/status?business_id=${owner.business.id}`);
  assert.equal(signedOut.status, 401);
});

test('publisher-access is server-side yes/no and fails closed', async () => {
  const publisher = await registerVerifiedUser('cperezcarrillo.1990@gmail.com');
  const yes = await req('/api/billing/publisher-access', { cookie: publisher.cookie });
  assert.equal(yes.status, 200);
  assert.equal(yes.json.publisher, true);
  const customer = await registerVerifiedUser('just-a-customer@example.com');
  const no = await req('/api/billing/publisher-access', { cookie: customer.cookie });
  assert.equal(no.status, 200);
  assert.equal(no.json.publisher, false);
  const signedOut = await req('/api/billing/publisher-access');
  assert.equal(signedOut.status, 401);
});

test('evidence mapping: trial and paid grants, wrong price/currency/status refused', () => {
  const base = {
    id: 'sub_ev1',
    customer: 'cus_ev1',
    status: 'trialing',
    trial_end: Math.floor(Date.now() / 1000) + 7 * 86400,
    current_period_end: Math.floor(Date.now() / 1000) + 7 * 86400,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: process.env.STRIPE_TEST_PRICE_ESSENTIALS } }] },
    metadata: {},
  };
  const trial = evidenceFromSubscription({ subscription: base });
  assert.equal(trial.plan, 'essentials');
  assert.equal(trial.status, 'trialing');
  assert.ok(trial.trialEndsAt);
  const paid = evidenceFromSubscription({
    subscription: { ...base, status: 'active', trial_end: null, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 },
  });
  assert.equal(paid.status, 'active');
  // Unknown price id: refused.
  assert.throws(
    () => evidenceFromSubscription({ subscription: { ...base, items: { data: [{ price: { id: 'price_invented' } }] } } }),
    (error) => error.code === 'price_mismatch',
  );
  // Non-USD invoice: refused.
  assert.throws(
    () => evidenceFromSubscription({ subscription: base, invoice: { currency: 'eur', status: 'paid' } }),
    (error) => error.code === 'currency_mismatch',
  );
  // Incomplete subscription: refused (never grants).
  assert.throws(
    () => evidenceFromSubscription({ subscription: { ...base, status: 'incomplete' } }),
    (error) => error.code === 'subscription_not_grantable',
  );
  // No period end: refused (paid-through unverified).
  assert.throws(
    () => evidenceFromSubscription({ subscription: { ...base, current_period_end: null } }),
    (error) => error.code === 'subscription_paid_through_unverified',
  );
});

test('past-due payment update returns a setup-mode Checkout URL', async () => {
  const owner = await ownerWithBusiness('payment-update@example.com');
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  mock.failPayment(session.subscription);
  const res = await req('/api/billing/payment-update', {
    method: 'POST',
    body: { business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 200);
  assert.ok(String(res.json.url).startsWith('https://checkout.stripe.com/pay/'));
  assert.ok(res.json.session_id);
  const stranger = await registerVerifiedUser('payment-update-stranger@example.com');
  const forbidden = await req('/api/billing/payment-update', {
    method: 'POST',
    body: { business_id: owner.business.id },
    cookie: stranger.cookie,
  });
  assert.equal(forbidden.status, 403);
});
