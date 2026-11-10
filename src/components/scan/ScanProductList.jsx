import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/client';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatMoney, listProducts } from '@/lib/inventory';
import { buildLocationTree, descendantIds, locationPath } from '@/lib/locations';
import { scoped } from '@/lib/scoped';

/**
 * What is stored at the place chosen in the scan station: name, price and the
 * exact shelf or bin each unit sits on. A store shows everything inside it.
 */
const ScanProductList = forwardRef(function ScanProductList(
  { locations = [], locationId = '', businessId = '', currency = 'USD', onOpenProduct },
  ref
) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState([]);
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const latestRequest = useRef(0);

  const ids = useMemo(
    () => (locationId ? descendantIds(locations, locationId) : []),
    [locations, locationId]
  );
  const { byId } = useMemo(() => buildLocationTree(locations), [locations]);
  const placeName = locations.find((l) => l.id === locationId)?.name || 'all locations';

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Also expose a promise-backed refresh to the Scan page so the gesture
  // stays busy until the current search and stock quantities have reloaded.
  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    setLoadError('');
    try {
      const query = ids.length ? { location_id: { $in: ids } } : {};
      const [products, levelPage] = await Promise.all([
        listProducts({ search: debounced, locationIds: ids, limit: 100, businessId }),
        base44.entities.StockLevel.filter(scoped(query, businessId), { limit: 2000 }),
      ]);
      if (latestRequest.current !== request) return;
      setItems(products);
      setLevels(levelPage.items ?? []);
    } catch (error) {
      if (latestRequest.current === request) {
        setLoadError('Could not load products. Pull down to try again.');
      }
      throw error;
    } finally {
      if (latestRequest.current === request) setLoading(false);
    }
  }, [debounced, ids, businessId]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  useEffect(() => {
    refresh().catch(() => {});
    return () => { latestRequest.current += 1; };
  }, [refresh]);

  const stockByProduct = useMemo(() => {
    const map = new Map();
    levels.forEach((level) => {
      if ((level.quantity || 0) <= 0) return;
      const path = locationPath(byId.get(level.location_id), byId);
      if (!path) return;
      map.set(level.product_id, [...(map.get(level.product_id) || []), { path, quantity: level.quantity }]);
    });
    return map;
  }, [levels, byId]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">On the shelf</p>
          <h2 className="mt-1 text-base font-semibold">Products at {placeName}</h2>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, SKU or code"
            className="h-9 pl-8"
          />
        </div>
      </div>

      {loading && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading products…</p>}
      {loadError && <p role="alert" className="px-4 py-2 text-xs text-destructive">{loadError}</p>}

      {!loading && items.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {debounced ? 'No products match that search.' : 'Nothing is stored here yet.'}
        </p>
      )}

      <div className="divide-y divide-border">
        {items.map((product) => {
          const stock = stockByProduct.get(product.id) || [];
          return (
            <div key={product.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenProduct?.(product)}
                  className="block truncate text-left text-sm font-medium underline-offset-2 hover:underline"
                >
                  {product.name}
                </button>
                <p className="numeric text-[11px] text-muted-foreground">{product.sku}</p>
                <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  {stock.length === 0 && <span>Not counted here</span>}
                  {stock.map((entry) => (
                    <span key={entry.path}>
                      {entry.path} · <span className="numeric font-semibold text-foreground">{entry.quantity}</span>
                    </span>
                  ))}
                </p>
              </div>
              <span className="numeric shrink-0 text-sm font-semibold">{formatMoney(product.price, currency)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default ScanProductList;