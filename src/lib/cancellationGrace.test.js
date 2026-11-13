import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANCELLATION_GRACE_DAYS,
  CANCELLATION_GRACE_PARAGRAPH,
  CANCELLATION_WIPE_SENTENCE,
  assessCancellationGrace,
} from './cancellationGrace.js';

/**
 * Frontend mirror of base44/shared/cancellationGracePolicy.ts — the same
 * cases must decide the same way in both places, because the router uses
 * this copy and the server uses that one.
 */

const NOW = new Date('2026-11-20T12:00:00.000Z');

test('grace length is 15 days', () => {
  assert.equal(CANCELLATION_GRACE_DAYS, 15);
});

test('canonical wipe copy is exact (audit findings 1/34)', () => {
  assert.equal(
    CANCELLATION_WIPE_SENTENCE,
    'After the 15-day grace period ends, your account and all its information are permanently deleted and cannot be recovered.');
  assert.equal(
    CANCELLATION_GRACE_PARAGRAPH,
    'After your paid period ends, you have 15 days to view your products only — you can see SKUs, ISBNs, and everything you need to move elsewhere, but you cannot make changes, use the scanner, import, or export. After those 15 days, your account and all its information are permanently deleted and cannot be recovered. Resubscribing starts fresh.');
});

test('canceled with a future paid-through date: full access', () => {
  const decision = assessCancellationGrace(
    { status: 'canceled', paidThrough: '2026-11-25T00:00:00.000Z' }, NOW);
  assert.equal(decision.state, 'full_access');
  assert.equal(decision.graceEndsAt, '2026-12-10T00:00:00.000Z');
});

test('canceled 5 days past paid-through: read-only grace', () => {
  const decision = assessCancellationGrace(
    { status: 'canceled', paidThrough: '2026-11-15T12:00:00.000Z' }, NOW);
  assert.equal(decision.state, 'grace');
  assert.equal(decision.graceEndsAt, '2026-11-30T12:00:00.000Z');
});

test('canceled at or past the grace boundary: locked', () => {
  assert.equal(
    assessCancellationGrace({ status: 'canceled', paidThrough: '2026-11-05T12:00:00.000Z' }, NOW).state,
    'locked');
  assert.equal(
    assessCancellationGrace({ status: 'canceled', paidThrough: '2026-11-04T12:00:00.000Z' }, NOW).state,
    'locked');
});

test('canceled with no verifiable paid-through date: locked (fail closed)', () => {
  assert.equal(
    assessCancellationGrace({ status: 'canceled', paidThrough: null }, NOW).state, 'locked');
  assert.equal(
    assessCancellationGrace({ status: 'canceled', paidThrough: 'not-a-date' }, NOW).state, 'locked');
});

test('grandfathered never enters grace; other statuses are not this rule’s decision', () => {
  assert.equal(
    assessCancellationGrace({ status: 'grandfathered', paidThrough: '2026-11-04T12:00:00.000Z' }, NOW).state,
    'full_access');
  for (const status of ['active', 'trialing', 'past_due', 'pending_checkout', null]) {
    assert.equal(
      assessCancellationGrace({ status, paidThrough: '2026-11-04T12:00:00.000Z' }, NOW).state,
      'not_applicable');
  }
});
