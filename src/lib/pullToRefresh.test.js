import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PULL_MAX_DISTANCE,
  PULL_MIN_TRAVEL,
  PULL_TRIGGER_DISTANCE,
  dampPullDistance,
  evaluatePullMove,
  isAtScrollTop,
  pullProgress,
  shouldTriggerRefresh,
} from './pullToRefresh.js';

/**
 * The gesture math behind the app-wide pull-to-refresh shell
 * (src/components/PullToRefreshShell.jsx). The owner asked for the
 * pull on every page (Nov 14, 2026); these tests pin the feel and the
 * safety edges: only a deliberate downward pull at the very top arms
 * a refresh, and a short pull snaps back with no action.
 */

test('the pull is damped by half and capped', () => {
  assert.equal(dampPullDistance(0), 0);
  assert.equal(dampPullDistance(-20), 0);
  assert.equal(dampPullDistance(40), 20);
  assert.equal(dampPullDistance(112), PULL_TRIGGER_DISTANCE);
  assert.equal(dampPullDistance(1000), PULL_MAX_DISTANCE);
  assert.equal(dampPullDistance(Number.NaN), 0);
});

test('only the very top of the page counts as the top', () => {
  assert.equal(isAtScrollTop(0, 0), true);
  assert.equal(isAtScrollTop(2, 2), true);
  assert.equal(isAtScrollTop(3, 0), false);
  assert.equal(isAtScrollTop(0, 40), false);
  assert.equal(isAtScrollTop(undefined, undefined), true);
});

test('a downward pull at the top reports its damped distance', () => {
  const move = evaluatePullMove({ dx: 4, dy: 80, scrollY: 0 });
  assert.equal(move.action, 'pull');
  assert.equal(move.distance, 40);
});

test('upward, horizontal, and off-the-top moves cancel the gesture', () => {
  assert.equal(evaluatePullMove({ dx: 0, dy: -12, scrollY: 0 }).action, 'cancel');
  assert.equal(evaluatePullMove({ dx: 60, dy: 30, scrollY: 0 }).action, 'cancel');
  assert.equal(evaluatePullMove({ dx: 0, dy: 80, scrollY: 25 }).action, 'cancel');
});

test('sub-jitter downward travel waits without showing a pull', () => {
  const move = evaluatePullMove({ dx: 1, dy: PULL_MIN_TRAVEL - 1, scrollY: 0 });
  assert.equal(move.action, 'wait');
});

test('a finished pull triggers only past the trigger distance', () => {
  assert.equal(shouldTriggerRefresh(PULL_TRIGGER_DISTANCE - 1), false);
  assert.equal(shouldTriggerRefresh(PULL_TRIGGER_DISTANCE), true);
  assert.equal(shouldTriggerRefresh(PULL_MAX_DISTANCE), true);
  assert.equal(shouldTriggerRefresh(Number.NaN), false);
  // End to end: the finger must travel twice the damped trigger.
  const full = evaluatePullMove({ dx: 0, dy: PULL_TRIGGER_DISTANCE * 2, scrollY: 0 });
  assert.equal(shouldTriggerRefresh(full.distance), true);
  const short = evaluatePullMove({ dx: 0, dy: PULL_TRIGGER_DISTANCE * 2 - 2, scrollY: 0 });
  assert.equal(shouldTriggerRefresh(short.distance), false);
});

test('progress runs 0..1 toward the trigger', () => {
  assert.equal(pullProgress(0), 0);
  assert.equal(pullProgress(PULL_TRIGGER_DISTANCE / 2), 0.5);
  assert.equal(pullProgress(PULL_TRIGGER_DISTANCE), 1);
  assert.equal(pullProgress(PULL_MAX_DISTANCE), 1);
});
