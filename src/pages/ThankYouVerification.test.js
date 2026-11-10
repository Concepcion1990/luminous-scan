import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ThankYou with Stripe live (T4): the page is a verification
 * pass-through again. On arrival with ?session_id=... it calls
 * reconcile-subscription-access (via src/lib/entitlements.js) with
 * the kept automatic recovery from
 * src/lib/thankYouReconcileRetry.js (5-minute window, backoff,
 * max 20 attempts) plus a manual "Check again" button. While
 * unverified the app is NOT unlocked and the page says so plainly;
 * success takes the customer directly inside the paid plan.
 */
const page = readFileSync('src/pages/ThankYou.jsx', 'utf8');

test('ThankYou reconciles the Stripe session on arrival', () => {
  assert.match(page, /reconcileSubscriptionAccess/);
  assert.match(page, /session_id/);
  assert.match(page, /nextAutoRecovery/);
});

test('ThankYou keeps the manual Check again button and the do-not-retry warning', () => {
  assert.match(page, /Check again/);
  assert.match(page, /Do not start another checkout to try again/);
  assert.match(page, /Your plan is determined by server-verified provider records\./);
});

test('ThankYou says plainly the app is not unlocked while unverified', () => {
  assert.match(page, /not verified yet/);
  assert.match(page, /The app is not unlocked until the purchase is verified/);
});

test('ThankYou takes a verified customer directly into the plan', () => {
  assert.match(page, /You're in — welcome to your plan/);
  assert.match(page, /<Link to="\/"[^>]*>\s*Open your plan\s*<\/Link>/);
});

test('ThankYou names no switching notice and no retired provider', () => {
  assert.doesNotMatch(page, /switching payments to Stripe/i);
  assert.doesNotMatch(page, /subscriptions will be back soon/i);
  assert.doesNotMatch(page, /Wix/i);
});
