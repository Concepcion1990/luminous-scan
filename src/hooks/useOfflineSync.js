/**
 * useOfflineSync — T6. The hook behind the sync indicator.
 *
 * - Listens for the browser's online/offline events and flushes the
 *   queued work the moment the connection returns (fast on reconnect).
 * - Polls the server's sync state while online and visible (every 20
 *   seconds — the live-update choice for the website: polling with a
 *   last-seen version, no long-lived connection to drop). When the
 *   version moves and nothing is queued, the caller re-reads its data
 *   (the manager's desktop catches up with no gaps).
 * - Exposes the visible status the phone must show: online/offline,
 *   how many changes are still sending, how many failed, and the last
 *   server version seen (the convergence check).
 *
 * The hook never re-scans or re-sends on its own: flushing only ever
 * sends what is already queued, and the server dedupes replays.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getOfflineQueue } from '@/lib/offlineQueue';
import { flushQueue, fetchSyncState } from '@/lib/syncClient';

const POLL_MS = 20_000;

function summarize(queueRows) {
  const pending = queueRows.filter((c) => c.status === 'pending' || c.status === 'sending');
  const failed = queueRows.filter((c) => c.status === 'failed');
  return { pending: pending.length, failed: failed.length, total: queueRows.length };
}

export function useOfflineSync(businessId, { onConverged = null } = {}) {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );
  const [queue, setQueue] = useState({ pending: 0, failed: 0, total: 0 });
  const [serverVersion, setServerVersion] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [flushing, setFlushing] = useState(false);
  const versionRef = useRef(null);
  const businessRef = useRef(businessId);
  businessRef.current = businessId;
  const convergedRef = useRef(onConverged);
  convergedRef.current = onConverged;

  const refreshQueue = useCallback(async () => {
    try {
      const rows = (await getOfflineQueue().all()).filter((c) => c.businessId === businessRef.current);
      setQueue(summarize(rows));
      return rows;
    } catch {
      return [];
    }
  }, []);

  const flush = useCallback(async () => {
    if (!businessRef.current || typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    setFlushing(true);
    try {
      const summary = await flushQueue(getOfflineQueue(), businessRef.current);
      await refreshQueue();
      if (summary.confirmed > 0 || summary.duplicates > 0) setLastSyncedAt(new Date().toISOString());
      return summary;
    } finally {
      setFlushing(false);
    }
  }, [refreshQueue]);

  const checkState = useCallback(async () => {
    if (!businessRef.current || typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    try {
      const state = await fetchSyncState(businessRef.current);
      const previous = versionRef.current;
      versionRef.current = state.version;
      setServerVersion(state.version);
      // The server state moved while we had nothing queued: the
      // manager's view re-reads (convergence), it does not guess.
      if (previous !== null && previous !== state.version) {
        await refreshQueue();
        convergedRef.current?.(state);
      }
      return state;
    } catch {
      return null;
    }
  }, [refreshQueue]);

  // Online/offline: flush the moment the connection returns.
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      flush().then(() => checkState());
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [flush, checkState]);

  // First paint reads the queue + server state without blocking it:
  // the page renders from cache/local state first, sync follows.
  useEffect(() => {
    refreshQueue();
    checkState();
  }, [businessId, refreshQueue, checkState]);

  // Poll the server version while online and the tab is visible.
  useEffect(() => {
    if (!online) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') checkState();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [online, checkState]);

  return {
    online,
    pending: queue.pending,
    failed: queue.failed,
    queuedTotal: queue.total,
    flushing,
    serverVersion,
    lastSyncedAt,
    flush,
    refreshQueue,
    checkState,
  };
}
