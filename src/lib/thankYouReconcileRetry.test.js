import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_RECOVERY_MAX_ATTEMPTS,
  AUTO_RECOVERY_WINDOW_MS,
  FINAL_RECONCILE_STATES,
  autoRecoveryDelayMs,
  nextAutoRecovery,
} from './thankYouReconcileRetry.js';

/**
 * The ThankYou automatic-recovery policy (src/lib/thankYouReconcileRetry.js).
 *
 * LIVE FINDING (2026-11-07, ~3:55 PM MST): after PR #38 the Essentials
 * trial granted — but only after Concepcion pressed "Check again". The
 * automatic path had died: the first automatic reconcile came back
 * `payment_does_not_match_purchase` while Stripe was still settling, and
 * that state was treated as final, so nothing ever tried again on its
 * own. A manual tap a minute later granted the same checkout. These
 * tests pin the fix: keep trying on your own across the propagation
 * window, stop at once for a genuinely final answer, and never loop
 * forever.
 */

const START = 1_000_000_000_000;

test('the recovery window is generous and the attempt cap is a safety net', () => {
  assert.equal(AUTO_RECOVERY_WINDOW_MS, 5 * 60 * 1000);
  assert.equal(AUTO_RECOVERY_MAX_ATTEMPTS, 20);
});

test('backoff grows 10s, 15s, 20s, 25s, then stays at 30s', () => {
  assert.equal(autoRecoveryDelayMs(0), 10_000);
  assert.equal(autoRecoveryDelayMs(1), 15_000);
  assert.equal(autoRecoveryDelayMs(2), 20_000);
  assert.equal(autoRecoveryDelayMs(3), 25_000);
  assert.equal(autoRecoveryDelayMs(4), 30_000);
  assert.equal(autoRecoveryDelayMs(19), 30_000);
  assert.equal(autoRecoveryDelayMs(-1), 10_000);
});

test('a mismatch right after checkout retries: the 3:55 PM case', () => {
  // The first automatic reconcile (~10 seconds after landing) came back
  // payment_does_not_match_purchase while the provider was still
  // settling — and a tap a minute later granted the same checkout. That
  // state must NOT end the automatic recovery while the window is open.
  // NOTE (Wix removal, Nov 2026): the backend no longer returns this
  // state at all — this test now pins the generic retry mechanic (an
  // unknown / not-final state retries inside the window), not a live
  // backend state.
  assert.equal(FINAL_RECONCILE_STATES.has('payment_does_not_match_purchase'), false);
  const decision = nextAutoRecovery({
    state: 'payment_does_not_match_purchase',
    startedAtMs: START,
    nowMs: START + 10_000,
    attempts: 1,
  });
  assert.equal(decision.retry, true);
  assert.equal(decision.delayMs, 15_000);
});

test('a first-call failure followed by later failures keeps trying until the window ends', () => {
  // Simulate the live sequence: early failure, then more failures as
  // Stripe propagates. Every one inside the window schedules another try;
  // the first try past the window stops.
  for (const [elapsedMs, attempts] of [[10_000, 1], [60_000, 3], [120_000, 5], [240_000, 9]]) {
    const decision = nextAutoRecovery({
      state: 'payment_does_not_match_purchase',
      startedAtMs: START,
      nowMs: START + elapsedMs,
      attempts,
    });
    assert.equal(decision.retry, true, `should retry at ${elapsedMs}ms`);
    assert.ok(decision.delayMs >= 10_000 && decision.delayMs <= 30_000);
  }
  assert.deepEqual(nextAutoRecovery({
    state: 'payment_does_not_match_purchase',
    startedAtMs: START,
    nowMs: START + AUTO_RECOVERY_WINDOW_MS,
    attempts: 11,
  }), { retry: false, delayMs: null });
  assert.deepEqual(nextAutoRecovery({
    state: 'payment_does_not_match_purchase',
    startedAtMs: START,
    nowMs: START + AUTO_RECOVERY_WINDOW_MS + 60_000,
    attempts: 11,
  }), { retry: false, delayMs: null });
});

