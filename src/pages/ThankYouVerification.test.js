import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * ThankYou while payments are switching to Stripe (Wix removal,
 * 2026-11-08): there is no checkout to return from, so the page is a
 * switching notice, not a verification pass-through. It shows the
 * switching notice with a "Back to plans" link and calls NO backend
 * function — in particular it never calls reconcile-subscription-access.
 * The automatic recovery in src/lib/thankYouReconcileRetry.js is kept
 * for the Stripe rebuild, when a real checkout exists again.
 */
const page = readFileSync('src/pages/ThankYou.jsx', 'utf8');

test('ThankYou shows the Stripe switching notice', () => {
  assert.match(page, /switching payments to Stripe — subscriptions will be back soon\./);
  assert.match(page, /nothing has been\s*\n?\s*charged/);
});

test('ThankYou offers a Back to plans link', () => {
  assert.match(page, /<Link to="\/plans"[^>]*>\s*Back to plans\s*<\/Link>/);
});

test('ThankYou calls no backend function and never reconciles', () => {
  assert.doesNotMatch(page, /base44\.functions\.invoke/);
  assert.doesNotMatch(page, /reconcile-subscription-access/);
  assert.doesNotMatch(page, /reconcileSubscriptionAccess/);
  assert.doesNotMatch(page, /loadEntitlement/);
  assert.doesNotMatch(page, /navigate\('\/'\)/);
  assert.doesNotMatch(page, /window\.location/);
});

test('ThankYou keeps the do-not-retry warning and the server-verified plan line', () => {
  assert.match(page, /Do not start another checkout to try again/);
  assert.match(page, /Your plan is determined by server-verified provider records\./);
});

test('ThankYou names no retired provider and no checkout', () => {
  assert.doesNotMatch(page, /Wix/i);
  assert.doesNotMatch(page, /create-checkout/);
  assert.doesNotMatch(page, /Check again/);
});

test('the recovery policy lib is kept for the Stripe rebuild', () => {
  // ThankYou itself no longer uses it, but the retry machinery
  // (5-minute window, backoff, final-state set) is kept and unit-tested
  // in src/lib/thankYouReconcileRetry.test.js for when a real Stripe
  // checkout exists again.
  const lib = readFileSync('src/lib/thankYouReconcileRetry.js', 'utf8');
  assert.match(lib, /FINAL_RECONCILE_STATES/);
  assert.match(lib, /stripe_not_configured/);
  assert.match(lib, /AUTO_RECOVERY_WINDOW_MS/);
});
