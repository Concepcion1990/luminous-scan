import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trialInAppNotice, IN_APP_NOTICE_MESSAGES } from './trialNotices.js';

/**
 * Tests for the in-app trial notices.
 *
 * Concepcion's three notices, in her exact words:
 *   "You have 5 more days left on your trial."
 *   "You have 3 more days left on your trial."
 *   "24 hours until your trial ends."
 * At most one ever shows. Pre-launch previews are not trials and get
 * no notice here — they keep their own banner copy.
 */

const NOW = Date.parse('2026-11-05T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const record = (hoursLeft, overrides = {}) => ({
  status: 'trialing',
  trial_ends_at: new Date(NOW + hoursLeft * HOUR).toISOString(),
  ...overrides,
});

test('the three messages are exactly Concepcion’s words', () => {
  assert.equal(IN_APP_NOTICE_MESSAGES['five-day'], 'You have 5 more days left on your trial.');
  assert.equal(IN_APP_NOTICE_MESSAGES['three-day'], 'You have 3 more days left on your trial.');
  assert.equal(IN_APP_NOTICE_MESSAGES['one-day'], '24 hours until your trial ends.');
});

test('five-day notice shows at 5 days left and only there', () => {
  assert.deepEqual(trialInAppNotice(record(120), NOW), {
    stage: 'five-day',
    message: 'You have 5 more days left on your trial.',
  });
  assert.equal(trialInAppNotice(record(100), NOW).stage, 'five-day');
  assert.equal(trialInAppNotice(record(97), NOW).stage, 'five-day');
  assert.equal(trialInAppNotice(record(121), NOW), null);
  assert.equal(trialInAppNotice(record(96), NOW), null);
});

test('three-day notice shows at 3 days left and only there', () => {
  assert.deepEqual(trialInAppNotice(record(72), NOW), {
    stage: 'three-day',
    message: 'You have 3 more days left on your trial.',
  });
  assert.equal(trialInAppNotice(record(49), NOW).stage, 'three-day');
  assert.equal(trialInAppNotice(record(25), NOW), null);
});

test('24-hour notice shows in the last day only', () => {
  assert.deepEqual(trialInAppNotice(record(24), NOW), {
    stage: 'one-day',
    message: '24 hours until your trial ends.',
  });
  assert.equal(trialInAppNotice(record(1), NOW).stage, 'one-day');
  assert.equal(trialInAppNotice(record(0), NOW), null);
  assert.equal(trialInAppNotice(record(-2), NOW), null);
});

test('gaps between notices show nothing', () => {
  // Between 3 and 5 days, and between 1 and 3 days, no notice shows.
  assert.equal(trialInAppNotice(record(96), NOW), null);
  assert.equal(trialInAppNotice(record(48), NOW), null);
  assert.equal(trialInAppNotice(record(150), NOW), null);
});

test('only real trials qualify — never prelaunch, paid, or broken dates', () => {
  assert.equal(trialInAppNotice(record(100, { status: 'grandfathered' }), NOW), null);
  assert.equal(trialInAppNotice(record(100, { status: 'active' }), NOW), null);
  assert.equal(trialInAppNotice(record(100, { status: 'canceled' }), NOW), null);
  assert.equal(trialInAppNotice(record(100, { trial_ends_at: 'not-a-date' }), NOW), null);
  assert.equal(trialInAppNotice(record(100, { trial_ends_at: null }), NOW), null);
  assert.equal(trialInAppNotice(null, NOW), null);
});
