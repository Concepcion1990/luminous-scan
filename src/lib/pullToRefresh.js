/**
 * Pull-to-refresh gesture math — the pure half of the app-wide shell
 * gesture (src/components/PullToRefreshShell.jsx).
 *
 * The owner's rule (Nov 14, 2026): every page, from the public Welcome
 * page all the way through the signed-in app, refreshes with a pull —
 * the gesture Google and Apple expect in the store apps. This module
 * holds only the numbers so they can be pinned by tests; every DOM
 * decision (which target, which overlay, which route) stays in the
 * shell component.
 *
 * Feel, matched to the retired per-page component so the four pages
 * that had the gesture keep the same hand: the finger's travel is
 * damped by half, the visible pull caps at 88px, and the refresh arms
 * once the damped pull reaches 56px. A shorter pull snaps back and
 * does nothing.
 */

/** Damped pixels of pull that arm the refresh. */
export const PULL_TRIGGER_DISTANCE = 56;

/** The damped pull never reports more than this. */
export const PULL_MAX_DISTANCE = 88;

/** Finger pixels → indicator pixels. */
export const PULL_RESISTANCE = 0.5;

/** Travel below this is finger jitter, not a pull. */
export const PULL_MIN_TRAVEL = 10;

/** Scroll offsets at or below this count as "at the very top". */
export const PULL_TOP_TOLERANCE = 2;

/** Finger travel → damped pull distance (0 for no downward travel). */
export function dampPullDistance(rawDy) {
  if (!Number.isFinite(rawDy) || rawDy <= 0) return 0;
  return Math.min(PULL_MAX_DISTANCE, rawDy * PULL_RESISTANCE);
}

/** True when the window scroller sits at the very top. */
export function isAtScrollTop(scrollY, documentScrollTop) {
  return (scrollY ?? 0) <= PULL_TOP_TOLERANCE
    && (documentScrollTop ?? 0) <= PULL_TOP_TOLERANCE;
}

/**
 * One touchmove sample, judged:
 *  - 'cancel' — the gesture is not a downward pull at the top (moving
 *    up, mostly horizontal, or the page has scrolled off the top);
 *    forget it entirely.
 *  - 'wait' — downward but still inside the jitter band; keep
 *    watching without showing anything.
 *  - 'pull' — a real pull; `distance` is the damped pull so far.
 */
export function evaluatePullMove({ dx, dy, scrollY } = {}) {
  const absDx = Math.abs(dx ?? 0);
  const down = dy ?? 0;
  if (down <= 0 || absDx > Math.abs(down) || (scrollY ?? 0) > PULL_TOP_TOLERANCE) {
    return { action: 'cancel' };
  }
  if (down < PULL_MIN_TRAVEL) return { action: 'wait' };
  return { action: 'pull', distance: dampPullDistance(down) };
}

/** True when a finished pull was long enough to refresh. */
export function shouldTriggerRefresh(dampedDistance) {
  return Number.isFinite(dampedDistance) && dampedDistance >= PULL_TRIGGER_DISTANCE;
}

/** Pull progress toward the trigger, 0..1, for the indicator. */
export function pullProgress(dampedDistance) {
  if (!Number.isFinite(dampedDistance) || dampedDistance <= 0) return 0;
  return Math.min(1, dampedDistance / PULL_TRIGGER_DISTANCE);
}
