import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import { visualUrl } from '@/lib/embedMode';
import { t } from '@/lib/i18n';
import { useAuth } from '@/lib/AuthContext';

// A lesson step's visual (Nov 15, 2026): the app's OWN page,
// rendered live by the app itself inside a frame — the reader's
// session, the reader's language, the reader's real data — with
// a ring on the control the step is about. Never a drawing,
// never another app, never a stored screenshot that can go
// stale. Steps whose screen only exists mid-flow carry a DOOR
// visual — the page and the button that starts the flow — and
// steps with no screen action carry none at all; both are
// recorded in the build report for the owner's ruling.
//
// The frame itself stays inert (pointer-events: none) — it is a
// picture of the screen, and the lesson's words stay the
// instructions. What changed on the owner's phone (Nov 15,
// 2026): the picture was a window she could not look around in
// — no scrolling inside it, in either direction, and the page
// inside rendered squeezed into the step's indent, its text
// colliding. So now:
//  - the stage breaks out of the step indent to the reader's
//    full viewport width (below the desktop breakpoint), so
//    the inner page lays out exactly as it does on her phone;
//  - a gesture layer over the frame translates drags into
//    scrolling INSIDE the frame, both axes, while taps and
//    clicks never reach the pictured page;
//  - a tap (or the expand button) opens the same live page
//    WIDE — full screen and fully explorable — with a clear
//    way back to the very step she was reading.
export default function StepVisual({ visual, title }) {
  const wrapRef = useRef(null);
  const frameRef = useRef(null);
  const wideFrameRef = useRef(null);
  const gestureRef = useRef(null);
  const gesture = useRef(null);
  const measureRaf = useRef(0);
  const [mounted, setMounted] = useState(false);
  const [ring, setRing] = useState(null);
  const [wide, setWide] = useState(false);
  const [bleed, setBleed] = useState(null);
  // One session, one door out (owner ruling, Nov 15, 2026): the
  // wide view is the same app on the same session, fully usable —
  // including its Log out. If the session ends in there, it ends
  // out here too: the wide view closes and the outer app walks
  // out through its own logout, landing on the real login page.
  // The lesson chrome must never sit above a login page.
  const { logout } = useAuth();
  const logoutRef = useRef(logout);
  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);
  const endOuterSession = useCallback(() => {
    setWide(false);
    logoutRef.current?.();
  }, []);

  // The framed app posts 'sh:session-ended' the moment its own
  // logout begins (see the client logout). Only THIS visual's own
  // wide frame may end the outer session — origin-checked and
  // source-checked, so no other frame or window can spoof it.
  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'sh:session-ended') return;
      const frame = wideFrameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      endOuterSession();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [endOuterSession]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Full-bleed stage below the desktop breakpoint: the stage is
  // measured against the viewport, so the framed page renders
  // at the reader's true width (360/390px phones included)
  // instead of the ~100px-narrower step column.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    const update = () => {
      if (window.innerWidth >= 1024) {
        setBleed(null);
        return;
      }
      const rect = node.getBoundingClientRect();
      setBleed({ width: document.documentElement.clientWidth, left: -rect.left });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const measure = useCallback(() => {
    const frame = frameRef.current;
    if (!frame || !visual.target) return;
    try {
      const doc = frame.contentDocument;
      const el = doc?.querySelector(visual.target);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const visible =
        rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.right > 0 &&
        rect.top < frame.clientHeight && rect.left < frame.clientWidth;
      setRing(visible
        ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        : null);
    } catch {
      /* same-origin by construction; a failure just skips the ring */
    }
  }, [visual.target]);

  const scheduleMeasure = useCallback(() => {
    if (measureRaf.current) return;
    measureRaf.current = window.requestAnimationFrame(() => {
      measureRaf.current = 0;
      measure();
    });
  }, [measure]);

  useEffect(() => () => {
    if (measureRaf.current) window.cancelAnimationFrame(measureRaf.current);
  }, []);

  const onFrameLoad = () => {
    const frame = frameRef.current;
    try {
      // The ring rides along when the reader pans inside the
      // picture: every frame scroll re-measures it.
      frame?.contentWindow?.addEventListener('scroll', scheduleMeasure, { passive: true });
    } catch {
      /* same-origin by construction */
    }
    if (!visual.target) return;
    window.setTimeout(() => {
      try {
        frame?.contentDocument?.querySelector(visual.target)?.scrollIntoView({ block: 'center' });
      } catch {
        /* the picture still shows; the ring is a bonus */
      }
      window.setTimeout(measure, 350);
    }, 900);
  };

  // Wheel over the picture scrolls the picture, not the lesson.
  useEffect(() => {
    const node = gestureRef.current;
    if (!node || !mounted) return undefined;
    const onWheel = (event) => {
      const win = frameRef.current?.contentWindow;
      if (!win) return;
      event.preventDefault();
      try {
        win.scrollBy({ left: event.deltaX, top: event.deltaY });
      } catch {
        /* the picture still shows */
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [mounted]);

  // While the wide view is open the lesson behind it holds
  // still, and Escape is a second way back.
  useEffect(() => {
    if (!wide) return undefined;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setWide(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.documentElement.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [wide]);

  const onWideLoad = () => {
    // The catch-all for a session that ended without the message
    // (expiry, a door the message missed): the framed app only
    // ever lands on /login when nobody is signed in — and if
    // nobody is signed in inside, nobody is signed in outside.
    try {
      if (wideFrameRef.current?.contentWindow?.location?.pathname === '/login') {
        endOuterSession();
        return;
      }
    } catch {
      /* same-origin by construction; a failure just skips the check */
    }
    if (!visual.target) return;
    window.setTimeout(() => {
      try {
        wideFrameRef.current?.contentDocument
          ?.querySelector(visual.target)
          ?.scrollIntoView({ block: 'center' });
      } catch {
        /* the page itself is the point of the wide view */
      }
    }, 900);
  };

  const onGesturePointerDown = (event) => {
    gesture.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is an enhancement; the deltas still track */
    }
  };

  const onGesturePointerMove = (event) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.lastX;
    const dy = event.clientY - current.lastY;
    current.lastX = event.clientX;
    current.lastY = event.clientY;
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
    current.moved = true;
    try {
      frameRef.current?.contentWindow?.scrollBy({ left: -dx, top: -dy });
    } catch {
      /* the picture still shows */
    }
  };

  const onGesturePointerUp = (event) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    if (!current.moved) setWide(true);
  };

  return (
    <span ref={wrapRef} className="relative mt-3 block h-[340px]">
      <span
        className="absolute inset-y-0 left-0 block w-full overflow-hidden rounded-lg bg-card"
        style={bleed ? { width: bleed.width, left: bleed.left } : undefined}
      >
        {mounted && (
          <iframe
            ref={frameRef}
            src={visualUrl(visual.route)}
            title={title}
            loading="lazy"
            className="pointer-events-none h-full w-full border-0"
            onLoad={onFrameLoad}
          />
        )}
        {ring && (
          <span
            data-visual-ring="true"
            className="pointer-events-none absolute rounded-md border-[3px] border-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.25)]"
            style={{
              top: Math.max(0, ring.top - 4),
              left: Math.max(0, ring.left - 4),
              width: ring.width + 8,
              height: ring.height + 8,
            }}
          />
        )}
        {mounted && (
          <span
            ref={gestureRef}
            data-visual-gesture="true"
            data-pull-refresh-ignore="true"
            className="absolute inset-0 block touch-none"
            onPointerDown={onGesturePointerDown}
            onPointerMove={onGesturePointerMove}
            onPointerUp={onGesturePointerUp}
            onPointerCancel={() => { gesture.current = null; }}
          />
        )}
        <button
          type="button"
          onClick={() => setWide(true)}
          aria-label={t('training.visualOpen')}
          title={t('training.visualOpen')}
          className="absolute right-2 top-2 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card/95 text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </button>
        {/* The picture's frame line is an overlay, not the
            stage's own border: a border would shave 2px off the
            framed page's width, and the page inside must render
            at the reader's exact viewport width. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-lg border border-border" />
      </span>
      {wide && createPortal(
        <div
          data-visual-wide="true"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-50 flex flex-col bg-background"
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
            <button
              type="button"
              onClick={() => setWide(false)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" /> {t('training.visualClose')}
            </button>
          </div>
          <iframe
            ref={wideFrameRef}
            src={visualUrl(visual.route)}
            title={title}
            className="min-h-0 w-full flex-1 border-0"
            onLoad={onWideLoad}
          />
        </div>,
        document.body,
      )}
    </span>
  );
}