test('not-ready-yet states retry inside the window', () => {
  // No failure state the backend can return today is retryable — every
  // one is in FINAL_RECONCILE_STATES. These are plausible states a
  // future Stripe rebuild might add for "not settled yet"; unknown
  // states retry while the window is open, so the page keeps trying
  // instead of parking on a spinner.
  for (const state of [
    'stripe_checkout_not_confirmed_yet',
    'stripe_subscription_read_unavailable',
    'stripe_subscription_paid_through_unverified',
  ]) {
    const decision = nextAutoRecovery({
      state, startedAtMs: START, nowMs: START + 30_000, attempts: 2,
    });
    assert.equal(decision.retry, true, `${state} should retry`);
  }
});

test('a genuinely final denial stops at once, even at the start of the window', () => {
  // Exactly the failure states the stripped reconcile backend can
  // return (Wix removal, Nov 2026). Every one is final: waiting
  // cannot change the answer.
  for (const state of [
    'method_not_allowed',
    'sign_in_required',
    'invalid_request',
    'owner_required',
    'account_billing_records_incomplete',
    'owner_billing_history_mismatch',
    'multiple_entitlements_or_subscriptions_need_review',
    'complimentary_business_account_protected',
    'no_pending_checkout_to_reconcile',
    'paid_purchase_access_unverified',
    'stripe_not_configured',
    'subscription_reconciliation_unavailable',
  ]) {
    assert.equal(FINAL_RECONCILE_STATES.has(state), true, `${state} must be final`);
    assert.deepEqual(nextAutoRecovery({
      state, startedAtMs: START, nowMs: START + 1_000, attempts: 0,
    }), { retry: false, delayMs: null }, `${state} must stop immediately`);
  }
});

test('stripe_not_configured is final: no Stripe implementation yet, so waiting cannot help', () => {
  // The backend returns stripe_not_configured for any provider step with
  // no Stripe implementation yet. Retrying it would only burn provider
  // reads, so it stops at once like every other final state.
  assert.equal(FINAL_RECONCILE_STATES.has('stripe_not_configured'), true);
  assert.deepEqual(nextAutoRecovery({
    state: 'stripe_not_configured', startedAtMs: START, nowMs: START + 1_000, attempts: 0,
  }), { retry: false, delayMs: null });
});

test('an unknown state retries inside the window but never past it', () => {
  // A state the server adds later that this page does not know yet is
  // treated as "not ready" while the window is open — the page's
  // catch-all detail already tells the customer to wait — but the
  // window still ends it.
  assert.deepEqual(nextAutoRecovery({
    state: 'some_future_state', startedAtMs: START, nowMs: START + 60_000, attempts: 3,
  }), { retry: true, delayMs: 25_000 });
  assert.deepEqual(nextAutoRecovery({
    state: 'some_future_state', startedAtMs: START, nowMs: START + 10 * 60_000, attempts: 3,
  }), { retry: false, delayMs: null });
});

test('the attempt cap stops the loop even inside the window', () => {
  assert.deepEqual(nextAutoRecovery({
    state: 'payment_does_not_match_purchase',
    startedAtMs: START,
    nowMs: START + 60_000,
    attempts: AUTO_RECOVERY_MAX_ATTEMPTS,
  }), { retry: false, delayMs: null });
  assert.equal(nextAutoRecovery({
    state: 'payment_does_not_match_purchase',
    startedAtMs: START,
    nowMs: START + 60_000,
    attempts: AUTO_RECOVERY_MAX_ATTEMPTS - 1,
  }).retry, true);
});

test('a missing or non-string state never retries', () => {
  assert.deepEqual(nextAutoRecovery({ startedAtMs: START, nowMs: START + 1_000 }), { retry: false, delayMs: null });
  assert.deepEqual(nextAutoRecovery({ state: null, startedAtMs: START, nowMs: START + 1_000 }), { retry: false, delayMs: null });
});
