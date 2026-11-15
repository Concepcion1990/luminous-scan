import { useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/client';
import useDataFresh from '@/hooks/useDataFresh';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Pencil, Plus, Search } from 'lucide-react';
import SortHeader from '@/components/products/SortHeader';
import ProductThumb from '@/components/products/ProductThumb';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import ProductFormDialog from '@/components/products/ProductFormDialog';
import ProductPrice from '@/components/products/ProductPrice';
import ExportCsvButton from '@/components/products/ExportCsvButton';
import CopyGroupPanel from '@/components/products/CopyGroupPanel';
import ProductFilterBar, { EMPTY_FILTERS } from '@/components/products/ProductFilterBar';
import BulkEditDialog from '@/components/products/BulkEditDialog';
import ProductRowMenu from '@/components/products/ProductRowMenu';
import AdjustStockDialog from '@/components/inventory/AdjustStockDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useBusiness } from '@/hooks/useBusiness';
import { useCatalogVocabulary } from '@/hooks/useCatalogVocabulary';
import { formatMoney, listProducts, recordMovement } from '@/lib/inventory';
import { descendantIds, orderedLocations } from '@/lib/locations';
import { scoped } from '@/lib/scoped';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import useEntitlements from '@/hooks/useEntitlements';
import { displayLimit } from '@/lib/plans';
import useIsDesktop from '@/hooks/useIsDesktop';
import useModalHistory from '@/hooks/useModalHistory';
import LimitBadge from '@/components/plan/LimitBadge';
import { createProducts } from '@/lib/entitlements';
import { t } from '@/lib/i18n';

/**
 * The little up/down stepper beside an on-hand number (Nov 14,
 * 2026 — the interaction the owner missed from the old app). Each
 * tap is a real ledger movement recorded by the caller; the down
 * arrow is disabled at zero so a count can never be tapped below
 * nothing.
 */
