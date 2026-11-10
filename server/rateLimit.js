/**
 * In-memory rate limiter — T2.
 *
 * Single-machine twin: this state lives in the app process only. With
 * one Fly Machine (the twin's shape) that is correct; if the twin ever
 * runs more than one Machine, limits must move into Postgres or Redis
 * — recorded here so the limit is not silently assumed to be global.
 *
 * Fail closed: when the limit is hit the caller gets 429 with a
 * `retry_after_seconds` — never a silent pass.
 */

const buckets = new Map(); // key -> { count, windowStartMs }

/**
 * @param {string} key bucket key, e.g. `login:email:ip`
 * @param {number} maxAttempts allowed attempts inside the window
 * @param {number} windowMs window length in milliseconds
 * @returns {{ allowed: boolean, retryAfterSeconds: number }}
 */
export function checkLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStartMs >= windowMs) {
    buckets.set(key, { count: 1, windowStartMs: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count < maxAttempts) {
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const retryAfterSeconds = Math.ceil((bucket.windowStartMs + windowMs - now) / 1000);
  return { allowed: false, retryAfterSeconds };
}

/** Test helper — clears all buckets. Never used in production code. */
export function resetRateLimits() {
  buckets.clear();
}
