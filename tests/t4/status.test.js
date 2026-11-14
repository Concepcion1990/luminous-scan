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
import { evidenceFromSubscription, subscriptionPeriodEndsAt } from '../../server/stripeEvidence.js';

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
  const now = Math.floor(Date.now() / 1000);
  const priceId = process.env.STRIPE_TEST_PRICE_ESSENTIALS;
  // Current Stripe shape (API 2026-10-28.endive): period dates live
  // on the subscription item; there is NO top-level period end.
  const base = {
    id: 'sub_ev1',
    customer: 'cus_ev1',
    status: 'trialing',
    trial_end: now + 7 * 86400,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: priceId }, current_period_start: now, current_period_end: now + 7 * 86400 }] },
    metadata: {},
  };
  const trial = evidenceFromSubscription({ subscription: base });
  assert.equal(trial.plan, 'essentials');
  assert.equal(trial.status, 'trialing');
  assert.ok(trial.trialEndsAt);
  const paid = evidenceFromSubscription({
    subscription: {
      ...base,
      status: 'active',
      trial_end: null,
      items: { data: [{ price: { id: priceId }, current_period_start: now, current_period_end: now + 30 * 86400 }] },
    },
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
  // No period end anywhere: refused (paid-through unverified).
  assert.throws(
    () => evidenceFromSubscription({
      subscription: { ...base, items: { data: [{ price: { id: priceId }, current_period_end: null }] } },
    }),
    (error) => error.code === 'subscription_paid_through_unverified',
  );
});

test('endive shape: the paid-through date is sourced from the subscription item', () => {
  // Regression pin for the Nov 14, 2026 production failure: a real
  // checkout completed, but evidenceFromSubscription threw
  // subscription_paid_through_unverified because API
  // 2026-10-28.endive subscriptions carry current_period_end ONLY
  // on items.data[0] — exactly the shape of the live subscription
  // (trialing, period end == trial_end, both on the item).
  const now = Math.floor(Date.now() / 1000);
  const priceId = process.env.STRIPE_TEST_PRICE_ESSENTIALS;
  const endiveSub = {
    id: 'sub_endive',
    customer: 'cus_endive',
    status: 'trialing',
    trial_end: now + 7 * 86400,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: priceId }, current_period_start: now, current_period_end: now + 7 * 86400 }] },
    metadata: {},
  };
  assert.equal(subscriptionPeriodEndsAt(endiveSub), new Date((now + 7 * 86400) * 1000).toISOString());
  const evidence = evidenceFromSubscription({ subscription: endiveSub });
  assert.equal(evidence.status, 'trialing');
  assert.equal(evidence.periodEndsAt, new Date((now + 7 * 86400) * 1000).toISOString());
  assert.equal(evidence.trialEndsAt, evidence.periodEndsAt);
  // Older shapes keep working: a top-level period end still wins.
  const legacySub = { ...endiveSub, current_period_end: now + 30 * 86400 };
  assert.equal(subscriptionPeriodEndsAt(legacySub), new Date((now + 30 * 86400) * 1000).toISOString());
  assert.equal(evidenceFromSubscription({ subscription: legacySub }).periodEndsAt, new Date((now + 30 * 86400) * 1000).toISOString());
  // No period end on either level: no date, and the grant refuses.
  assert.equal(subscriptionPeriodEndsAt({ items: { data: [{ price: { id: priceId } }] } }), null);
  assert.equal(subscriptionPeriodEndsAt(null), null);
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
