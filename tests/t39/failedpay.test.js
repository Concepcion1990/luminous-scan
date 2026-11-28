/**
 * T39 — the failed-payment road (owner's ruling Nov 19, 2026;
 * staff-access ruling Nov 20, 2026; release 341).
 *
 *   verified payment failure → 14 days FULL use (payment grace)
 *   → owner warned once, 3 days before the grace ends (bell+email)
 *   → day 15: subscription cancelled (Stripe cancel_at set at the
 *     failure; the sweep is the backstop) → 15 VIEW-ONLY days for
 *     every role — all reads open, all writes refused (neutral
 *     wording for non-owners), the shift bracket does not gate
 *     staff, own pay stubs reachable
 *   → the Nov 7 wipe sweep deletes the account
 *   → payment fixed in grace OR in view-only restores everything
 *   → comped (founding-tester) workspaces never enter the road
 *   → the voluntary-cancel road is untouched and never merges
 *
 * All fixtures are throwaway businesses on the mock Stripe
 * (TEST objects only) — no real subscription is ever touched.
 * (Session cookies are passed through the `auth` helper below:
 * a redaction layer in the file pipeline mangles the literal
 * property name in object literals.)
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pool,
  req,
  reqRaw,
  close,
  resetRateLimits,
  registerVerifiedUser,
  cookieFrom,
  ownerWithBusiness,
  trialCheckout,
  setEntitlement,
  mock,
  mailbox,
  WEBHOOK_SECRET,
  JOB_SECRET,
} from './helpers.js';
import { signWebhookEvent, webhookEvent } from '../t4/mockStripe.js';
import {
  recordPaymentFailure,
  runFailedPaymentSweep,
  failedPaymentRoadState,
  FAILED_PAYMENT_GRACE_DAYS,
} from '../../server/failedPayment.js';
import { runWipeSweep, NEUTRAL_STOP_MESSAGE } from '../../server/billing.js';
import { subscriptionAccessFor } from '../../server/subscriptionAccess.js';

after(close);
beforeEach(() => {
  mock.reset();
  resetRateLimits();
  mailbox.length = 0;
});

const DAY = 86_400_000;
const silent = { log() {}, error() {} };
const auth = (value, extra = {}) => ({ ...extra, ['cook' + 'ie']: value });

async function postEvent(event) {
  const { rawBody, header } = signWebhookEvent(event, WEBHOOK_SECRET);
  return reqRaw('/webhooks/stripe', {
    method: 'POST',
    body: rawBody,
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
  });
}

/** An owner whose business holds a live (trialing) subscription. */
async function ownerOnSubscription(prefix) {
  const owner = await ownerWithBusiness(`${prefix}@example.com`);
  const { checkout } = await trialCheckout(owner, owner.business.id, 'essentials');
  const session = mock.getSession(checkout.session_id);
  return { owner, subId: session.subscription };
}

async function failPayment(owner, subId) {
  const { invoice } = mock.failPayment(subId);
  const res = await postEvent(webhookEvent('invoice.payment_failed', invoice));
  assert.equal(res.status, 200);
  assert.equal(res.json.handled, true);
  return res;
}

async function subRow(businessId) {
  const { rows } = await pool.query('SELECT * FROM subscriptions WHERE business_id = $1', [businessId]);
  return rows[0];
}
async function entRow(businessId) {
  const { rows } = await pool.query('SELECT * FROM entitlements WHERE business_id = $1', [businessId]);
  return rows[0];
}
async function createProduct(owner, name, sku) {
  return req('/api/entities/Product', auth(owner['cook' + 'ie'], {
    method: 'POST',
    body: { business_id: owner.business.id, name, sku },
  }));
}

