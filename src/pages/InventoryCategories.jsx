import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Search } from 'lucide-react';
import { formatMoney, loadInventory } from '@/lib/inventory';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import ProductThumb from '@/components/products/ProductThumb';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const UNCATEGORIZED = 'Uncategorized';

/**
 * Every product in the business, gathered under the category it is filed in, with
 * what that category is worth and what is running low inside it.
 */
export default function InventoryCategories() {
  const { activeId, profile } = useBusiness();
  const { can, isLoading: entitlementLoading } = useEntitlements();
  // AUDIT FINDING 5: the category header printed the money value of each
  // category — stock valuation, a Business-only feature — while the route
  // itself is ungated. Hide the money line on Essentials and keep the
  // units and low counts, which are passive counts (core, by design). The
  // route stays open: gating the whole page would take the category
  // browsing away from Essentials. While the plan is still loading the
  // money stays hidden rather than flashing to an Essentials account.
  const showValue = !entitlementLoading && can('valuation');
  const [inventory, setInventory] = useState(null);
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [openKey, setOpenKey] = useState('');

  const load = useCallback(() => {
    if (!activeId) return;
    return loadInventory(activeId).then(setInventory);
  }, [activeId]);

  useEffect(() => {
    setInventory(null);
    setOpenKey('');
    setLocationId('');
    load();
  }, [load]);

  const groups = useMemo(() => {
    if (!inventory) return [];
    const term = search.trim().toLowerCase();
    // A chosen location scopes every number on the page to that place, and drops the
    // products never stocked there so a category shows what it actually holds.
    const levels = inventory.levels.filter((level) => !locationId || level.location_id === locationId);
    const qtyByProduct = new Map();
    levels.forEach((level) => {
      qtyByProduct.set(level.product_id, (qtyByProduct.get(level.product_id) || 0) + (level.quantity || 0));
    });

    const byCategory = new Map();
    inventory.products
      .filter((product) => product.status !== 'archived')
      .filter((product) => !locationId || qtyByProduct.has(product.id))
      .filter((product) => !term || String(product.name || '').toLowerCase().includes(term) || String(product.sku || '').toLowerCase().includes(term))
      .forEach((product) => {
        const key = String(product.category || '').trim() || UNCATEGORIZED;
        if (!byCategory.has(key)) byCategory.set(key, []);
        const onHand = qtyByProduct.get(product.id) || 0;
        byCategory.get(key).push({
          product,
          onHand,
          low: (product.reorder_point || 0) > 0 && onHand <= product.reorder_point,
        });
      });

    return [...byCategory.entries()]
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => a.product.name.localeCompare(b.product.name)),
        units: items.reduce((sum, item) => sum + item.onHand, 0),
        value: items.reduce((sum, item) => sum + item.onHand * (item.product.cost || 0), 0),
        low: items.filter((item) => item.low).length,
      }))
      .sort((a, b) => {
        if (a.name === UNCATEGORIZED) return 1;
        if (b.name === UNCATEGORIZED) return -1;
        return a.name.localeCompare(b.name);
      });
  }, [inventory, search, locationId]);

  const totalUnits = groups.reduce((sum, group) => sum + group.units, 0);
  const locations = inventory?.locations ?? [];

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('inventory.byCategoryEyebrow')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('inventory.byCategoryTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {showValue
            ? t('inventory.byCategorySubtitleValue')
            : t('inventory.byCategorySubtitleUnits')}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('inventory.byCategorySearch')}
            className="pl-8"
          />
        </div>
        <Select
          value={locationId || 'all'}
          onValueChange={(value) => setLocationId(value === 'all' ? '' : value)}
        >
          <SelectTrigger className="sm:w-52">
            <SelectValue placeholder={t('inventory.allLocations')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('inventory.allLocations')}</SelectItem>
            {locations.map((location) => (
              <SelectItem key={location.id} value={location.id}>
                {location.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {t('inventory.categorySummary', {
            count: groups.length,
            categoryWord: groups.length === 1 ? t('inventory.categorySingular') : t('inventory.categoryPlural'),
            units: totalUnits,
          })}
        </p>
      </div>

      {inventory === null ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {t('inventory.categoriesLoading')}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {inventory.products.length === 0 ? (
            <>
              {t('inventory.emptyNoProducts')}{' '}
              <Link to="/products" className="underline underline-offset-2 hover:text-foreground">
                {t('inventory.byCategoryAddProducts')}
              </Link>{' '}
              {t('inventory.byCategoryAddSuffix')}
            </>
          ) : search.trim() ? (
            t('inventory.emptyNoMatch')
          ) : (
            t('inventory.byCategoryEmptyLocation')
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const open = openKey === group.name;
            return (
              <div key={group.name} className="overflow-hidden rounded-xl border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setOpenKey(open ? '' : group.name)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60"
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{group.name === UNCATEGORIZED ? t('inventory.uncategorized') : group.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      {t('inventory.groupProductCount', {
                        count: group.items.length,
                        word: group.items.length === 1 ? t('inventory.productSingular') : t('inventory.productPlural'),
                      })}
                      {group.low ? t('inventory.groupLowSuffix', { low: group.low }) : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="numeric text-sm font-semibold">{group.units}</p>
                    {showValue && (
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {formatMoney(group.value, profile.currency, 2)}
                      </p>
                    )}
                  </div>
                </button>

                {open && (
                  <div className="border-t border-border">
                    {group.items.map(({ product, onHand, low }) => (
                      <div
                        key={product.id}
                        className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
                      >
                        <ProductThumb product={product} className="h-9 w-9" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{product.name}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {product.sku || t('inventory.noSku')}
                            {product.subcategory ? ` · ${product.subcategory}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`numeric text-sm font-semibold ${low ? 'text-warn' : ''}`}>{onHand}</p>
                          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                            {low ? t('inventory.reorderLabel', { point: product.reorder_point }) : t('inventory.onHand')}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div className="px-4 py-2 text-right">
                      <Link
                        to="/inventory"
                        className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        {t('inventory.adjustStock')}
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}