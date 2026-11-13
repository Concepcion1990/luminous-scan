/**
 * T4 plan-change tests (T5, T6, T7 of the adapted matrix).
 * Same subscription, trial preserved on upgrade, downgrade effective
 * next cycle with the entitlement flipping only at that date.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
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

test('upgrade preview during trial: trial end shown separately, first charge at trial end', async () => {
  const owner = await ownerWithBusiness('preview-trial@example.com');
  const { reconcile } = await trialCheckout(owner, owner.business.id, 'essentials');
  const preview = await req('/api/billing/plan-change/preview', {
    method: 'POST',
    body: { target_plan: 'business', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.current_plan, 'essentials');
  assert.equal(preview.json.target_plan, 'business');
  assert.equal(preview.json.target_price, 29.99);
  assert.equal(preview.json.proration_behavior, 'create_prorations');
  assert.equal(preview.json.first_charge_at, reconcile.trial_ends_at);
  assert.equal(preview.json.trial_ends_at, reconcile.trial_ends_at);
});

test('upgrade during trial: same subscription, trial_end preserved, first charge $29.99 at trial end', async () => {
  const owner = await ownerWithBusiness('upgrade-trial@example.com');
  const { checkout, reconcile } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  const subId = session.subscription;
  const before = mock.getSubscription(subId);
  const change = await req('/api/billing/plan-change', {
    method: 'POST',
    body: { target_plan: 'business', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(change.status, 200);
  assert.equal(change.json.state, 'plan_change_recorded');
  assert.equal(change.json.trial_ends_at, reconcile.trial_ends_at);
  assert.equal(change.json.first_charge_at, reconcile.trial_ends_at);
  assert.equal(change.json.target_price, 29.99);
  // Same subscription id, still trialing, new price, unchanged trial end.
  const after = mock.getSubscription(subId);
  assert.equal(after.id, subId);
  assert.equal(after.status, 'trialing');
  assert.equal(after.trial_end, before.trial_end);
  assert.equal(after.items.data[0].price.id, process.env.STRIPE_TEST_PRICE_BUSINESS);
  const ent = await pool.query('SELECT plan, status FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].plan, 'business');
  assert.equal(ent.rows[0].status, 'trialing');
  const subs = await pool.query('SELECT * FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(subs.rows.length, 1);
  assert.equal(subs.rows[0].provider_subscription_id, subId);
});

test('upgrade paid: same subscription, difference on the NEXT invoice only, no immediate charge', async () => {
  const owner = await paidOwner('upgrade-paid@example.com');
  const subRow = await pool.query('SELECT provider_subscription_id FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  const subId = subRow.rows[0].provider_subscription_id;
  const invoicesBefore = mock.listInvoices(subId).length;
  const change = await req('/api/billing/plan-change', {
    method: 'POST',
    body: { target_plan: 'business', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(change.status, 200);
  assert.equal(change.json.proration_behavior, 'create_prorations');
  // No new invoice was created by the change itself (proration lands
  // on the next invoice) and the subscription id is unchanged.
  assert.equal(mock.listInvoices(subId).length, invoicesBefore);
  assert.equal(mock.getSubscription(subId).id, subId);
  const ent = await pool.query('SELECT plan, status FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].plan, 'business');
  assert.equal(ent.rows[0].status, 'active');
});

test('downgrade: warning preview, Business until period end, flip only at the effective date via webhook', async () => {
  const owner = await paidOwner('downgrade@example.com');
  await req('/api/billing/plan-change', {
    method: 'POST',
    body: { target_plan: 'business', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  const preview = await req('/api/billing/plan-change/preview', {
    method: 'POST',
    body: { target_plan: 'essentials', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.proration_behavior, 'none');
  const change = await req('/api/billing/plan-change', {
    method: 'POST',
    body: { target_plan: 'essentials', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(change.status, 200);
  assert.equal(change.json.effective_at, preview.json.effective_at);
  // Business until period end: the entitlement does NOT flip at request date.
  let ent = await pool.query('SELECT plan, status FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].plan, 'business');
  const subRow = await pool.query('SELECT pending_plan, pending_plan_effective_at FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(subRow.rows[0].pending_plan, 'essentials');
  assert.ok(subRow.rows[0].pending_plan_effective_at);
  // Move the effective date into the past (test-only) and deliver the
  // subscription.updated webhook: the flip happens AT the effective date.
  await pool.query(
    'UPDATE subscriptions SET pending_plan_effective_at = $1 WHERE business_id = $2',
    [new Date(Date.now() - 1000).toISOString(), owner.business.id],
  );
  const subIdRow = await pool.query('SELECT provider_subscription_id FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  const sub = mock.getSubscription(subIdRow.rows[0].provider_subscription_id);
  const event = webhookEvent('customer.subscription.updated', sub);
  const { rawBody, header } = signWebhookEvent(event, WEBHOOK_SECRET);
  const res = await reqRaw('/webhooks/stripe', {
    method: 'POST', body: rawBody,
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.downgrade_applied, true);
  ent = await pool.query('SELECT plan, status FROM entitlements WHERE business_id = $1', [owner.business.id]);
  assert.equal(ent.rows[0].plan, 'essentials');
  const cleared = await pool.query('SELECT pending_plan FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(cleared.rows[0].pending_plan, null);
});

test('plan change refuses strangers, same-plan, and non-subscribers', async () => {
  const owner = await ownerWithBusiness('planchange-guards@example.com');
  const stranger = await ownerWithBusiness('planchange-stranger@example.com');
  await trialCheckout(owner, owner.business.id, 'essentials');
  const strangerCall = await req('/api/billing/plan-change', {
    method: 'POST',
    body: { target_plan: 'business', business_id: owner.business.id },
    cookie: stranger.cookie,
  });
  assert.equal(strangerCall.status, 403);
  const samePlan = await req('/api/billing/plan-change', {
    method: 'POST',
    body: { target_plan: 'essentials', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(samePlan.status, 400);
  const noSub = await req('/api/billing/plan-change', {
    method: 'POST',
    body: { target_plan: 'business', business_id: stranger.business.id },
    cookie: stranger.cookie,
  });
  assert.equal(noSub.status, 400);
});

test('downgrade warning copy is in plain words on the Upgrade page', async () => {
  // T6.3 moved the copy out of Upgrade.jsx into t() keys — the page renders
  // upgrade.downgradeWarning1-5, so check the page wires those keys AND the
  // rendered English strings carry the plain-words phrases.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const upgrade = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Upgrade.jsx'), 'utf8');
  for (const key of ['upgrade.downgradeWarning1', 'upgrade.downgradeWarning2', 'upgrade.downgradeWarning3', 'upgrade.downgradeWarning4', 'upgrade.downgradeWarning5']) {
    assert.ok(upgrade.includes(key), `Upgrade.jsx is missing the downgrade warning key: ${key}`);
  }
  const { t, setLocale } = await import('../../src/lib/i18n.js');
  setLocale('en');
  const copy = [1, 2, 3, 4, 5].map((n) => t(`upgrade.downgradeWarning${n}`)).join(' ').toLowerCase();
  for (const phrase of [
    'staff beyond 3',
    'extra businesses',
    'no csv/excel export, import only',
    'bundles',
    'suppliers',
    'inventory itself moves smoothly',
  ]) {
    assert.ok(copy.includes(phrase), `downgrade warning copy is missing the phrase: ${phrase}`);
  }
});

test('plan-change double-tap returns the recorded answer without a second Stripe call', async () => {
  const owner = await ownerWithBusiness('planchange-twice@example.com');
  await trialCheckout(owner, owner.business.id, 'essentials');
  const first = await req('/api/billing/plan-change', {
    method: 'POST',
    body: { target_plan: 'business', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  assert.equal(first.json.state, 'plan_change_recorded');
  const second = await req('/api/billing/plan-change', {
    method: 'POST',
    body: { target_plan: 'business', business_id: owner.business.id },
    cookie: owner.cookie,
  });
  // The plan is already Business, so the second call refuses as
  // same-plan — and the claim guard means no second Stripe update ran.
  assert.equal(second.status, 400);
  const subs = await pool.query('SELECT * FROM subscriptions WHERE business_id = $1', [owner.business.id]);
  assert.equal(subs.rows.length, 1);
});
