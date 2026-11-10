import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { loadInventory, productTruncationNotice } from '@/lib/inventory';
import { useBusiness } from '@/hooks/useBusiness';
import { useOfflineSync } from '@/hooks/useOfflineSync';
import SyncIndicator from '@/components/sync/SyncIndicator';
import PullToRefresh from '@/components/mobile/PullToRefresh';
import StatCard from '@/components/StatCard';
import InventoryRow from '@/components/inventory/InventoryRow';
import AdjustStockDialog from '@/components/inventory/AdjustStockDialog';
import { Input } from '@/components/ui/input';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import { t } from '@/lib/i18n';


/**
 * The stock this business actually holds, by product and place, with a one-step
 * adjustment for each line. Products come from the catalog, quantities from the
 * per-location stock records.
 */
export default function Inventory() {
  const { activeId, record } = useBusiness();
  // T6: the manager's live view — the convergence check re-reads when
  // the server version moves (a phone's queued work just landed).
  const sync = useOfflineSync(activeId, { onConverged: () => load() });
  const [inventory, setInventory] = useState(null);
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [adjusting, setAdjusting] = useState(null);

  const load = useCallback(() => {
    if (!activeId) return;
    return loadInventory(activeId).then(setInventory);
  }, [activeId]);

  useEffect(() => {
    setInventory(null);
    setLocationId('');
    load();
  }, [load]);

  const products = useMemo(
    () => (inventory?.products ?? []).filter((product) => product.status !== 'archived'),
    [inventory]
  );
  const locations = inventory?.locations ?? [];

  const scopedLevels = useMemo(
    () =>
      (inventory?.levels ?? []).filter((level) => !locationId || level.location_id === locationId),
    [inventory, locationId]
  );

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .map((product) => ({
        product,
        own: scopedLevels.filter((level) => level.product_id === product.id),
      }))
      .filter(({ product }) => {
        if (!term) return true;
        return [product.name, product.sku, product.category]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      });
  }, [products, scopedLevels, search]);

  const units = scopedLevels.reduce((sum, level) => sum + (level.quantity || 0), 0);
  const stocked = rows.filter((row) => row.own.some((level) => (level.quantity || 0) > 0)).length;
  const low = rows.filter(({ product, own }) => {
    if (!product.reorder_point) return false;
    return own.reduce((sum, level) => sum + (level.quantity || 0), 0) <= product.reorder_point;
  }).length;

  return (
    <PullToRefresh className="space-y-5" onRefresh={load}>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {record?.name || t('inventory.thisBusiness')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('inventory.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('inventory.subtitle')}
        </p>
      </div>

      <SyncIndicator sync={sync} />

      {inventory === null ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {t('inventory.loading')}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t('inventory.statUnits')} value={units} unit={t('inventory.unitUnits')} />
            <StatCard label={t('inventory.statStocked')} value={stocked} unit={t('inventory.ofProducts', { count: products.length })} />
            <StatCard label={t('inventory.statLow')} value={low} tone={low ? 'warn' : 'default'} hint={t('inventory.lowHint')} />
            <StatCard label={t('inventory.statLocations')} value={locations.length} unit={t('inventory.unitPlaces')} />
          </div>

          {productTruncationNotice(inventory?.products?.length ?? 0, inventory?.productTotal ?? 0) && (
            <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
              {productTruncationNotice(inventory?.products?.length ?? 0, inventory?.productTotal ?? 0)}{' '}
              {t('inventory.truncationSuffix')}
            </p>
          )}

          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:px-4">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('inventory.searchPlaceholder')}
                  className="pl-8"
                />
              </div>
              <ResponsiveSelect
                title={t('inventory.locationTitle')}
                ariaLabel={t('inventory.locationAria')}
                className="sm:w-52"
                value={locationId || 'all'}
                onValueChange={(value) => setLocationId(value === 'all' ? '' : value)}
                options={[
                  { value: 'all', label: t('inventory.allLocations') },
                  ...locations.map((location) => ({ value: location.id, label: location.name })),
                ]}
              />
            </div>

            {rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                {products.length === 0 ? (
                  <>
                    {t('inventory.emptyNoProducts')}{' '}
                    <Link to="/products" className="underline underline-offset-2 hover:text-foreground">
                      {t('inventory.emptyAddProduct')}
                    </Link>{' '}
                    {t('inventory.emptyAddProductSuffix')}
                  </>
                ) : (
                  t('inventory.emptyNoMatch')
                )}
              </div>
            ) : (
              <div>
                {rows.map(({ product, own }) => (
                  <InventoryRow
                    key={product.id}
                    product={product}
                    levels={own}
                    locations={locations}
                    onAdjust={setAdjusting}
                  />
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {t('inventory.footerLead')}{' '}
            <Link to="/products" className="underline underline-offset-2 hover:text-foreground">
              {t('inventory.footerOpenProducts')}
            </Link>
            {t('inventory.footerMiddle')}{' '}
            <Link to="/movements" className="underline underline-offset-2 hover:text-foreground">
              {t('inventory.footerMovements')}
            </Link>
            .
          </p>
        </>
      )}

      <AdjustStockDialog
        open={Boolean(adjusting)}
        onOpenChange={(open) => !open && setAdjusting(null)}
        product={adjusting}
        locations={locations}
        businessId={activeId || ''}
        defaultLocationId={locationId}
        onDone={load}
      />
    </PullToRefresh>
  );
}