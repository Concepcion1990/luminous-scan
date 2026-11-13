import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en } from '../lib/locales/en.js';

/**
 * ThankYou with Stripe live (T4): the page is a verification
 * pass-through again. On arrival with ?session_id=... it calls
 * reconcile-subscription-access (via src/lib/entitlements.js) with
 * the kept automatic recovery from
 * src/lib/thankYouReconcileRetry.js (5-minute window, backoff,
 * max 20 attempts) plus a manual "Check again" button. While
 * unverified the app is NOT unlocked and the page says so plainly;
 * success takes the customer directly inside the paid plan.
 *
 * T6.3: the page copy moved into src/lib/locales/en.js (thankYou.*)
 * and the page renders it through t(). These tests assert the page
 * references the key AND the English value still says the words —
 * the copy is what the customer reads, wherever it lives.
 */
const page = readFileSync('src/pages/ThankYou.jsx', 'utf8');

test('ThankYou reconciles the Stripe session on arrival', () => {
  assert.match(page, /reconcileSubscriptionAccess/);
  assert.match(page, /session_id/);
  assert.match(page, /nextAutoRecovery/);
});

test('ThankYou keeps the manual Check again button and the do-not-retry warning', () => {
  assert.match(page, /t\('thankYou\.checkAgain'\)/);
  assert.equal(en['thankYou.checkAgain'], 'Check again');
  assert.match(page, /t\('thankYou\.doNotRetry'\)/);
  assert.match(en['thankYou.doNotRetry'], /Do not start another checkout to try again/);
  assert.match(page, /t\('thankYou\.serverVerified'\)/);
  assert.match(en['thankYou.serverVerified'], /Your plan is determined by server-verified provider records\./);
});

test('ThankYou says plainly the app is not unlocked while unverified', () => {
  assert.match(page, /t\('thankYou\.pendingTitle'\)/);
  assert.match(en['thankYou.pendingTitle'], /not verified yet/);
  assert.match(en['thankYou.serverVerified'], /The app is not unlocked until the purchase is verified/);
});

test('ThankYou takes a verified customer directly into the plan', () => {
  assert.match(page, /t\('thankYou\.grantedTitle'\)/);
  assert.equal(en['thankYou.grantedTitle'], "You're in — welcome to your plan.");
  assert.match(page, /<Link to="\/"[^>]*>\{t\('thankYou\.openPlan'\)\}<\/Link>/);
  assert.equal(en['thankYou.openPlan'], 'Open your plan');
});

test('ThankYou names no switching notice and no retired provider', () => {
  assert.doesNotMatch(page, /switching payments to Stripe/i);
  assert.doesNotMatch(page, /subscriptions will be back soon/i);
  assert.doesNotMatch(page, /Wix/i);
});
