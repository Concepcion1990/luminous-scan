/**
 * T36 — the founding-tester comp (owner's rulings, Nov 21, 2026).
 *
 * The operator-only list; a listed signup is born on Business
 * with the founding_tester mark and never touches Stripe; the
 * checkout backstop comps a workspace created before listing;
 * unlisted signups are completely unchanged; every billing door
 * refuses a comped workspace without creating anything; trial
 * reminders skip comped workspaces; and the comp entry ends when
 * the account is wiped.
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
  createBusiness,
  trialCheckout,
  mock,
  mailbox,
  OPERATOR_EMAIL,
  insertCompEntry,
  compEntry,
  entitlementOf,
  countRows,
} from './helpers.js';
import { runTrialReminderSweep } from '../../server/trialReminders.js';

after(close);
beforeEach(() => {
  mock.reset();
  resetRateLimits();
  mailbox.length = 0;
});

const silent = { log() {} };

test('operator doors refuse everyone but the operator', async () => {
  const owner = await registerVerifiedUser('comp-boss@example.com');
  const signedOut = await req('/api/operator/founding-testers');
  assert.equal(signedOut.status, 401);
  for (const attempt of [
    () => req('/api/operator/founding-testers', { cookie: owner.cookie }),
    () => req('/api/operator/founding-testers', { method: 'POST', body: { email: 'x@example.com' }, cookie: owner.cookie }),
    () => req('/api/operator/founding-testers/some-id', { method: 'DELETE', cookie: owner.cookie }),
    () => req('/api/operator/founding-testers/config', { method: 'PUT', body: { cap: 12 }, cookie: owner.cookie }),
  ]) {
    const res = await attempt();
    assert.equal(res.status, 403, res.text);
    assert.equal(res.json.error, 'forbidden');
  }
  // Nothing leaked and nothing was added by the refused attempts.
  const { rows } = await pool.query('SELECT * FROM founding_tester_comp');
  assert.equal(rows.length, 0);
});

test('operator adds, lists, ends; duplicates, bad emails and the cap refuse', async () => {
  const operator = await registerVerifiedUser(OPERATOR_EMAIL);
  const list0 = await req('/api/operator/founding-testers', { cookie: operator.cookie });
  assert.equal(list0.status, 200);
  assert.equal(list0.json.cap, 10);
  assert.equal(list0.json.active_count, 0);

  const bad = await req('/api/operator/founding-testers', {
    method: 'POST', body: { email: 'not-an-email' }, cookie: operator.cookie,
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.message, 'Enter a valid email address.');

  const added = await req('/api/operator/founding-testers', {
    method: 'POST',
    body: { email: 'Tester@Example.com', note: 'Bakery — English group' },
    cookie: operator.cookie,
  });
  assert.equal(added.status, 201, added.text);
  assert.equal(added.json.email, 'tester@example.com');
  assert.equal(added.json.status, 'active');

  const dup = await req('/api/operator/founding-testers', {
    method: 'POST', body: { email: 'tester@example.com' }, cookie: operator.cookie,
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, 'comp_already_listed');

  // Cap: shrink to 1 (one active entry) and the next add refuses.
  const cap1 = await req('/api/operator/founding-testers/config', {
    method: 'PUT', body: { cap: 1 }, cookie: operator.cookie,
  });
  assert.equal(cap1.status, 200);
  assert.equal(cap1.json.cap, 1);
  const full = await req('/api/operator/founding-testers', {
    method: 'POST', body: { email: 'second@example.com' }, cookie: operator.cookie,
  });
  assert.equal(full.status, 409);
  assert.equal(full.json.error, 'comp_list_full');
  const badCap = await req('/api/operator/founding-testers/config', {
    method: 'PUT', body: { cap: 0 }, cookie: operator.cookie,
  });
  assert.equal(badCap.status, 400);
  await req('/api/operator/founding-testers/config', {
    method: 'PUT', body: { cap: 10 }, cookie: operator.cookie,
  });

  // Ending frees the seat and never touches a workspace.
  const ended = await req(`/api/operator/founding-testers/${added.json.id}`, {
    method: 'DELETE', cookie: operator.cookie,
  });
  assert.equal(ended.status, 200);
  assert.equal(ended.json.status, 'ended');
  assert.ok(ended.json.ended_at);
  const again = await req(`/api/operator/founding-testers/${added.json.id}`, {
    method: 'DELETE', cookie: operator.cookie,
  });
  assert.equal(again.status, 404);
  assert.equal(again.json.error, 'comp_not_listed');
});

test('a listed signup is born comped: Business, no Stripe, no trial rows', async () => {
  await insertCompEntry('born-comped@example.com', 'Bookstore — Spanish group');
  const owner = await registerVerifiedUser('born-comped@example.com');
  const business = await createBusiness(owner.cookie, 'Comped Books');

  const ent = await entitlementOf(business.id);
  assert.ok(ent, 'an entitlement row exists from birth');
  assert.equal(ent.plan, 'business');
  assert.equal(ent.status, 'founding_tester');
  assert.equal(ent.trial_ends_at, null);
  assert.equal(await countRows('subscriptions', business.id), 0);
  assert.equal(await countRows('purchases', business.id), 0);
  const entry = await compEntry('born-comped@example.com');
  assert.ok(entry.claimed_at, 'the entry is stamped claimed');

  // Full access through the server's own access assessment.
  const { subscriptionAccessFor } = await import('../../server/subscriptionAccess.js');
  const verdict = await subscriptionAccessFor(pool, owner.user, business.id);
  assert.equal(verdict.state, 'full');
  assert.equal(verdict.plan, 'business');
  assert.equal(verdict.status, 'founding_tester');

  // The Subscribe → Business door answers comped, never a URL.
  const checkout = await req('/api/billing/checkout', {
    method: 'POST', body: { plan: 'business', business_id: business.id }, cookie: owner.cookie,
  });
  assert.equal(checkout.status, 200);
  assert.equal(checkout.json.comped, true);
  assert.equal(checkout.json.already, true);
  assert.equal(checkout.json.url, undefined);
  assert.equal(mock.getLastCheckoutParams(), null, 'Stripe was never asked for a session');
});

test('checkout backstop: a workspace created before listing comps at the Business door', async () => {
  const owner = await ownerWithBusiness('late-listed@example.com');
  assert.equal(await entitlementOf(owner.business.id), null);
  await insertCompEntry('late-listed@example.com');
  const checkout = await req('/api/billing/checkout', {
    method: 'POST', body: { plan: 'business', business_id: owner.business.id }, cookie: owner.cookie,
  });
  assert.equal(checkout.status, 200, checkout.text);
  assert.equal(checkout.json.comped, true);
  assert.notEqual(checkout.json.already, true);
  const ent = await entitlementOf(owner.business.id);
  assert.equal(ent.status, 'founding_tester');
  assert.equal(ent.plan, 'business');
  assert.equal(mock.getLastCheckoutParams(), null);
  assert.equal(await countRows('subscriptions', owner.business.id), 0);
});

test('an unlisted signup follows the ordinary trial path, unchanged', async () => {
  const owner = await ownerWithBusiness('ordinary@example.com');
  const checkout = await req('/api/billing/checkout', {
    method: 'POST', body: { plan: 'business', business_id: owner.business.id }, cookie: owner.cookie,
  });
  assert.equal(checkout.status, 200);
  assert.ok(String(checkout.json.url).startsWith('https://checkout.stripe.com/pay/'));
  assert.ok(mock.getLastCheckoutParams(), 'Stripe was asked for a session');
});

test('every billing door refuses a comped workspace and creates nothing', async () => {
  await insertCompEntry('doors-comped@example.com');
  const owner = await registerVerifiedUser('doors-comped@example.com');
  const business = await createBusiness(owner.cookie, 'Comped Doors');
  for (const [path, body] of [
    ['/api/billing/cancel', { business_id: business.id }],
    ['/api/billing/plan-change', { business_id: business.id, target_plan: 'essentials' }],
    ['/api/billing/plan-change/preview', { business_id: business.id, target_plan: 'essentials' }],
    ['/api/billing/payment-update', { business_id: business.id }],
  ]) {
    const res = await req(path, { method: 'POST', body, cookie: owner.cookie });
    assert.equal(res.status, 400, `${path}: ${res.text}`);
    assert.equal(res.json.error, 'no_verified_subscription_record', path);
  }
  const ent = await entitlementOf(business.id);
  assert.equal(ent.status, 'founding_tester', 'the comp mark is untouched');
  assert.equal(await countRows('subscriptions', business.id), 0);
});

test('trial reminders skip a comped workspace entirely', async () => {
  const NOW = new Date('2026-11-21T12:00:00.000Z');
  const trialEnd = new Date(NOW.getTime() + 72 * 60 * 60 * 1000).toISOString();
  // Control: an ordinary trialing workspace DOES get the day-4 email.
  const control = await ownerWithBusiness('control-trial@example.com');
  await insertTrialSubscription(control, trialEnd);
  // Comped: born comped, plus an artificial trialing subscription
  // row (the state that must never produce an email).
  await insertCompEntry('skip-reminder@example.com');
  const compedOwner = await registerVerifiedUser('skip-reminder@example.com');
  const compedBusiness = await createBusiness(compedOwner.cookie, 'Comped Quiet');
  await insertTrialSubscription({ business: compedBusiness, user: compedOwner.user }, trialEnd);

  await runTrialReminderSweep(pool, { now: NOW, logger: silent });
  const controlMail = mailbox.filter((m) => m.to === 'control-trial@example.com' && m.subject.includes('Day 4'));
  assert.equal(controlMail.length, 1, 'the control trial got its day-4 email');
  const compedMail = mailbox.filter((m) => m.to === 'skip-reminder@example.com' && m.subject.includes('trial'));
  assert.equal(compedMail.length, 0, 'the comped workspace got NO trial email');
});

async function insertTrialSubscription(owner, trialEndsAt) {
  const id = (await import('node:crypto')).randomUUID();
  await pool.query(
    `INSERT INTO subscriptions
       (id, business_id, owner_id, provider_subscription_id, provider_customer_id,
        plan, status, trial_ends_at, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, 'essentials', 'trialing', $6, false)`,
    [id, owner.business.id, owner.user.id, `sub_test_${id.slice(0, 8)}`, `cus_test_${id.slice(0, 8)}`, trialEndsAt],
  );
}

test('deleting the account (wipe sweep) ends the comp entry', async () => {
  // The owner was listed but their only workspace went the ordinary
  // road (created before the entry existed, Essentials trial,
  // canceled, grace long past) — the sweep wipes the account, and
  // the comp entry ends with it.
  const owner = await ownerWithBusiness('wipe-comp@example.com');
  await trialCheckout(owner, owner.business.id, 'essentials');
  const cancel = await req('/api/billing/cancel', {
    method: 'POST', body: { business_id: owner.business.id }, cookie: owner.cookie,
  });
  assert.equal(cancel.status, 200, cancel.text);
  await insertCompEntry('wipe-comp@example.com');
  const pastPeriodEnd = new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString();
  const pastGraceEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await pool.query('UPDATE entitlements SET period_ends_at = $1 WHERE business_id = $2', [pastPeriodEnd, owner.business.id]);
  await pool.query('UPDATE subscriptions SET grace_ends_at = $1, current_period_end = $2 WHERE business_id = $3', [pastGraceEnd, pastPeriodEnd, owner.business.id]);
  const { runWipeSweep } = await import('../../server/billing.js');
  const summary = await runWipeSweep(pool, { logger: silent });
  assert.equal(summary.wiped.length, 1);
  const entry = await compEntry('wipe-comp@example.com');
  assert.equal(entry.status, 'ended');
  assert.ok(entry.ended_at);
});