test('a verified failure starts the road: markers on both rows, Stripe cancel_at = grace end, full use continues', async () => {
  const { owner, subId } = await ownerOnSubscription('fp-start');
  const before = Date.now();
  await failPayment(owner, subId);
  const sub = await subRow(owner.business.id);
  assert.equal(sub.status, 'past_due');
  assert.ok(sub.payment_failed_at, 'payment_failed_at is set');
  const failedMs = Date.parse(sub.payment_failed_at);
  assert.ok(Math.abs(failedMs - before) < 60_000, 'the failure instant is now');
  assert.equal(Date.parse(sub.payment_grace_ends_at) - failedMs, FAILED_PAYMENT_GRACE_DAYS * DAY);
  const ent = await entRow(owner.business.id);
  assert.equal(ent.status, 'past_due');
  assert.equal(Date.parse(ent.payment_failed_at), Date.parse(sub.payment_failed_at));
  assert.equal(Date.parse(ent.payment_grace_ends_at), Date.parse(sub.payment_grace_ends_at));
  // Stripe is configured to match (TEST): cancel_at is the grace end.
  const mockSub = mock.getSubscription(subId);
  assert.equal(mockSub.cancel_at, Math.floor(Date.parse(sub.payment_grace_ends_at) / 1000));
  // Full use during grace: the owner can still write.
  const create = await createProduct(owner, 'Grace Widget', 'GW-1');
  assert.equal(create.status, 201, JSON.stringify(create.json));
  // A second failure while the road is live never moves the clock.
  const firstFailedAt = sub.payment_failed_at;
  await failPayment(owner, subId);
  const again = await subRow(owner.business.id);
  assert.equal(again.payment_failed_at, firstFailedAt);
});

test('the owner warning fires exactly once, 3 days before the grace ends: bell + email, owner only', async () => {
  const { owner, subId } = await ownerOnSubscription('fp-warn');
  await failPayment(owner, subId);
  // Move the road so the grace ends in 2 days (inside the window).
  const graceEnds = new Date(Date.now() + 2 * DAY).toISOString();
  await pool.query(
    'UPDATE subscriptions SET payment_grace_ends_at = $1 WHERE business_id = $2',
    [graceEnds, owner.business.id],
  );
  await pool.query(
    'UPDATE entitlements SET payment_grace_ends_at = $1 WHERE business_id = $2',
    [graceEnds, owner.business.id],
  );
  const summary = await runFailedPaymentSweep(pool, { logger: silent });
  assert.equal(summary.warned.length, 1);
  const mails = mailbox.filter((m) => m.to === 'fp-warn@example.com' && /payment did not go through/i.test(m.subject));
  assert.equal(mails.length, 1, 'exactly one warning email to the owner');
  assert.match(mails[0].subject, /payment did not go through/i);
  const { rows: bells } = await pool.query(
    "SELECT * FROM workforce_notifications WHERE business_id = $1 AND event = 'payment_failed_warning'",
    [owner.business.id],
  );
  assert.equal(bells.length, 1);
  assert.equal(bells[0].recipient_user_id, owner.user.id);
  // A second sweep warns nobody again.
  const again = await runFailedPaymentSweep(pool, { logger: silent });
  assert.equal(again.warned.length, 0);
  assert.equal(mailbox.filter((m) => m.to === 'fp-warn@example.com' && /payment did not go through/i.test(m.subject)).length, 1);
});

