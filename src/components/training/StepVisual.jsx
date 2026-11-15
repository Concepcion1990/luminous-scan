import { useEffect, useRef, useState } from 'react';
import { visualUrl } from '@/lib/embedMode';

// A lesson step's visual (Nov 15, 2026): the app's OWN page,
// rendered live by the app itself inside a frame — the reader's
// session, the reader's language, the reader's real data — with
// a ring on the control the step is about. Never a drawing,
// never another app, never a stored screenshot that can go
// stale. The frame is inert (pointer-events: none): it is a
// picture of the screen, and the lesson's words stay the
// instructions. Steps whose screen only exists mid-flow carry a
// DOOR visual — the page and the button that starts the flow —
// and steps with no screen action carry none at all; both are
// recorded in the build report for the owner's ruling.
export default function StepVisual({ visual, title }) {
  const wrapRef = useRef(null);
  const frameRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [ring, setRing] = useState(null);

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

  const measure = () => {
    const frame = frameRef.current;
    if (!frame || !visual.target) return;
    try {
      const doc = frame.contentDocument;
      const el = doc?.querySelector(visual.target);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      window.setTimeout(() => {
        try {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            setRing({
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            });
          }
        } catch {
          /* the picture still shows; the ring is a bonus */
        }
      }, 350);
    } catch {
      /* same-origin by construction; a failure just skips the ring */
    }
  };

  return (
    <span
      ref={wrapRef}
      className="relative mt-3 block h-[340px] overflow-hidden rounded-lg border border-border bg-card"
      aria-hidden="true"
    >
      {mounted && (
        <iframe
          ref={frameRef}
          src={visualUrl(visual.route)}
          title={title}
          loading="lazy"
          className="pointer-events-none h-full w-full border-0"
          onLoad={() => window.setTimeout(measure, 900)}
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
    </span>
  );
}
