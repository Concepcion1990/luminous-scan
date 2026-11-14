import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTEMPT_TIMEOUT_MS,
  AttemptTimeoutError,
  withAttemptTimeout,
} from './withAttemptTimeout.js';

/**
 * The bounded attempt behind the Thank You page's reconcile call.
 *
 * LIVE FINDING (2026-11-14, ~11:31 AM MST): the owner's first
 * reconcile attempt rode a phone connection that dropped mid-flight;
 * the fetch never settled, the auto-recovery policy never engaged,
 * and "Check again" sat disabled until she reloaded by hand. These
 * tests pin the wrapper that makes that freeze impossible: an attempt
 * always settles, a timeout reads as a retryable failure, and a late
 * answer can never overwrite the timeout.
 */

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test('the default budget is fifteen seconds', () => {
  assert.equal(ATTEMPT_TIMEOUT_MS, 15_000);
});

test('an attempt that finishes in time resolves with its value', async () => {
  const value = await withAttemptTimeout(async () => {
    await delay(5);
    return { state: 'granted' };
  }, 500);
  assert.deepEqual(value, { state: 'granted' });
});

test('an attempt that fails in time rejects with its own error', async () => {
  const boom = new Error('network down');
  await assert.rejects(
    withAttemptTimeout(async () => { throw boom; }, 500),
    (error) => error === boom,
  );
});

test('an attempt that never settles rejects with AttemptTimeoutError', async () => {
  await assert.rejects(
    withAttemptTimeout(() => new Promise(() => {}), 25),
    (error) => {
      assert.ok(error instanceof AttemptTimeoutError);
      assert.equal(error.code, 'attempt_timeout');
      assert.equal(error.timeoutMs, 25);
      return true;
    },
  );
});

test('a late answer after the timeout cannot change the outcome', async () => {
  let release;
  const attempt = withAttemptTimeout(
    () => new Promise((resolve) => { release = resolve; }),
    25,
  );
  await assert.rejects(attempt, AttemptTimeoutError);
  release({ state: 'granted' });
  await delay(10);
  await assert.rejects(attempt, AttemptTimeoutError);
});

test('a synchronous throw inside the attempt is a rejection, not a crash', async () => {
  await assert.rejects(
    withAttemptTimeout(() => { throw new Error('sync boom'); }, 500),
    /sync boom/,
  );
});
