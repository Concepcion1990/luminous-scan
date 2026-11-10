import { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reversalBlocker, reverseMovement } from '@/lib/inventory';
import { BUNDLE_MOVEMENT_TYPES } from '@/lib/plans';
import { scoped } from '@/lib/scoped';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import PullToRefresh from '@/components/mobile/PullToRefresh';
import { localTimeZoneName } from '@/lib/dates';
import MovementRow from '@/components/movements/MovementRow';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';

const ADJUSTMENT_TYPES = ['returned', 'damaged', 'lost', 'found', 'write_off', 'correction'];

export default function Movements() {
  const { activeId } = useBusiness();
  // Bundle movement types are Business-only: the four options stay hidden
  // while the plan is still loading as well as on Essentials, so a Business
  // account never briefly offers — or loses — them the way the limits did.
  const { isEssentials, isLoading: entitlementLoading } = useEntitlements();
  const showBundleTypes = !isEssentials && !entitlementLoading;
  const [movements, setMovements] = useState([]);
  const [locations, setLocations] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef(null);
  const [type, setType] = useState('all');
  const [locationId, setLocationId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState('');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    base44.entities.Location
      .filter(scoped({}, activeId), { sort: 'name', limit: 100 })
      .then((p) => setLocations(p.items ?? []));
  }, [activeId]);

  // The ledger reads 100 rows at a time, newest first, and says so: older
  // movements are one tap away instead of silently unreachable.
  const load = useCallback(async ({ silent = false, append = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const query = {};
      if (type === 'adjust') query.type = { $in: ADJUSTMENT_TYPES };
      else if (type !== 'all') query.type = type;
      if (locationId !== 'all') query.location_id = locationId;
      const page = await base44.entities.StockMovement.filter(scoped(query, activeId), {
        sort: '-created_date',
        limit: 100,
        ...(append && cursorRef.current ? { cursor: cursorRef.current } : {}),
      });
      const items = page.items ?? [];
      cursorRef.current = page.next_cursor || null;
      setHasMore(Boolean(page.next_cursor));
      setMovements((current) => (append ? [...current, ...items] : items));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [type, locationId, activeId]);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      await load({ silent: true, append: true });
    } finally {
      setLoadingMore(false);
    }
  };

  // Refresh the filtered ledger and locations without resetting selections.
  const refresh = useCallback(async () => {
    const [_, locationPage] = await Promise.all([
      load({ silent: true }),
      base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
    ]);
    setLocations(locationPage.items ?? []);
  }, [activeId, load]);

  useEffect(() => {
    load();
  }, [load]);

  // A bundle filter picked on Business must not linger once the plan is
  // known to be Essentials (or while it is still loading).
  useEffect(() => {
    if (isEssentials && BUNDLE_MOVEMENT_TYPES.includes(type)) setType('all');
  }, [isEssentials, type]);

  // The filter offers every type the plan can record. The four bundle types
  // sit last, exactly as before, but only on Business.
  const typeOptions = [
    { value: 'all', label: 'All movements' },
    { value: 'receive', label: 'Received' },
    { value: 'sale', label: 'Sold' },
    { value: 'count', label: 'Counts' },
    { value: 'transfer', label: 'Transfers out' },
    { value: 'transfer_in', label: 'Transfers in' },
    { value: 'adjust', label: 'Adjustments (all)' },
    { value: 'returned', label: 'Returned' },
    { value: 'damaged', label: 'Damaged' },
    { value: 'lost', label: 'Lost' },
    { value: 'found', label: 'Found' },
    { value: 'write_off', label: 'Written off' },
    { value: 'correction', label: 'Corrections' },
    { value: 'reserved', label: 'Held' },
    { value: 'released', label: 'Released' },
    ...(showBundleTypes
      ? [
          { value: 'consume', label: 'Consumed (builds)' },
          { value: 'produce', label: 'Built' },
          { value: 'disassemble', label: 'Taken apart' },
          { value: 'recovered', label: 'Parts recovered' },
        ]
      : []),
  ];

  const reversedIds = new Set(movements.map((m) => m.reversal_of_id).filter(Boolean));

  const confirmReverse = async (movement) => {
    setBusyId(movement.id);
    setError('');
    setFlash('');
    try {
      const { next } = await reverseMovement(movement, user, activeId || '');
      setPendingId('');
      setFlash(
        `Reversed · ${movement.product_name} now ${next} at ${movement.location_name}. The original entry stays in the ledger.`
      );
      await load();
    } catch (err) {
      setError(err?.message || 'Could not reverse this movement.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <PullToRefresh className="space-y-5" onRefresh={refresh} disabled={Boolean(busyId)}>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Ledger</p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Movements</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every scan, count and transfer, in the order it happened · times shown in{' '}
          {localTimeZoneName() || 'your local time'}.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <ResponsiveSelect
          title="Choose movement type"
          ariaLabel="Filter movements by type"
          value={type}
          onValueChange={setType}
          className="w-[170px] bg-card"
          options={typeOptions}
        />
        <ResponsiveSelect
          title="Choose a location"
          ariaLabel="Filter movements by location"
          value={locationId}
          onValueChange={setLocationId}
          className="w-[200px] bg-card"
          options={[
            { value: 'all', label: 'All locations' },
            ...locations.map((l) => ({ value: l.id, label: l.name })),
          ]}
        />
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /> {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading ledger…</p>}

        {!loading && movements.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-sm font-medium">No movements yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Scan an item to record your first one.</p>
          </div>
        )}

        <div className="divide-y divide-border">
          {!loading &&
            movements.map((m) => (
              <MovementRow
                key={m.id}
                movement={m}
                reversed={reversedIds.has(m.id)}
                blocker={pendingId === m.id ? reversalBlocker(m) : ''}
                confirming={pendingId === m.id}
                busy={busyId === m.id}
                onAskReverse={() => {
                  setError('');
                  setFlash('');
                  setPendingId(m.id);
                }}
                onConfirmReverse={() => confirmReverse(m)}
                onCancelReverse={() => setPendingId('')}
              />
            ))}
        </div>

        {!loading && movements.length > 0 && (
          <div className="border-t border-border px-4 py-3 text-center">
            <p className="text-xs text-muted-foreground">
              {hasMore
                ? `Showing the ${movements.length} most recent movements`
                : `Showing all ${movements.length} movement${movements.length === 1 ? '' : 's'} in this view`}
            </p>
            {hasMore && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}