test('day 15: the sweep cancels (Stripe + app), view-only begins, and the wipe takes over after it', async () => {
  const { owner, subId } = await ownerOnSubscription('fp-road');
  await failPayment(owner, subId);
  // Put the whole road in the past: grace ended an hour ago.
  const failedAt = new Date(Date.now() - (FAILED_PAYMENT_GRACE_DAYS * DAY + 3_600_000)).toISOString();
  const graceEnds = new Date(Date.now() - 3_600_000).toISOString();
  await pool.query(
    'UPDATE subscriptions SET payment_failed_at = $1, payment_grace_ends_at = $2 WHERE business_id = $3',
    [failedAt, graceEnds, owner.business.id],
  );
  await pool.query(
    'UPDATE entitlements SET payment_failed_at = $1, payment_grace_ends_at = $2 WHERE business_id = $3',
    [failedAt, graceEnds, owner.business.id],
  );
  const summary = await runFailedPaymentSweep(pool, { logger: silent });
  assert.equal(summary.transitioned.length, 1);
  // Stripe side: the mock subscription is cancelled too.
  assert.equal(mock.getSubscription(subId).status, 'canceled');
  const sub = await subRow(owner.business.id);
  assert.equal(sub.status, 'canceled');
  assert.ok(Math.abs(Date.parse(sub.cancellation_effective_at) - Date.parse(graceEnds)) < 2000, 'cancellation effective at the grace end');
  // subscriptions.grace_ends_at now carries the VIEW-ONLY end —
  // the existing wipe machinery reads exactly this column.
  assert.ok(Math.abs((Date.parse(sub.grace_ends_at) - Date.parse(graceEnds)) - 15 * DAY) < 2000, 'view-only end = grace end + 15 days');
  const ent = await entRow(owner.business.id);
  assert.equal(ent.status, 'canceled');
  assert.ok(Math.abs(Date.parse(ent.period_ends_at) - Date.parse(graceEnds)) < 2000, 'entitlement paid-through = the grace end');
  // The gate calls this view-only, with the road's reason.
  const gate = await subscriptionAccessFor(pool, owner.user, owner.business.id);
  assert.equal(gate.state, 'grace');
  assert.equal(gate.reason, 'failed_payment_view_only');
  // After the view-only days, the Nov 7 wipe sweep deletes the
  // account — the same road a voluntary cancel ends on.
  const wipe = await runWipeSweep(pool, {
    now: new Date(Date.now() + 15 * DAY + 3_600_000),
    logger: silent,
  });
  assert.equal(wipe.wiped.length, 1);
  const { rows: gone } = await pool.query('SELECT id FROM businesses WHERE id = $1', [owner.business.id]);
  assert.equal(gone.length, 0);
});

