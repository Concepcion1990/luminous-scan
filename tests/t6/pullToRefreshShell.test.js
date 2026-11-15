/**
 * T6 — Pull-to-refresh shell claim (Nov 14, 2026 hotfix).
 *
 * The gesture died on the owner's phone while every synthetic-touch
 * harness run passed: the shell listened passively and never called
 * preventDefault, so a real phone browser classified her downward
 * drag as its own scroll/overscroll gesture, took it over
 * (touchcancel) and the pull never armed. CDP-dispatched touches
 * never trigger that classification, which is why the harness could
 * not see it. The fix is the standard one: the touchmove listener
 * is NON-passive, and once a touch has armed as a downward pull at
 * the very top (the lib's verdict is not 'cancel'), the handler
 * claims the gesture with preventDefault. Every other gesture —
 * ordinary scrolling included — is never claimed: the cancel branch
 * runs first and returns before the claim.
 *
 * These are source pins (the repo's idiom for component behavior);
 * the gesture math itself stays pinned by src/lib/pullToRefresh
 * .test.js, and the rendered harness re-verified the pull on the
 * Overview, Products, Categories and Orders after this change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync(
  new URL('../../src/components/PullToRefreshShell.jsx', import.meta.url),
  'utf8',
);

test('shell: touchmove is registered non-passive so the claim is possible', () => {
  assert.ok(
    shell.includes("window.addEventListener('touchmove', onTouchMove, { passive: false });"),
    'touchmove must be non-passive — a passive listener cannot preventDefault',
  );
});

test('shell: touchstart stays passive (it never claims anything)', () => {
  assert.ok(
    shell.includes("window.addEventListener('touchstart', onTouchStart, { passive: true });"),
    'touchstart remains passive',
  );
});

test('shell: the claim fires only after the cancel branch has handed scrolling back', () => {
  const cancelAt = shell.indexOf("if (verdict.action === 'cancel')");
  const claimAt = shell.indexOf('event.preventDefault()');
  assert.ok(cancelAt !== -1, 'the cancel branch exists');
  assert.ok(claimAt !== -1, 'the gesture claim exists');
  assert.ok(claimAt > cancelAt, 'cancel is judged first — ordinary scrolls are never claimed');
  assert.ok(shell.includes('if (event.cancelable) event.preventDefault();'),
    'the claim is guarded to cancelable events');
});

test('shell: the gesture still comes from the pinned lib math and still skips Scan', () => {
  assert.ok(shell.includes("from '@/lib/pullToRefresh'"), 'the shell uses the unit-tested gesture math');
  assert.ok(shell.includes("new Set(['/scan'])"), 'the Scan screen stays gesture-free by design');
});
