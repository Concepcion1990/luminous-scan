import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { dataVersion, subscribeData } from '@/lib/dataFreshness';

/**
 * Keeps a kept-alive screen honest (Nov 14, 2026): remembers the
 * data version the screen last rendered; when the screen becomes
 * the active route and the version has moved since, it calls the
 * screen's own refetch (its existing reload knob). A bump that
 * lands while the screen is already active refetches immediately.
 * Screens that remount on navigation can use it too — for them
 * only the while-active branch matters.
 *
 * One shared inventory truth is the standard (the owner's words:
 * the pages must be "reading each other"): local mutations travel
 * through the version, and because a change can also arrive with
 * no local mutation at all (a till sale landing by webhook), a
 * screen that has been away a while refetches on return even when
 * the version never moved — STALE_AFTER_MS of grace, no polling.
 */
const STALE_AFTER_MS = 30_000;

export default function useDataFresh(scope, routePath, refetch) {
  const { pathname } = useLocation();
  const seen = useRef(dataVersion(scope));
  const syncedAt = useRef(Date.now());
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const active = pathname === routePath;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!active) return;
    const v = dataVersion(scope);
    if (v !== seen.current || Date.now() - syncedAt.current > STALE_AFTER_MS) {
      seen.current = v;
      syncedAt.current = Date.now();
      refetchRef.current?.();
    }
  }, [active, scope]);

  useEffect(
    () =>
      subscribeData(scope, () => {
        if (activeRef.current) {
          seen.current = dataVersion(scope);
          syncedAt.current = Date.now();
          refetchRef.current?.();
        }
      }),
    [scope],
  );
}

// Pages import this hook both ways across the app; both forms
// name the same function.
export { useDataFresh };
