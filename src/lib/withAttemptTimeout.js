/**
 * A bounded attempt: run an async attempt and settle — one way or the
 * other — within a fixed budget.
 *
 * Why this exists (Nov 14, 2026): the Thank You page's first reconcile
 * attempt rode a phone connection that dropped mid-flight. The fetch
 * never resolved and never rejected, so the attempt never settled, the
 * auto-recovery policy (src/lib/thankYouReconcileRetry.js) never got a
 * say, and the page sat on "Taking you to your plan…" with its Check
 * again button disabled until the owner reloaded the browser by hand.
 *
 * With this wrapper an attempt ALWAYS settles: if the budget runs out
 * first, the returned promise rejects with AttemptTimeoutError, which
 * the caller treats exactly like any other retryable failure. The
 * underlying attempt is not cancelled (a reconcile is idempotent on
 * the server); its late answer is simply ignored.
 */

/** Default budget for one reconcile attempt. */
export const ATTEMPT_TIMEOUT_MS = 15_000;

export class AttemptTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Attempt did not settle within ${timeoutMs}ms.`);
    this.name = 'AttemptTimeoutError';
    this.code = 'attempt_timeout';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * @param {() => Promise<*>} startAttempt starts the attempt.
 * @param {number} [timeoutMs] settle budget.
 * @returns {Promise<*>} the attempt's result, or an AttemptTimeoutError
 *   rejection when the budget runs out first, or the attempt's own
 *   rejection when it fails in time.
 */
export function withAttemptTimeout(startAttempt, timeoutMs = ATTEMPT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new AttemptTimeoutError(timeoutMs));
    }, timeoutMs);
    Promise.resolve()
      .then(startAttempt)
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}
