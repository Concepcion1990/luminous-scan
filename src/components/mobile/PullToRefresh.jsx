import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { t } from '@/lib/i18n';

const MOBILE_QUERY = '(max-width: 1023px)';
const TRIGGER_DISTANCE = 56;
const IGNORE_TARGETS =
  'button, a, input, textarea, select, [role="button"], [contenteditable="true"], [data-pull-refresh-ignore]';

function hasOpenOverlay() {
  return Boolean(document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-vaul-drawer][data-state="open"]'
  ));
}

function insideScrollableRegion(target, boundary) {
  let element = target instanceof Element ? target : null;
  while (element && element !== boundary) {
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

/**
 * Mobile-only, read-only refresh gesture. Never prevents default touch events,
 * so normal scrolling and desktop interaction keep working.
 * The parent supplies the exact data-fetch function; no page reload occurs.
 */
export default function PullToRefresh({ children, className = '', onRefresh, disabled = false }) {
  const gesture = useRef(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const refreshRef = useRef(onRefresh);
  const [distance, setDistance] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  refreshRef.current = onRefresh;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reset = () => {
    gesture.current = null;
    setDragging(false);
    setDistance(0);
  };

  const onTouchStart = (event) => {
    gesture.current = null;
    if (
      disabled ||
      busy.current ||
      event.touches.length !== 1 ||
      !window.matchMedia(MOBILE_QUERY).matches ||
      window.scrollY > 2 ||
      document.documentElement.scrollTop > 2 ||
      hasOpenOverlay()
    ) return;

    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest(IGNORE_TARGETS) ||
      insideScrollableRegion(target, event.currentTarget)
    ) return;

    setError('');
    const touch = event.touches[0];
    gesture.current = { x: touch.clientX, y: touch.clientY, distance: 0 };
  };

  const onTouchMove = (event) => {
    const current = gesture.current;
    if (!current || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - current.x;
    const dy = touch.clientY - current.y;
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 2) {
      reset();
      return;
    }
    if (dy < 10) return;
    const nextDistance = Math.min(88, dy * 0.5);
    current.distance = nextDistance;
    setDistance(nextDistance);
    setDragging(true);
  };

  const onTouchEnd = () => {
    const shouldRefresh = gesture.current?.distance >= TRIGGER_DISTANCE;
    reset();
    if (!shouldRefresh || busy.current || disabled) return;

    busy.current = true;
    setRefreshing(true);
    Promise.resolve()
      .then(() => refreshRef.current?.())
      .catch(() => {
        if (mounted.current) setError(t('layout.refresh.failed'));
      })
      .finally(() => {
        busy.current = false;
        if (mounted.current) setRefreshing(false);
      });
  };

  const offset = refreshing ? 44 : distance;
  return (
    <div
      className="relative"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={reset}
    >
      {(dragging || refreshing || Boolean(error)) && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center lg:hidden"
          role="status"
          aria-live="polite"
          style={{ transform: `translateY(${Math.max(0, offset - 36)}px)` }}
        >
          <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm">
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            {error || (refreshing ? t('layout.refresh.refreshing') : distance >= TRIGGER_DISTANCE ? t('layout.refresh.release') : t('layout.refresh.pull'))}
          </span>
        </div>
      )}
      <div
        className={className}
        style={{
          transform: offset > 0 ? `translateY(${offset}px)` : undefined,
          transition: dragging ? 'none' : 'transform 160ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
