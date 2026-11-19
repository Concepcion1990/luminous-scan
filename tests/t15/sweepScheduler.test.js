/**
 * T15 — sweep scheduler (Nov 18, 2026): the in-process bell for
 * the billing sweeps. The sweeps and their job endpoints already
 * existed, but the old server timers only ran when
 * BILLING_JOBS_ENABLED was exactly 'true' — a flag production
 * never carried — so a due day-4 trial reminder was never sent.
 * The scheduler rings on its own: boot run + 6-hour ticks, ON
 * unless the flag is exactly 'false'.
 *
 * Proven here:
 *   one scheduler run invokes all three sweeps, composed as the
 *   job endpoints compose them (wipe, then the address purge
 *   riding it, then trial reminders);
 *   a failing sweep never blocks the others or escapes;
 *   the overlap guard admits one run at a time;
 *   the boot/interval timers fire and stop() silences them;
 *   the kill switch is an exact-'false' opt-out;
 *   end to end over the pg-mem harness: a trial inside the
 *   day-4 window receives exactly ONE day-4 email through the
 *   scheduler path, and a second run sends nothing more;
 *   server.js starts the scheduler and no longer opt-in-gates it.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  close,
  pool,
  ownerWithBusiness,
  insertSubscription,
  reminderMail,
  ledgerRows,
} from './helpers.js';
import {
  runScheduledSweeps,
  startSweepScheduler,
  sweepSchedulerDisabled,
  SWEEP_INTERVAL_MS,
} from '../../server/sweepScheduler.js';

after(async () => { await close(); });

const silent = { log() {}, error() {} };
const HOUR = 60 * 60 * 1000;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function stubSweeps(calls, overrides = {}) {
  return {
    async runWipeSweep() { calls.push('wipe'); return { wiped: [], skipped: [], candidateCount: 0 }; },
    async runCustomerAddressSweep() { calls.push('addresses'); return { purged: 0 }; },
    async runTrialReminderSweep() { calls.push('trial'); return { sent: [], pending: [], skipped: 0, trialCount: 0 }; },
    ...overrides,
  };
}

test('one scheduler run invokes all three sweeps in the endpoints order', async () => {
  const calls = [];
  const summary = await runScheduledSweeps({}, { logger: silent, sweeps: stubSweeps(calls) });
  assert.deepEqual(calls, ['wipe', 'addresses', 'trial']);
  assert.deepEqual(summary.failures, []);
  assert.ok(summary.wipe);
  assert.deepEqual(summary.customerAddresses, { purged: 0 });
  assert.ok(summary.trialReminders);
});

test('a failing sweep never blocks the others and never escapes', async () => {
  const calls = [];
  const sweeps = stubSweeps(calls, {
    async runWipeSweep() { calls.push('wipe'); throw new Error('boom'); },
  });
  const summary = await runScheduledSweeps({}, { logger: silent, sweeps });
  assert.deepEqual(calls, ['wipe', 'addresses', 'trial'], 'later sweeps still ran');
  assert.equal(summary.wipe, null);
  assert.ok(summary.trialReminders, 'trial reminders still ran');
  assert.deepEqual(summary.failures, [{ job: 'wipe', reason: 'boom' }]);
});

test('the overlap guard admits one run at a time', async () => {
  let entries = 0;
  const sweeps = stubSweeps([], {
    async runTrialReminderSweep() { entries += 1; await wait(60); return { sent: [], pending: [], skipped: 0, trialCount: 0 }; },
  });
  const handle = startSweepScheduler({
    getPoolFn: () => ({}), logger: silent, sweeps, bootDelayMs: 60 * 1000, intervalMs: 60 * 1000, env: {},
  });
  try {
    const first = handle.runOnce('test');
    const second = await handle.runOnce('test');
    assert.equal(second, null, 'the overlapping run was skipped');
    await first;
    assert.equal(entries, 1, 'the trial sweep was entered exactly once');
  } finally {
    handle.stop();
  }
});

test('boot and interval timers fire; stop() silences them', async () => {
  const calls = [];
  const handle = startSweepScheduler({
    getPoolFn: () => ({}), logger: silent, sweeps: stubSweeps(calls), bootDelayMs: 10, intervalMs: 25, env: {},
  });
  await wait(95);
  handle.stop();
  const atStop = calls.length;
  assert.ok(atStop >= 3, `boot + interval ticks ran the sweeps (saw ${atStop} sweep calls)`);
  await wait(60);
  assert.equal(calls.length, atStop, 'no runs after stop()');
});

test('kill switch: exact-false disables, anything else leaves the bell on', async () => {
  assert.equal(sweepSchedulerDisabled({ BILLING_JOBS_ENABLED: 'false' }), true);
  assert.equal(sweepSchedulerDisabled({ BILLING_JOBS_ENABLED: 'true' }), false);
  assert.equal(sweepSchedulerDisabled({}), false);
  const calls = [];
  const handle = startSweepScheduler({
    getPoolFn: () => ({}), logger: silent, sweeps: stubSweeps(calls),
    bootDelayMs: 5, intervalMs: 10, env: { BILLING_JOBS_ENABLED: 'false' },
  });
  assert.equal(handle.enabled, false);
  assert.equal(await handle.runOnce('test'), null);
  await wait(30);
  assert.deepEqual(calls, [], 'a disabled scheduler never rings');
  handle.stop();
});

test('end to end: a day-4-window trial gets exactly one email through the scheduler', async () => {
  const owner = await ownerWithBusiness('sched-day4@example.com');
  const subId = await insertSubscription({
    businessId: owner.business.id, ownerId: owner.user.id,
    trialEndsAt: new Date(Date.now() + 72 * HOUR).toISOString(),
  });
  const first = await runScheduledSweeps(pool, { logger: silent });
  assert.deepEqual(first.failures, []);
  assert.equal(first.trialReminders.sent.length, 1, 'the scheduler sent the due reminder');
  const mails = reminderMail(owner.email, 'Day 4');
  assert.equal(mails.length, 1, 'exactly one day-4 email in the mailbox');
  assert.match(mails[0].text, /day 4 of your 7-day free trial/);
  const second = await runScheduledSweeps(pool, { logger: silent });
  assert.deepEqual(second.failures, []);
  assert.equal(reminderMail(owner.email, 'Day 4').length, 1, 'a second run sends nothing more');
  const rows = await ledgerRows(subId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'email_day4');
  assert.equal(rows[0].status, 'sent');
});

test('server.js starts the scheduler and no longer opt-in-gates the sweeps', () => {
  const serverJs = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  assert.match(serverJs, /startSweepScheduler/, 'server.js starts the sweep scheduler');
  assert.doesNotMatch(serverJs, /BILLING_JOBS_ENABLED === 'true'/, 'the opt-in gate that broke production is gone');
  assert.equal(SWEEP_INTERVAL_MS, 6 * HOUR, 'the tick is 6 hours — inside every sweep window');
});
