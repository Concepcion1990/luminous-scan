/**
 * T15 — trial reminders: the two emails, the three in-app notices,
 * the truthful cancel branch, and the pending-retry rule.
 *
 * Design under test (owner's Nov 7 design, switched ON 2026-11-12):
 *   email_day4 fires on day 4 of the 7-day trial, exactly once;
 *   email_final24h fires inside the last 24 hours, exactly once;
 *   the in-app notice windows return five-day / three-day / one-day
 *   at the right trial ages and nothing outside them;
 *   a trial cancelled at period end gets the no-charge copy;
 *   an unconfigured mailer leaves the email PENDING (claim released,
 *   never marked sent) and a later sweep sends it once;
 *   a paid subscription receives nothing.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  close,
  pool,
  ownerWithBusiness,
  insertSubscription,
  reminderMail,
  mailerDown,
  mailerUp,
  ledgerRows,
} from './helpers.js';
import { runTrialReminderSweep, trialNoticeStage, dueReminderKinds } from '../../server/trialReminders.js';

after(async () => { await close(); });

const silent = { log() {} };
const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-20T12:00:00.000Z');
const endsIn = (hours) => new Date(NOW.getTime() + hours * HOUR).toISOString();

test('day-4 email fires exactly once across repeated sweeps', async () => {
  const owner = await ownerWithBusiness('rem-day4@example.com');
  // 72 hours left: day 4 of 7 (three full days have passed).
  const subId = await insertSubscription({
    businessId: owner.business.id, ownerId: owner.user.id, trialEndsAt: endsIn(72),
  });
  for (let i = 0; i < 3; i += 1) {
    await runTrialReminderSweep(pool, { now: NOW, logger: silent });
  }
  const mails = reminderMail(owner.email, 'Day 4');
  assert.equal(mails.length, 1, 'exactly one day-4 email');
  assert.match(mails[0].text, /day 4 of your 7-day free trial/);
  const rows = await ledgerRows(subId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'email_day4');
  assert.equal(rows[0].status, 'sent');
  assert.ok(rows[0].sent_at);
});

test('final-24h email fires exactly once — and no stale day-4 email joins it', async () => {
  const owner = await ownerWithBusiness('rem-final@example.com');
  const subId = await insertSubscription({
    businessId: owner.business.id, ownerId: owner.user.id, trialEndsAt: endsIn(12),
  });
  await runTrialReminderSweep(pool, { now: NOW, logger: silent });
  await runTrialReminderSweep(pool, { now: NOW, logger: silent });
  const finals = reminderMail(owner.email, '24 hours');
  assert.equal(finals.length, 1, 'exactly one final-24h email');
  assert.match(finals[0].text, /24 hours until your trial ends\./);
  assert.equal(reminderMail(owner.email, 'Day 4').length, 0, 'no day-4 email inside the final day');
  const rows = await ledgerRows(subId);
  assert.deepEqual(rows.map((r) => r.kind), ['email_final24h']);
});

test('notice windows: five-day, three-day, one-day at the right ages, none outside', () => {
  const rec = (hoursLeft, status = 'trialing') => ({ status, trial_ends_at: endsIn(hoursLeft) });
  assert.equal(trialNoticeStage(rec(110), NOW), 'five-day');
  assert.equal(trialNoticeStage(rec(97), NOW), 'five-day');
  assert.equal(trialNoticeStage(rec(60), NOW), 'three-day');
  assert.equal(trialNoticeStage(rec(49), NOW), 'three-day');
  assert.equal(trialNoticeStage(rec(24), NOW), 'one-day');
  assert.equal(trialNoticeStage(rec(1), NOW), 'one-day');
  // Between the windows and outside the trial: nothing shows.
  assert.equal(trialNoticeStage(rec(150), NOW), null, 'more than 5 days left');
  assert.equal(trialNoticeStage(rec(96), NOW), null, '4 days left is between windows');
  assert.equal(trialNoticeStage(rec(30), NOW), null, 'between 1 and 3 days');
  assert.equal(trialNoticeStage(rec(-2), NOW), null, 'trial already ended');
  assert.equal(trialNoticeStage(rec(12, 'active'), NOW), null, 'paid subscription');
  assert.equal(trialNoticeStage(null, NOW), null);
  assert.deepEqual(dueReminderKinds(rec(72), NOW), ['email_day4']);
  assert.deepEqual(dueReminderKinds(rec(12), NOW), ['email_final24h']);
  assert.deepEqual(dueReminderKinds(rec(150), NOW), []);
});

test('cancel-at-period-end trial gets the truthful no-charge final email', async () => {
  const owner = await ownerWithBusiness('rem-cancelled@example.com');
  await insertSubscription({
    businessId: owner.business.id, ownerId: owner.user.id,
    trialEndsAt: endsIn(12), cancelAtPeriodEnd: true,
  });
  const control = await ownerWithBusiness('rem-charging@example.com');
  await insertSubscription({
    businessId: control.business.id, ownerId: control.user.id, trialEndsAt: endsIn(12),
  });
  await runTrialReminderSweep(pool, { now: NOW, logger: silent });
  const cancelledMail = reminderMail(owner.email, '24 hours');
  assert.equal(cancelledMail.length, 1, 'cancelled trial still gets its reminder');
  assert.match(cancelledMail[0].text, /no charge is coming/);
  assert.doesNotMatch(cancelledMail[0].text, /will be charged|is charged/);
  const chargingMail = reminderMail(control.email, '24 hours');
  assert.equal(chargingMail.length, 1);
  assert.match(chargingMail[0].text, /is charged/);
  assert.match(chargingMail[0].text, /Settings, then Billing/);
});

test('mailer unconfigured leaves the email pending; a later sweep sends it once', async () => {
  const owner = await ownerWithBusiness('rem-pending@example.com');
  const subId = await insertSubscription({
    businessId: owner.business.id, ownerId: owner.user.id, trialEndsAt: endsIn(72),
  });
  mailerDown();
  const downSummary = await runTrialReminderSweep(pool, { now: NOW, logger: silent });
  assert.equal(downSummary.sent.length, 0);
  assert.ok(downSummary.pending.some((p) => p.subscriptionId === subId && p.kind === 'email_day4'));
  assert.equal(reminderMail(owner.email).length, 0, 'nothing was sent');
  assert.equal((await ledgerRows(subId)).length, 0, 'claim released — not marked sent, still pending');
  mailerUp();
  await runTrialReminderSweep(pool, { now: NOW, logger: silent });
  assert.equal(reminderMail(owner.email, 'Day 4').length, 1, 'the later sweep sends it');
  await runTrialReminderSweep(pool, { now: NOW, logger: silent });
  assert.equal(reminderMail(owner.email, 'Day 4').length, 1, 'and only once');
  const rows = await ledgerRows(subId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'sent');
});

test('paid subscription receives nothing — no sends, no notice', async () => {
  const owner = await ownerWithBusiness('rem-paid@example.com');
  const subId = await insertSubscription({
    businessId: owner.business.id, ownerId: owner.user.id,
    status: 'active', trialEndsAt: null,
  });
  const summary = await runTrialReminderSweep(pool, { now: NOW, logger: silent });
  assert.ok(!summary.sent.some((s) => s.subscriptionId === subId));
  assert.equal(reminderMail(owner.email).length, 0);
  assert.equal((await ledgerRows(subId)).length, 0);
  assert.equal(trialNoticeStage({ status: 'active', trial_ends_at: endsIn(12) }, NOW), null);
});