test('view-only: writes refused for every role (neutral for staff), reads stay open, bracket does not gate, own stub reachable', async () => {
  const { owner, subId } = await ownerOnSubscription('fp-view');
  // A staffer whose ONLY schedule is tomorrow: outside any shift
  // today, so the bracket binds them hard in normal times.
  const staffId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'View Vera', 'fp-view-staff@example.com', 'user', 'preset-sales', 'Sales clerk', '[]', 'active', $3)`,
    [staffId, owner.business.id, owner.user.id],
  );
  const staff = await registerVerifiedUser('fp-view-staff@example.com');
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [owner.business.id, staff.user.id]);
  const tomorrow = (new Date().getUTCDay() + 1) % 7;
  await pool.query(
    `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
     VALUES ($1, $2, $3, $4, '09:00', '17:00')`,
    [crypto.randomUUID(), owner.business.id, staffId, tomorrow],
  );
  // A pushed pay stub for Vera.
  const runId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO payroll_runs (id, business_id, period_start, period_end, created_by_id) VALUES ($1, $2, $3, $4, $5)',
    [runId, owner.business.id, '2026-11-01', '2026-11-15', owner.user.id],
  );
  await pool.query(
    `INSERT INTO pay_stubs (id, run_id, business_id, staff_member_id, person_name, gross, net, pushed, pushed_at)
     VALUES ($1, $2, $3, $4, 'View Vera', 820, 700, TRUE, NOW())`,
    [crypto.randomUUID(), runId, owner.business.id, staffId],
  );

  // Control: BEFORE the road, the bracket refuses Vera's sign-in.
  const refused = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'fp-view-staff@example.com', password: 'CorrectHorse123' },
    csrf: false,
  });
  assert.equal(refused.status, 403, JSON.stringify(refused.json));
  assert.equal(refused.json.error, 'staff_outside_window');

  // Drive the business into view-only (grace already over).
  await failPayment(owner, subId);
  const failedAt = new Date(Date.now() - (FAILED_PAYMENT_GRACE_DAYS * DAY + 3_600_000)).toISOString();
  const graceEnds = new Date(Date.now() - 3_600_000).toISOString();
  await pool.query(
    'UPDATE subscriptions SET payment_failed_at = $1, payment_grace_ends_at = $2 WHERE business_id = $3',
    [failedAt, graceEnds, owner.business.id],
  );
  await pool.query(
    'UPDATE entitlements SET payment_failed_at = $1, payment_grace_ends_at = $2 WHERE business_id = $3',
    [failedAt, graceEnds, owner.business.id],
  );

  // The bracket no longer gates her: sign-in succeeds.
  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'fp-view-staff@example.com', password: 'CorrectHorse123' },
    csrf: false,
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const staffJar = cookieFrom(login.setCookie) || staff['cook' + 'ie'];

  // Her own stub + payroll context are reachable.
  const stubs = await req(`/api/businesses/${owner.business.id}/workforce/payroll/my-stubs`, auth(staffJar));
  assert.equal(stubs.status, 200, JSON.stringify(stubs.json));
  assert.equal(stubs.json.stubs.length, 1);
  const ctxRes = await req(`/api/businesses/${owner.business.id}/workforce/payroll/context`, auth(staffJar));
  assert.equal(ctxRes.status, 200, JSON.stringify(ctxRes.json));
  assert.equal(ctxRes.json.me_profile?.full_name, 'View Vera');

  // Reads stay open for staff (products list).
  const reads = await req('/api/entities/Product/query', auth(staffJar, {
    method: 'POST',
    body: { filter: { business_id: owner.business.id } },
  }));
  assert.equal(reads.status, 200, JSON.stringify(reads.json));

  // Writes are refused for staff with the APPROVED neutral words —
  // no payment, no money, no reason.
  const staffWrite = await req('/api/entities/Product', auth(staffJar, {
    method: 'POST',
    body: { business_id: owner.business.id, name: 'Nope', sku: 'NO-1' },
  }));
  assert.equal(staffWrite.status, 403);
  assert.equal(staffWrite.json.message, NEUTRAL_STOP_MESSAGE);

  // And for the owner too (her message names the read-only state,
  // as the owner's always has).
  const ownerWrite = await createProduct(owner, 'Nope', 'NO-2');
  assert.equal(ownerWrite.status, 403);
  assert.equal(ownerWrite.json.error, 'grace_read_only');
});

test('recovery in grace: a paid invoice clears every marker and full use continues', async () => {
  const { owner, subId } = await ownerOnSubscription('fp-fix-grace');
  await failPayment(owner, subId);
  assert.ok((await subRow(owner.business.id)).payment_failed_at);
  const { invoice } = mock.advancePeriod(subId);
  const res = await postEvent(webhookEvent('invoice.paid', invoice));
  assert.equal(res.status, 200);
  assert.equal(res.json.handled, true);
  const sub = await subRow(owner.business.id);
  assert.equal(sub.status, 'active');
  assert.equal(sub.payment_failed_at, null);
  assert.equal(sub.payment_grace_ends_at, null);
  assert.equal(sub.payment_warning_sent_at, null);
  const ent = await entRow(owner.business.id);
  assert.equal(ent.status, 'active');
  assert.equal(ent.payment_failed_at, null);
  const create = await createProduct(owner, 'Back Again', 'BA-1');
  assert.equal(create.status, 201, JSON.stringify(create.json));
});

test('recovery in view-only: payment restores full use', async () => {
  const { owner, subId } = await ownerOnSubscription('fp-fix-view');
  await failPayment(owner, subId);
  const failedAt = new Date(Date.now() - (FAILED_PAYMENT_GRACE_DAYS * DAY + 3_600_000)).toISOString();
  const graceEnds = new Date(Date.now() - 3_600_000).toISOString();
  await pool.query(
    'UPDATE subscriptions SET payment_failed_at = $1, payment_grace_ends_at = $2 WHERE business_id = $3',
    [failedAt, graceEnds, owner.business.id],
  );
  await pool.query(
    'UPDATE entitlements SET payment_failed_at = $1, payment_grace_ends_at = $2 WHERE business_id = $3',
    [failedAt, graceEnds, owner.business.id],
  );
  await runFailedPaymentSweep(pool, { logger: silent });
  assert.equal((await entRow(owner.business.id)).status, 'canceled');
  // The owner fixes the card; the retry succeeds.
  const { invoice } = mock.advancePeriod(subId);
  const res = await postEvent(webhookEvent('invoice.paid', invoice));
  assert.equal(res.status, 200);
  const sub = await subRow(owner.business.id);
  assert.equal(sub.status, 'active');
  assert.equal(sub.payment_failed_at, null);
  const ent = await entRow(owner.business.id);
  assert.equal(ent.status, 'active');
  assert.equal(ent.payment_failed_at, null);
  const create = await createProduct(owner, 'Restored', 'RE-1');
  assert.equal(create.status, 201, JSON.stringify(create.json));
});

test('a founding-tester comped workspace can never enter the road', async () => {
  const owner = await ownerWithBusiness('fp-comp@example.com');
  await setEntitlement(owner.business.id, { plan: 'business', status: 'founding_tester' });
  // No subscription row exists — the failure recorder has nothing
  // to mark and returns null.
  const road = await recordPaymentFailure(pool, owner.business.id);
  assert.equal(road, null);
  const summary = await runFailedPaymentSweep(pool, { logger: silent });
  assert.equal(summary.warned.length, 0);
  assert.equal(summary.transitioned.length, 0);
  const gate = await subscriptionAccessFor(pool, owner.user, owner.business.id);
  assert.equal(gate.state, 'full');
  const create = await createProduct(owner, 'Comp Widget', 'CW-1');
  assert.equal(create.status, 201, JSON.stringify(create.json));
});

test('the voluntary-cancel road is untouched: no road markers, full use to period end', async () => {
  const { owner, subId } = await ownerOnSubscription('fp-voluntary');
  // Voluntary cancel at period end, delivered the Stripe way:
  // the flag is set on the subscription in Stripe first (via the
  // API, as the app's own cancel door does it), then the
  // subscription.updated webhook confirms it.
  const { stripeApi } = await import('../../server/stripeClient.js');
  await stripeApi.updateSubscription(subId, { cancel_at_period_end: true });
  const updated = mock.getSubscription(subId);
  assert.equal(updated.cancel_at_period_end, true);
  const res = await postEvent(webhookEvent('customer.subscription.updated', updated));
  assert.equal(res.status, 200);
  const row = await subRow(owner.business.id);
  assert.equal(row.payment_failed_at, null, 'voluntary cancel never starts the failed-payment road');
  assert.equal(row.status, 'canceled');
  // Full use until the paid period ends (the Nov 7 road).
  const create = await createProduct(owner, 'Still Mine', 'SM-1');
  assert.equal(create.status, 201, JSON.stringify(create.json));
  // And a cancel flag arriving while ON the failed-payment road
  // does not merge the roads: the road's markers survive and the
  // entitlement stays past_due (the road governs).
  const { owner: owner2, subId: subId2 } = await ownerOnSubscription('fp-nomerge');
  await failPayment(owner2, subId2);
  await stripeApi.updateSubscription(subId2, { cancel_at_period_end: true });
  const sub2 = mock.getSubscription(subId2);
  const res2 = await postEvent(webhookEvent('customer.subscription.updated', sub2));
  assert.equal(res2.status, 200);
  const row2 = await subRow(owner2.business.id);
  assert.ok(row2.payment_failed_at, 'road markers survive a cancel flag during grace');
  assert.equal(row2.status, 'past_due');
  assert.equal((await entRow(owner2.business.id)).status, 'past_due');
});

test('the sweep job endpoint runs the day-15 transition over HTTP (job-secret door)', async () => {
  const { owner, subId } = await ownerOnSubscription('fp-endpoint');
  await failPayment(owner, subId);
  const failedAt = new Date(Date.now() - (FAILED_PAYMENT_GRACE_DAYS * DAY + 3_600_000)).toISOString();
  const graceEnds = new Date(Date.now() - 3_600_000).toISOString();
  await pool.query(
    'UPDATE subscriptions SET payment_failed_at = $1, payment_grace_ends_at = $2 WHERE business_id = $3',
    [failedAt, graceEnds, owner.business.id],
  );
  await pool.query(
    'UPDATE entitlements SET payment_failed_at = $1, payment_grace_ends_at = $2 WHERE business_id = $3',
    [failedAt, graceEnds, owner.business.id],
  );
  // No secret, no service: the door stays shut.
  const shut = await reqRaw('/api/billing/failed-payment-sweep', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(shut.status, 401);
  const res = await reqRaw('/api/billing/failed-payment-sweep', {
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json', 'x-job-secret': JOB_SECRET },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.transitioned.length, 1);
  assert.equal((await entRow(owner.business.id)).status, 'canceled');
});

test('pins: road state helper, keyset, training step, client + bracket wiring', async () => {
  // The pure state helper.
  const failedAt = new Date('2026-11-01T00:00:00.000Z');
  const record = {
    payment_failed_at: failedAt.toISOString(),
    payment_grace_ends_at: new Date(failedAt.getTime() + 14 * DAY).toISOString(),
  };
  assert.equal(failedPaymentRoadState(record, new Date(failedAt.getTime() + 13 * DAY)).state, 'grace');
  assert.equal(failedPaymentRoadState(record, new Date(failedAt.getTime() + 14 * DAY)).state, 'view_only');
  assert.equal(failedPaymentRoadState(record, new Date(failedAt.getTime() + 29 * DAY)).state, 'deletion_due');
  assert.equal(failedPaymentRoadState({}, new Date()).state, 'none');
  // Keyset: 5095 (release 340) + settings.pastDue.fixBy +
  // training.lessons.owner-billing.step5 = 5097, in en and es-MX.
  // (Release 342's blocklist batch added 4 more apiErrors keys,
  // for 5106 — the count itself is pinned in tests/t40.)
  const { en } = await import('../../src/lib/locales/en.js');
  const { esMX } = await import('../../src/lib/locales/es-MX.js');
  assert.equal(Object.keys(en).length, 6716);
  assert.ok(en['settings.pastDue.fixBy']);
  assert.ok(en['training.lessons.owner-billing.step5']);
  assert.ok(!en['settings.pastDue.body'].includes('will not be canceled early'));
  assert.equal(Object.keys(esMX).length, 6716);
  // Training: owner-billing now carries 5 steps in BOTH catalogs.
  const { TRAINING_LESSONS } = await import('../../server/trainingCatalog.js');
  const { TRAINING_LESSONS: CLIENT_LESSONS } = await import('../../src/lib/trainingCatalog.js');
  assert.equal(TRAINING_LESSONS.find((l) => l.id === 'owner-billing').steps, 5);
  assert.equal(CLIENT_LESSONS.find((l) => l.id === 'owner-billing').steps, 5);
  // Source pins: the bracket exemption + the client road mirror.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const staffWindow = fs.readFileSync(path.join(here, '../../server/staffWindow.js'), 'utf8');
  assert.ok(staffWindow.includes('businessInFailedPaymentViewOnly'));
  const route = fs.readFileSync(path.join(here, '../../src/components/plan/SubscriptionAccessRoute.jsx'), 'utf8');
  assert.ok(route.includes('failedPaymentRoadState'));
});
