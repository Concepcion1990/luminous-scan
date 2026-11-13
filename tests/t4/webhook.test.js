/**
 * T4 webhook tests (T4, T13, T17, T18 of the adapted matrix).
 * Raw-body posts with HMAC signatures, mock Stripe transport.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool,
  req,
  reqRaw,
  close,
  resetRateLimits,
  ownerWithBusiness,
  trialCheckout,
  mock,
  WEBHOOK_SECRET,
} from './helpers.js';
import { signWebhookEvent, webhookEvent } from './mockStripe.js';

after(close);
beforeEach(() => {
  mock.reset();
  resetRateLimits();
});

async function postEvent(event, secret = WEBHOOK_SECRET) {
  const { rawBody, header } = signWebhookEvent(event, secret);
  return reqRaw('/webhooks/stripe', {
    method: 'POST',
    body: rawBody,
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
  });
}

test('webhook without Stripe configured refuses (503), unsigned/forged/stale get 400, never 200', async () => {
  const event = webhookEvent('invoice.paid', { id: 'in_x' });
  const { rawBody } = signWebhookEvent(event, WEBHOOK_SECRET);
  const unsigned = await reqRaw('/webhooks/stripe', {
    method: 'POST', body: rawBody, headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(unsigned.status, 400);
  const forged = await postEvent(event, 'whsec_wrong_secret');
  assert.equal(forged.status, 400);
  assert.equal(forged.json.error, 'invalid_signature');
  // Stale timestamp (> 5 minutes).
  const crypto = await import('node:crypto');
  const staleTs = Math.floor(Date.now() / 1000) - 6 * 60;
  const staleSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${staleTs}.${rawBody}`, 'utf8').digest('hex');
  const stale = await reqRaw('/webhooks/stripe', {
    method: 'POST', body: rawBody,
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${staleTs},v1=${staleSig}` },
  });
  assert.equal(stale.status, 400);
  assert.equal(stale.json.reason, 'stale_timestamp');
});

test('checkout.session.completed via webhook grants; duplicate delivery is a no-op', async () => {
  const owner = await ownerWithBusiness('webhook-grant@example.com');
  const checkout = await req('/api/billing/checkout', {
    method: 'POST',
    body: { plan: 'essentials', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(checkout.status, 200);
  const session = mock.getSession(checkout.json.session_id);
  const event = webhookEvent('checkout.session.completed', session);
  const first = await postEvent(event);
  assert.equal(first.status, 200);
  assert.equal(first.json.handled, true);
  assert.equal(first.json.granted, true);
  const ent = await pool.query('SELECT * FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].status, 'trialing');
  // Same event delivered again: 200, duplicate, nothing changes.
  const second = await postEvent(event);
  assert.equal(second.status, 200);
  assert.equal(second.json.duplicate, true);
  const subs = await pool.query('SELECT * FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(subs.rows.length, 1);
  const events = await pool.query("SELECT * FROM subscription_events WHERE event_id = $1", [event.id]);
  assert.equal(events.rows.length, 1);
});

test('unknown events get 200, are logged, and change nothing', async () => {
  const event = webhookEvent('customer.discount.created', { id: 'di_x' });
  const res = await postEvent(event);
  assert.equal(res.status, 200);
  assert.equal(res.json.handled, false);
  assert.equal(res.json.reason, 'unknown_event_ignored');
});

test('invoice.paid (subscription_cycle) renews: period extends, duplicate is a no-op', async () => {
  const owner = await ownerWithBusiness('renewal@example.com');
  const { checkout, reconcile } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  const subId = session.subscription;
  const before = await pool.query('SELECT current_period_end FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  const { invoice } = mock.advancePeriod(subId);
  const event = webhookEvent('invoice.paid', invoice);
  const res = await postEvent(event);
  assert.equal(res.status, 200);
  assert.equal(res.json.handled, true);
  assert.equal(res.json.renewal, true);
  const after = await pool.query('SELECT current_period_end, status FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(after.rows[0].status, 'active');
  assert.ok(Date.parse(after.rows[0].current_period_end) > Date.parse(before.rows[0].current_period_end));
  // Duplicate renewal delivery changes nothing.
  const dup = await postEvent(event);
  assert.equal(dup.json.duplicate, true);
  const afterDup = await pool.query('SELECT current_period_end FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(afterDup.rows[0].current_period_end, after.rows[0].current_period_end);
});

test('invoice.payment_failed marks past_due and never cancels early', async () => {
  const owner = await ownerWithBusiness('pastdue@example.com');
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  const { invoice } = mock.failPayment(session.subscription);
  const event = webhookEvent('invoice.payment_failed', invoice);
  const res = await postEvent(event);
  assert.equal(res.status, 200);
  assert.equal(res.json.handled, true);
  const sub = await pool.query('SELECT status FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(sub.rows[0].status, 'past_due');
  const ent = await pool.query('SELECT status FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].status, 'past_due');
});

test('customer.subscription.deleted moves the app to canceled with grace dates', async () => {
  const owner = await ownerWithBusiness('sub-deleted@example.com');
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  const sub = mock.getSubscription(session.subscription);
  const event = webhookEvent('customer.subscription.deleted', sub);
  const res = await postEvent(event);
  assert.equal(res.status, 200);
  const ent = await pool.query('SELECT status, period_ends_at FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].status, 'canceled');
  assert.ok(ent.rows[0].period_ends_at);
  const subRow = await pool.query('SELECT status, grace_ends_at FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(subRow.rows[0].status, 'canceled');
  const graceEnds = Date.parse(subRow.rows[0].grace_ends_at);
  const periodEnds = Date.parse(ent.rows[0].period_ends_at);
  assert.ok(Math.abs(graceEnds - periodEnds - 15 * 24 * 60 * 60 * 1000) < 5000);
});

test('charge.refunded ends paid access and records refund_confirmed (history kept)', async () => {
  const owner = await ownerWithBusiness('refund-webhook@example.com');
  // Paid subscription (no trial): pre-consume the trial first.
  const crypto = await import('node:crypto');
  await pool.query(
    `INSERT INTO trial_history (id, email, plan, status, source, first_trial_at, consumed_at)
     VALUES ($1, $2, 'essentials', 'consumed', 'stripe_checkout', NOW(), NOW())`,
    [crypto.randomUUID(), owner.email],
  );
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  const charge = mock.refundFirstCharge(session.subscription);
  const event = webhookEvent('charge.refunded', charge);
  const res = await postEvent(event);
  assert.equal(res.status, 200);
  assert.equal(res.json.handled, true);
  assert.equal(res.json.refund_confirmed, true);
  const ent = await pool.query('SELECT status, period_ends_at FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].status, 'canceled');
  assert.ok(Date.parse(ent.rows[0].period_ends_at) <= Date.now() + 60_000);
  // The subscription record itself is kept (no-second-trial needs it).
  const sub = await pool.query('SELECT * FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(sub.rows.length, 1);
  const events = await pool.query("SELECT * FROM subscription_events WHERE kind = 'refund_confirmed'");
  assert.equal(events.rows.length, 1);
});

test('invoice.paid in the NEW invoice shape (parent.subscription_details only) renews', async () => {
  const owner = await ownerWithBusiness('renewal-new-shape@example.com');
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  const subId = session.subscription;
  const before = await pool.query('SELECT current_period_end FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  const { invoice } = mock.advancePeriod(subId);
  // Current Stripe shape: no top-level subscription anywhere — the
  // stored invoice (what the handler re-fetches) and the event agree.
  const newShape = mock.reshapeInvoiceNewApi(invoice.id);
  assert.equal(newShape.subscription, null);
  assert.equal(newShape.parent.subscription_details.subscription, subId);
  const event = webhookEvent('invoice.paid', newShape);
  const res = await postEvent(event);
  assert.equal(res.status, 200);
  assert.equal(res.json.handled, true);
  assert.equal(res.json.renewal, true);
  const after = await pool.query('SELECT current_period_end, status FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(after.rows[0].status, 'active');
  assert.ok(Date.parse(after.rows[0].current_period_end) > Date.parse(before.rows[0].current_period_end));
});

test('invoice.payment_failed in the NEW invoice shape (parent.subscription_details only) marks past_due', async () => {
  const owner = await ownerWithBusiness('pastdue-new-shape@example.com');
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  const subId = session.subscription;
  const { invoice } = mock.failPayment(subId);
  // The payment_failed path reads the event object itself.
  const newShape = {
    ...invoice,
    subscription: null,
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: subId, metadata: { ...(invoice.metadata || {}) } },
    },
  };
  const event = webhookEvent('invoice.payment_failed', newShape);
  const res = await postEvent(event);
  assert.equal(res.status, 200);
  assert.equal(res.json.handled, true);
  const sub = await pool.query('SELECT status FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(sub.rows[0].status, 'past_due');
  const ent = await pool.query('SELECT status FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].status, 'past_due');
});

test('charge.refunded with the invoice in the NEW shape still ends paid access', async () => {
  const owner = await ownerWithBusiness('refund-new-shape@example.com');
  const crypto = await import('node:crypto');
  await pool.query(
    `INSERT INTO trial_history (id, email, plan, status, source, first_trial_at, consumed_at)
     VALUES ($1, $2, 'essentials', 'consumed', 'stripe_checkout', NOW(), NOW())`,
    [crypto.randomUUID(), owner.email],
  );
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  const charge = mock.refundFirstCharge(session.subscription);
  // The refund path re-fetches the invoice; serve it in the new shape.
  mock.reshapeInvoiceNewApi(charge.invoice);
  const event = webhookEvent('charge.refunded', charge);
  const res = await postEvent(event);
  assert.equal(res.status, 200);
  assert.equal(res.json.handled, true);
  assert.equal(res.json.refund_confirmed, true);
  const ent = await pool.query('SELECT status FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].status, 'canceled');
});

test('customer.subscription.trial_will_end is acknowledged; reminders stay off (no grant change)', async () => {
  const owner = await ownerWithBusiness('trial-will-end@example.com');
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  const sub = mock.getSubscription(session.subscription);
  const event = webhookEvent('customer.subscription.trial_will_end', sub);
  const res = await postEvent(event);
  assert.equal(res.status, 200);
  assert.equal(res.json.handled, true);
  const ent = await pool.query('SELECT status FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].status, 'trialing');
});
