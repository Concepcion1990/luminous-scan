/**
 * Automatic recovery policy for the ThankYou page.
 *
 * LIVE FINDING (2026-11-07, ~3:55 PM MST): after PR #38, Essentials
 * (cperezcarrillo25, fresh registration, clean slate) reached Thank You
 * "Taking you to your plan…" and did NOT go into the app on its own.
 * Concepcion had to press "Check again" — and THEN it granted and took
 * her in. The manual retry grants, but the automatic path did not
 * complete by itself.
 *
 * WHY (from the code, not a guess): the automatic recovery could die
 * two ways, both well inside the minutes while Stripe's subscription
 * records are still propagating after checkout.
 *
 * 1. The first automatic reconcile (about 10 seconds after landing)
 *    can come back `payment_does_not_match_purchase` while Stripe is
 *    still settling the checkout / subscription status — and that
 *    state was NOT in RETRYABLE_RECONCILE_STATES, so the page parked
 *    in 'reconcile-failed' and never tried again on its own.
 * 2. Even for states that WERE retryable, the page only ever tried
 *    three times, all inside the first ~30 seconds — then the budget
 *    was spent and only a manual tap was left.
 *
 * The manual tap that worked came later, after Stripe had propagated.
 * So the fix is about WHEN the page calls reconcile, not WHAT the
 * server accepts: the grant logic from PRs #35/#36/#38 is untouched
 * and exactly as strict. This module only decides whether the page
 * should try again on its own.
 *
 * THE RULE: inside a generous window after landing (5 minutes —
 * Stripe propagation in every live retest completed well inside 2),
 * keep retrying reconcile with backoff after ANY failure that time
 * might fix — including `payment_does_not_match_purchase`, which in
 * the minutes after checkout is usually Stripe still settling, not a
 * real mismatch. Stop at once for states time can never fix (a
 * permission error, a wrong subscription, a stale subscription, an
 * ambiguous order), and stop when the window — or the attempt cap —
 * runs out. After that the page shows the pending state with the
 * plain-language detail and the manual "Check again" button, exactly
 * as before. It never loops forever on a real mismatch.
 */

export const AUTO_RECOVERY_WINDOW_MS = 5 * 60 * 1000;
export const AUTO_RECOVERY_MAX_ATTEMPTS = 20;

// States where waiting cannot help: the answer will be the same in
// five minutes, so retrying would only burn provider reads and strand the
// customer on a spinner. This set is exactly the failure states the
// stripped `reconcile-subscription-access` backend can return (Wix
// removal, Nov 2026) — every one of them is final while Stripe is
// unconfigured. A state the server adds later that this page does not
// know yet is treated as "not ready yet" while the window is open.
export const FINAL_RECONCILE_STATES = new Set([
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
]);

// Pause before the next automatic try, given how many automatic tries
// have already happened: 10s, 15s, 20s, 25s, then 30s. The first
// automatic try already happened early (about 10 seconds after
// landing), so the first scheduled retry waits 15 seconds.
export function autoRecoveryDelayMs(attemptsMade) {
  if (!Number.isFinite(attemptsMade) || attemptsMade < 0) return 10_000;
  return Math.min(10_000 + attemptsMade * 5_000, 30_000);
}

// Should the page try reconcile again on its own after a failure?
// `attempts` is how many automatic tries have already happened.
// Returns { retry, delayMs } — delayMs is null when it must not retry.
export function nextAutoRecovery({ state, startedAtMs, nowMs = Date.now(), attempts = 0 } = {}) {
  if (typeof state !== 'string' || FINAL_RECONCILE_STATES.has(state)) {
    return { retry: false, delayMs: null };
  }
  const elapsed = nowMs - startedAtMs;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= AUTO_RECOVERY_WINDOW_MS) {
    return { retry: false, delayMs: null };
  }
  if (!Number.isFinite(attempts) || attempts < 0 || attempts >= AUTO_RECOVERY_MAX_ATTEMPTS) {
    return { retry: false, delayMs: null };
  }
  return { retry: true, delayMs: autoRecoveryDelayMs(attempts) };
}