function InlineStockStepper({ value, busy, onStep, addLabel, removeLabel }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        aria-label={addLabel}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onStep(1);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <span className="numeric min-w-6 text-center text-sm font-semibold">{value}</span>
      <button
        type="button"
        aria-label={removeLabel}
        disabled={busy || value <= 0}
        onClick={(e) => {
          e.stopPropagation();
          onStep(-1);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

export default function Products() {
  const { user } = useAuth();
  const { profile, activeId } = useBusiness();
  const { limits, isLoading: entitlementLoading } = useEntitlements();
  const { toast } = useToast();
  const isDesktop = useIsDesktop();
  const { open: dialogOpen, onOpenChange: setDialogOpen } = useModalHistory({
    modalId: 'product-form',
    routePath: '/products',
    mobile: !isDesktop,
  });
  const [items, setItems] = useState([]);
  const [levels, setLevels] = useState([]);
  const [locations, setLocations] = useState([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [facets, setFacets] = useState({ categories: [], tags: [] });
  const vocabulary = useCatalogVocabulary(activeId);
  const [loading, setLoading] = useState(true);
  // Which business has completed a load here. A background refetch
  // (freshness bus, filter change) must never blank a list that
  // already has content — the loading state is only for the first
  // load of a business, when there is nothing to show yet (owner
  // ruling, Nov 14, 2026: a stepper tap flashed "Loading catalog…").
  const loadedForRef = useRef('');
  const [expanded, setExpanded] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [seed, setSeed] = useState(null);
  const [reload, setReload] = useState(0);
  // Kept alive in a hidden tab layer: if inventory changed on
  // another screen (a product created from Scan, a stock movement),
  // refetch through the same reload knob when this page is shown —
  // the customer never has to pull-to-refresh to see their change.
  useDataFresh('inventory', '/products', () => setReload((r) => r + 1));
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [activeCount, setActiveCount] = useState(0);

  const SORT_OPTIONS = [
    { value: 'name', label: t('products.sortName') },
    { value: 'codes', label: t('products.sortCodes') },
    { value: 'category', label: t('products.sortCategory') },
    { value: 'onHand', label: t('products.sortOnHand') },
    { value: 'reorder', label: t('products.sortReorder') },
    { value: 'price', label: t('products.sortPrice') },
  ];

  // The allowance counts distinct sellable records, never physical units.
  // While the entitlement row is still loading the cap is unknown (null),
  // never the Essentials 50: a Business catalog over 50 products briefly
  // showed "50 of 50" and blocked adding before its own plan had loaded.
  const productLimit = displayLimit(limits.products, entitlementLoading);
  const atProductLimit = productLimit != null && activeCount >= productLimit;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setFilters(EMPTY_FILTERS);
  }, [activeId]);

  useEffect(() => {
    (async () => {
      if (loadedForRef.current !== activeId) setLoading(true);
      const isUnfiltered =
        !debounced.trim() &&
        !filters.category &&
        !filters.tag &&
        !filters.status &&
        !filters.condition &&
        !filters.locationId;
      const [products, levelPage, locPage, totalActive] = await Promise.all([
        listProducts({
          search: debounced,
          category: filters.category,
          tag: filters.tag,
          status: filters.status,
          condition: filters.condition,
          locationId: filters.locationId,
          // A store filter covers the shelves and bins inside it.
          locationIds: filters.locationId ? descendantIds(locations, filters.locationId) : [],
          limit: 200,
          businessId: activeId || '',
        }),
        base44.entities.StockLevel.filter(scoped({}, activeId), { limit: 2000 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
        base44.entities.Product.count(scoped({ status: { $ne: 'archived' } }, activeId)),
      ]);
      setActiveCount(totalActive);
      setItems(products);
      setSelected([]);
      if (isUnfiltered) {
        setFacets({
          categories: [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
          tags: [...new Set(products.flatMap((p) => p.tags || []))].sort(),
        });
      }
      setLevels(levelPage.items ?? []);
      setLocations(locPage.items ?? []);
      loadedForRef.current = activeId;
      setLoading(false);
    })();
  }, [
    debounced,
    reload,
    activeId,
    filters.category,
    filters.tag,
    filters.status,
    filters.condition,
    filters.locationId,
  ]);

  // A location filter reports on-hand for that place and everything nested in it.
  const filterLocationIds = useMemo(
    () => (filters.locationId ? new Set(descendantIds(locations, filters.locationId)) : null),
    [filters.locationId, locations]
  );

  const shownLevels = useMemo(
    () =>
      filterLocationIds
        ? levels.filter((level) => filterLocationIds.has(level.location_id))
        : levels,
    [levels, filterLocationIds]
  );

  const placeRows = useMemo(() => {
    const ordered = orderedLocations(locations);
    return filterLocationIds
      ? ordered.filter(({ location }) => filterLocationIds.has(location.id))
      : ordered;
  }, [locations, filterLocationIds]);

  const totals = useMemo(() => {
    const map = new Map();
    shownLevels.forEach((l) => map.set(l.product_id, (map.get(l.product_id) || 0) + (l.quantity || 0)));
    return map;
  }, [shownLevels]);

  // ---- Row stock stepper + Add stock sheet (Nov 14, 2026) --------
  // The stepper acts only where ONE location is unambiguous: the
  // business has a single location, or the list is filtered down to
  // a single location. Anywhere else the number opens the stock
  // sheet (AdjustStockDialog, the same one My inventory uses) with
  // the location explicit — never a guess. Up = a receive of one;
  // down = a correction setting the count one lower (the model's
  // honest fix-a-quantity type); at zero the down tap is refused.
  const [adjusting, setAdjusting] = useState(null);
  const [steppingKey, setSteppingKey] = useState('');
  const stepperLocation = useMemo(() => {
    const candidates = filterLocationIds
      ? locations.filter((l) => filterLocationIds.has(l.id))
      : locations;
    return candidates.length === 1 ? candidates[0] : null;
  }, [locations, filterLocationIds]);

  const stepStock = async (product, location, delta) => {
    const key = `${product.id}:${location.id}`;
    if (steppingKey) return;
    const current =
      levels.find((l) => l.product_id === product.id && l.location_id === location.id)?.quantity ?? 0;
    if (delta < 0 && current <= 0) return;
    setSteppingKey(key);
    try {
      if (delta > 0) {
        await recordMovement({ product, location, type: 'receive', quantity: 1, businessId: activeId, user });
      } else {
        await recordMovement({ product, location, type: 'correction', quantity: current - 1, businessId: activeId, user });
      }
      setReload((r) => r + 1);
    } catch (err) {
      toast({
        title: t('products.stockStepFailed'),
        description: err?.message || '',
        variant: 'destructive',
      });
    } finally {
      setSteppingKey('');
    }
  };

  // Sorting runs on the loaded page so the columns stay instant while you work.
  const sortedItems = useMemo(() => {
    const valueOf = (product) => {
      switch (sort.key) {
        case 'codes':
          return (product.upc || product.barcode || product.isbn || '').toString();
        case 'category':
          return (product.category || '').toString();
        case 'onHand':
          return totals.get(product.id) || 0;
        case 'reorder':
          return product.reorder_point || 0;
        case 'price':
          return product.price || 0;
        default:
          return (product.name || '').toString();
      }
    };
    return [...items].sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      const result =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), undefined, { numeric: true });
      return sort.dir === 'asc' ? result : -result;
    });
  }, [items, sort, totals]);

  const toggleSort = (key) =>
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );

  const lowByProduct = useMemo(() => {
    const set = new Set();
    shownLevels.forEach((l) => {
      const p = items.find((i) => i.id === l.product_id);
      if (p && p.reorder_point > 0 && (l.quantity || 0) <= p.reorder_point) set.add(l.product_id);
    });
    return set;
  }, [shownLevels, items]);

  const categoryOptions = [
    ...new Set([...facets.categories, ...vocabulary.categories]),
  ].sort((a, b) => a.localeCompare(b));
  const tagOptions = [...new Set([...facets.tags, ...vocabulary.tags])].sort((a, b) =>
    a.localeCompare(b)
  );
  const isFiltered = Boolean(
    search || filters.category || filters.tag || filters.status || filters.condition || filters.locationId
  );
  const selectedProducts = items.filter((item) => selected.includes(item.id));
  const allSelected = items.length > 0 && selectedProducts.length === items.length;
  const toggleOne = (id) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  const toggleAll = () => setSelected(allSelected ? [] : items.map((item) => item.id));

  const openNew = () => {
    if (atProductLimit) {
      productLimitToast();
      return;
    }
    setEditing(null);
    setSeed(null);
    setDialogOpen(true);
  };

  // One shared at-limit message for every way a product can be added:
  // New, Duplicate and Copy (Finding 6 — Copy had no guard and let an
  // Essentials customer fill the whole form before the server refused the
  // 51st product; Finding 36 — the New and Duplicate wordings differed).
  // The server's own refusal at 51 is the same friendly wording
  // (productLimitMessage in base44/shared/planLimits.ts), not a raw error.
  const productLimitToast = () => {
    toast({
      title: t('products.limitTitle', { limit: productLimit }),
      description: t('products.limitDescription'),
      variant: 'destructive',
    });
  };

  const openEdit = (product) => {
    setEditing(product);
    setSeed(null);
    setDialogOpen(true);
  };

  const openCopy = (product) => {
    if (atProductLimit) {
      productLimitToast();
      return;
    }
    setEditing(null);
    setSeed(product);
    setDialogOpen(true);
  };

  const toggleArchive = async (product) => {
    const next = product.status === 'archived' ? 'active' : 'archived';
    await base44.entities.Product.update(product.id, { status: next });
    toast({
      title: next === 'archived' ? t('products.archivedTitle') : t('products.restoredTitle'),
      description: product.name,
    });
    setReload((r) => r + 1);
  };

  const duplicate = async (product) => {
    if (atProductLimit) {
      productLimitToast();
      return;
    }
    const base = `${(product.sku || 'copy').toUpperCase()}-COPY`;
    let sku = base;
    let attempt = 2;
    for (;;) {
      const clash = await base44.entities.Product.filter(scoped({ sku }, activeId), { limit: 1 });
      if (!(clash.items ?? []).length) break;
      sku = `${base}-${attempt}`;
      attempt += 1;
      if (attempt > 50) return;
    }
    const payload = {
      ...product,
      name: `${product.name} (copy)`,
      sku,
      upc: '',
      barcode: '',
      qr_code: '',
      status: product.status === 'archived' ? 'draft' : product.status || 'active',
    };
    delete payload.id;
    delete payload.created_date;
    delete payload.updated_date;
    delete payload.created_by_id;
    const created = (await createProducts(activeId, [payload]))[0];
    toast({
      title: t('products.duplicatedTitle'),
      description: `${created.name} · ${created.sku}`,
    });
    setReload((r) => r + 1);
  };

  const remove = async (product) => {
    await base44.entities.Product.delete(product.id);
    const own = levels.filter((l) => l.product_id === product.id);
    if (own.length) await base44.entities.StockLevel.deleteMany({ product_id: product.id });
    toast({ title: t('products.deletedTitle'), description: product.name });
    setReload((r) => r + 1);
  };

  // Delete goes through a plain-words confirmation first (owner ruling,
  // Nov 14 2026): it names the product and, when it holds stock, how
  // many units on hand go with it. Nothing deletes from the menu tap
  // alone. Past movements keep the product name recorded at the time,
  // so the business's books stay readable after the product is gone.
  const requestRemove = (product) => {
    const units = levels
      .filter((l) => l.product_id === product.id)
      .reduce((sum, l) => sum + (l.quantity || 0), 0);
    const message =
      units > 0
        ? t('products.deleteConfirmStock', { name: product.name, count: units })
        : t('products.deleteConfirm', { name: product.name });
    if (!window.confirm(message)) return;
    remove(product);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('products.eyebrow')}</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('products.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('products.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LimitBadge label={t('products.limitLabel')} used={activeCount} limit={productLimit} />
          <ExportCsvButton businessName={profile.name} businessId={activeId} />
          <Button onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" /> {t('products.newProduct')}
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('products.searchPlaceholder')}
          className="h-11 bg-card pl-9"
        />
      </div>

      <ProductFilterBar
        categories={categoryOptions}
        tags={tagOptions}
        locations={locations}
        value={filters}
        onChange={setFilters}
      />

      <div className="flex items-center gap-2 md:hidden">
        <ResponsiveSelect
          title={t('products.sortTitle')}
          ariaLabel={t('products.sortTitle')}
          className="h-9 bg-card"
          value={sort.key}
          onValueChange={(key) => setSort((current) => ({ ...current, key }))}
          options={SORT_OPTIONS.map((option) => ({
            value: option.value,
            label: t('products.sortOption', { label: option.label }),
          }))}
        />
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 lg:h-9 lg:w-9"
          onClick={() => setSort((current) => ({ ...current, dir: current.dir === 'asc' ? 'desc' : 'asc' }))}
          aria-label={sort.dir === 'asc' ? t('products.sortDescending') : t('products.sortAscending')}
        >
          {sort.dir === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        </Button>
      </div>

      {!loading && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              aria-label={t('products.selectAllAria')}
            />
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {selectedProducts.length
                ? t('products.selectedCount', { count: selectedProducts.length })
                : t('products.selectAllCount', { count: items.length })}
            </button>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedProducts.length}
            onClick={() => setBulkOpen(true)}
          >
            {t('products.bulkEdit')}
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="hidden grid-cols-[26px_minmax(0,2.2fr)_minmax(0,1.2fr)_110px_110px_88px] gap-3 border-b border-border bg-muted/50 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:grid xl:grid-cols-[26px_48px_minmax(0,2.4fr)_minmax(0,1.3fr)_120px_110px_84px_104px_96px]">
          <span />
          <span className="hidden xl:block">Photo</span>
          <SortHeader label={t('products.colProduct')} column="name" sort={sort} onSort={toggleSort} />
          <SortHeader label={t('products.colCodes')} column="codes" sort={sort} onSort={toggleSort} />
          <SortHeader label={t('products.colCategory')} column="category" sort={sort} onSort={toggleSort} />
          <SortHeader label={t('products.colOnHand')} column="onHand" sort={sort} onSort={toggleSort} align="right" />
          <SortHeader
            label={t('products.colReorder')}
            column="reorder"
            sort={sort}
            onSort={toggleSort}
            align="right"
            className="hidden xl:flex"
          />
          <SortHeader
            label={t('products.colPrice')}
            column="price"
            sort={sort}
            onSort={toggleSort}
            align="right"
            className="hidden xl:flex"
          />
          <span className="text-right">{t('products.colActions')}</span>
        </div>

        {loading && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t('products.loading')}</p>}

        {!loading && items.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-sm font-medium">{t('products.emptyTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isFiltered
                ? t('products.emptyFiltered')
                : t('products.emptyHint')}
            </p>
          </div>
        )}

        <div className="divide-y divide-border">
          {sortedItems.map((product) => {
            const total = totals.get(product.id) || 0;
            const isLow = lowByProduct.has(product.id);
            const isOpen = expanded === product.id;
            const own = levels.filter((l) => l.product_id === product.id);
            return (
              <div key={product.id}>
                <div
                  className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 md:grid-cols-[26px_minmax(0,2.2fr)_minmax(0,1.2fr)_110px_110px_88px] xl:grid-cols-[26px_48px_minmax(0,2.4fr)_minmax(0,1.3fr)_120px_110px_84px_104px_96px] ${
                    selected.includes(product.id) ? 'bg-primary/5' : ''
                  }`}
                >
                  <Checkbox
                    checked={selected.includes(product.id)}
                    onCheckedChange={() => toggleOne(product.id)}
                    aria-label={t('products.selectAria', { name: product.name })}
                  />
                  <ProductThumb product={product} className="hidden h-10 w-10 xl:block" />
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : product.id)}
                    className="flex min-w-0 items-center gap-2 text-left"
                  >
                    {/* The cover photo beside the name at the sizes
                        the grid-cell thumb is hidden (below xl) —
                        an owner recognises items at a glance. No
                        photo → nothing renders, exactly as before:
                        no placeholder box on the row. */}
                    {product.photo_urls?.[0] ? (
                      <ProductThumb product={product} className="h-11 w-11 xl:hidden" />
                    ) : null}
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{product.name}</span>
                      <span className="numeric block truncate text-[11px] text-muted-foreground">
                        {product.sku}
                        {isLow && <span className="ml-2 font-mono uppercase text-warn">{t('products.lowBadge')}</span>}
                        {product.status && product.status !== 'active' && (
                          <span className="ml-2 font-mono uppercase text-muted-foreground">
                            {product.status}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>

                  <span className="numeric hidden truncate text-xs text-muted-foreground md:block">
                    {product.upc || product.barcode || '—'}
                  </span>
                  <span className="hidden truncate text-xs text-muted-foreground md:block">
                    {product.category || '—'}
                  </span>
                  <span className="hidden text-right md:block">
                    {stepperLocation ? (
                      <span className="inline-flex items-center gap-1">
                        <InlineStockStepper
                          value={total}
                          busy={steppingKey === `${product.id}:${stepperLocation.id}`}
                          onStep={(delta) => stepStock(product, stepperLocation, delta)}
                          addLabel={t('products.addOneAria')}
                          removeLabel={t('products.removeOneAria')}
                        />
                        <span className="font-mono text-[10px] font-normal uppercase text-muted-foreground">
                          {product.unit || t('products.unitEach')}
                        </span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={t('products.adjustStockAria', { name: product.name })}
                        onClick={() => setAdjusting(product)}
                        className="numeric text-sm font-semibold underline decoration-dotted underline-offset-4"
                      >
                        {total}
                        <span className="ml-1 font-mono text-[10px] font-normal uppercase text-muted-foreground">
                          {product.unit || t('products.unitEach')}
                        </span>
                      </button>
                    )}
                  </span>
                  <span className="numeric hidden text-right text-xs text-muted-foreground xl:block">
                    {product.reorder_point || 0}
                  </span>
                  <span className="numeric hidden text-right text-sm xl:block">
                    <ProductPrice product={product} currency={profile.currency} digits={2} />
                  </span>

                  <div className="flex items-center justify-end gap-1">
                    <span className="md:hidden">
                      {stepperLocation ? (
                        <InlineStockStepper
                          value={total}
                          busy={steppingKey === `${product.id}:${stepperLocation.id}`}
                          onStep={(delta) => stepStock(product, stepperLocation, delta)}
                          addLabel={t('products.addOneAria')}
                          removeLabel={t('products.removeOneAria')}
                        />
                      ) : (
                        <button
                          type="button"
                          aria-label={t('products.adjustStockAria', { name: product.name })}
                          onClick={() => setAdjusting(product)}
                          className="numeric text-sm font-semibold underline decoration-dotted underline-offset-4"
                        >
                          {total}
                        </button>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 lg:h-8 lg:w-8"
                      aria-label={t('products.editAria', { name: product.name })}
                      onClick={() => openEdit(product)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <ProductRowMenu
                      product={product}
                      onDuplicate={duplicate}
                      onToggleArchive={toggleArchive}
                      onAddStock={(p) => setAdjusting(p)}
                      onDelete={user?.role === 'admin' ? requestRemove : undefined}
                    />
                  </div>
                </div>

                {isOpen && (
                  <div className="bg-muted/40 px-4 py-3 md:pl-10">
                    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {placeRows.map(({ location: place, depth }) => {
                        const q = own.find((o) => o.location_id === place.id)?.quantity ?? 0;
                        return (
                          <div
                            key={place.id}
                            className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5 text-xs"
                            style={depth ? { marginLeft: `${Math.min(depth, 3) * 12}px` } : undefined}
                          >
                            <span className="truncate">{place.name}</span>
                            <InlineStockStepper
                              value={q}
                              busy={steppingKey === `${product.id}:${place.id}`}
                              onStep={(delta) => stepStock(product, place, delta)}
                              addLabel={t('products.addOneAria')}
                              removeLabel={t('products.removeOneAria')}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t('products.reorderLine', {
                        reorder: product.reorder_point || 0,
                        cost: formatMoney(product.cost, profile.currency, 2),
                        price: product.price || 0,
                      })}
                    </p>
                    {(product.isbn || product.author || product.condition) && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {[
                          product.author,
                          product.isbn ? t('products.isbnLabel', { isbn: product.isbn }) : '',
                          product.condition,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {(product.tags?.length > 0 ||
                      product.brand ||
                      product.publisher ||
                      product.subcategory ||
                      (product.status && product.status !== 'active')) && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {[
                          product.status && product.status !== 'active' ? product.status : '',
                          product.brand,
                          product.publisher ? t('products.publishedBy', { publisher: product.publisher }) : '',
                          product.subcategory,
                          (product.tags || []).map((tag) => `#${tag}`).join(' '),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {product.description && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                        {product.description}
                      </p>
                    )}
                    <CopyGroupPanel
                      product={product}
                      businessId={activeId}
                      totals={totals}
                      onAddCopy={openCopy}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <BulkEditDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        products={selectedProducts}
        categories={categoryOptions}
        subcategories={vocabulary.subcategories}
        tags={tagOptions}
        onDone={(count) => {
          toast({ title: t('products.catalogUpdated'), description: t('products.productsChanged', { count, plural: count === 1 ? '' : 's' }) });
          setReload((r) => r + 1);
        }}
      />

      <ProductFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editing}
        seed={seed}
        onSaved={() => setReload((r) => r + 1)}
      />

      <AdjustStockDialog
        open={Boolean(adjusting)}
        onOpenChange={(next) => {
          if (!next) setAdjusting(null);
        }}
        product={adjusting}
        locations={locations}
        businessId={activeId}
        onDone={() => setReload((r) => r + 1)}
      />
    </div>
  );
}