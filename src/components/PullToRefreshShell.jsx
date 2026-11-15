import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { queryClientInstance } from '@/lib/query-client';
import {
  evaluatePullMove,
  isAtScrollTop,
  pullProgress,
  shouldTriggerRefresh,
} from '@/lib/pullToRefresh';

/**
 * App-wide pull-to-refresh — ONE implementation at the shell, so every
 * page gets the gesture: the public pages (Welcome, Plans, the policy
 * pages) and every signed-in screen alike. The owner asked for exactly
 * this (Nov 14, 2026): "starting from the welcome page all the way
 * through inside to the app" — the store apps expect the gesture too.
 *
 * It replaces the retired per-page component (formerly on Dashboard,
 * Inventory, Movements, and Scan only — most pages had nothing, which
 * is why the gesture felt absent).
 *
 * How it behaves:
 *  - Touch only. The handlers are touch events, so a desktop mouse can
 *    never trigger it; the coarse-pointer / small-screen check is a
 *    second belt.
 *  - Only from the very top of the window scroller, only for a
 *    deliberate downward pull (the math lives in src/lib/pullToRefresh
 *    and is unit-tested). A short pull snaps back with no action.
 *  - It never fights the app: the gesture is ignored inside
 *    dialogs/drawers, on interactive elements and form fields, inside
 *    nested scroll regions, and on the Scan screen, where a pull must
 *    never disturb a live scanning session. Ordinary scrolling is
 *    never claimed either — an upward or sideways drag, or any drag
 *    that starts away from the very top, is left entirely to the
 *    browser.
 *  - The ONE claim it makes: once a touch has armed as a downward
 *    pull at the very top (eligible target, no overlay, top of the
 *    window), the touchmove listener — registered NON-passive for
 *    exactly this — calls preventDefault. A real phone browser
 *    classifies a downward drag as its own scroll/overscroll gesture
 *    and takes it over (touchcancel) unless the page claims it first;
 *    with passive-only listeners the gesture died on the owner's
 *    phone while every synthetic-touch harness test passed (Nov 14,
 *    2026). At the very top a downward drag has nothing to scroll, so
 *    claiming it costs normal scrolling nothing.
 *  - The indicator is the brand globe alone — no words, so no locale
 *    strings ride along.
 *
 * What a refresh does: react-query data is invalidated (refetched
 * live) and the current route's content remounts, re-running the
 * mount-time fetches the pages are built on. It is deliberately NOT a
 * browser reload: the session, the offline queue, and the shell all
 * survive — the same trade a normal in-app navigation makes.
 */

const TOUCH_CAPABLE_QUERY = '(pointer: coarse), (max-width: 1023px)';
const IGNORE_TARGETS =
  'button, a, input, textarea, select, [role="button"], [contenteditable="true"], [data-pull-refresh-ignore]';
// The scanner is a live-work surface: no pull gesture there at all.
const GESTURE_DISABLED_PATHS = new Set(['/scan']);
const MIN_INDICATOR_MS = 600;

function hasOpenOverlay() {
  return Boolean(document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-vaul-drawer][data-state="open"]'
  ));
}

function insideScrollableRegion(target) {
  let element = target instanceof Element ? target : null;
  while (element && element !== document.body) {
    if (element instanceof HTMLElement) {
      const style = window.getComputedStyle(element);
      if (/auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2) {
        return true;
      }
    }
    element = element.parentElement;
  }
  return false;
}

export default function PullToRefreshShell({ children }) {
  const { pathname } = useLocation();
  const [nonce, setNonce] = useState(0);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const gesture = useRef(null);
  const busy = useRef(false);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const doRefresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    const startedAt = Date.now();
    try {
      await queryClientInstance.invalidateQueries();
    } catch {
      // A failed refetch surfaces in the page itself; the remount below
      // still gives the view its fresh start.
    }
    const remaining = MIN_INDICATOR_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) => { setTimeout(resolve, remaining); });
    }
    setNonce((value) => value + 1);
    busy.current = false;
    setRefreshing(false);
    setDistance(0);
  }, []);

  useEffect(() => {
    const onTouchStart = (event) => {
      gesture.current = null;
      if (
        busy.current ||
        GESTURE_DISABLED_PATHS.has(pathnameRef.current) ||
        event.touches.length !== 1 ||
        !window.matchMedia(TOUCH_CAPABLE_QUERY).matches ||
        !isAtScrollTop(window.scrollY, document.documentElement.scrollTop) ||
        hasOpenOverlay()
      ) return;
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest(IGNORE_TARGETS) ||
        insideScrollableRegion(target)
      ) return;
      const touch = event.touches[0];
      gesture.current = { x: touch.clientX, y: touch.clientY, distance: 0 };
    };

    const onTouchMove = (event) => {
      const current = gesture.current;
      if (!current || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const verdict = evaluatePullMove({
        dx: touch.clientX - current.x,
        dy: touch.clientY - current.y,
        scrollY: window.scrollY,
      });
      if (verdict.action === 'cancel') {
        gesture.current = null;
        setDistance(0);
        return;
      }
      // The gesture is armed and moving down at the very top: claim
      // it before the browser takes the drag over as its own scroll
      // gesture and cancels the touch stream (see the header note).
      // Only this path ever prevents default — 'cancel' above has
      // already handed every ordinary scroll back to the browser.
      if (event.cancelable) event.preventDefault();
      if (verdict.action === 'pull') {
        current.distance = verdict.distance;
        setDistance(verdict.distance);
      }
    };

    const onTouchEnd = () => {
      const finished = gesture.current;
      gesture.current = null;
      if (finished && shouldTriggerRefresh(finished.distance)) {
        void doRefresh();
      } else {
        setDistance(0);
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [doRefresh]);

  const progress = pullProgress(distance);
  const indicatorY = refreshing ? 10 : -46 + progress * 56;

  return (
    <>
      {(distance > 0 || refreshing) && (
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
          style={{ transform: `translateY(${indicatorY}px)` }}
          aria-hidden="true"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-md">
            <img
              src="/globe-mark.svg"
              alt=""
              className={`h-6 w-6 object-contain ${refreshing ? 'animate-spin' : ''}`}
              style={refreshing ? undefined : {
                transform: `rotate(${progress * 270}deg) scale(${0.75 + progress * 0.25})`,
                opacity: 0.45 + progress * 0.55,
              }}
            />
          </span>
        </div>
      )}
      <Fragment key={nonce}>{children}</Fragment>
    </>
  );
}
