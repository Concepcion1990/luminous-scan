import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import SortHeader from '@/components/products/SortHeader';
import ProductThumb from '@/components/products/ProductThumb';
import ResponsiveSelect from '@/components/ui/ResponsiveSelect';
import ProductFormDialog from '@/components/products/ProductFormDialog';
import ExportCsvButton from '@/components/products/ExportCsvButton';
import CopyGroupPanel from '@/components/products/CopyGroupPanel';
import ProductFilterBar, { EMPTY_FILTERS } from '@/components/products/ProductFilterBar';
import BulkEditDialog from '@/components/products/BulkEditDialog';
import ProductRowMenu from '@/components/products/ProductRowMenu';
import { Checkbox } from '@/components/ui/checkbox';
import { useBusiness } from '@/hooks/useBusiness';
import { useCatalogVocabulary } from '@/hooks/useCatalogVocabulary';
import { formatMoney, listProducts } from '@/lib/inventory';
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

const SORT_OPTIONS = [
  { value: 'name', label: 'Product name' },
  { value: 'codes', label: 'Barcode / UPC' },
  { value: 'category', label: 'Category' },
  { value: 'onHand', label: 'On hand' },
  { value: 'reorder', label: 'Reorder point' },
  { value: 'price', label: 'Retail price' },
];

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
  const [expanded, setExpanded] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [seed, setSeed] = useState(null);
  const [reload, setReload] = useState(0);
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [activeCount, setActiveCount] = useState(0);

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
      setLoading(true);
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
      title: `This plan includes ${productLimit} active products`,
      description: 'Archive one you no longer sell to free a slot, or move to Business for unlimited products.',
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
      title: next === 'archived' ? 'Product archived' : 'Product restored',
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
      title: 'Product duplicated',
      description: `${created.name} · ${created.sku}`,
    });
    setReload((r) => r + 1);
  };

  const remove = async (product) => {
    await base44.entities.Product.delete(product.id);
    const own = levels.filter((l) => l.product_id === product.id);
    if (own.length) await base44.entities.StockLevel.deleteMany({ product_id: product.id });
    toast({ title: 'Product deleted', description: product.name });
    setReload((r) => r + 1);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Catalog</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every SKU, UPC, barcode and QR code your scanners resolve.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LimitBadge label="Products" used={activeCount} limit={productLimit} />
          <ExportCsvButton businessName={profile.name} businessId={activeId} />
          <Button onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New product
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, SKU, ISBN, author, brand or tag"
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
          title="Sort products"
          ariaLabel="Sort products"
          className="h-9 bg-card"
          value={sort.key}
          onValueChange={(key) => setSort((current) => ({ ...current, key }))}
          options={SORT_OPTIONS.map((option) => ({
            value: option.value,
            label: `Sort: ${option.label}`,
          }))}
        />
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 lg:h-9 lg:w-9"
          onClick={() => setSort((current) => ({ ...current, dir: current.dir === 'asc' ? 'desc' : 'asc' }))}
          aria-label={sort.dir === 'asc' ? 'Sort descending' : 'Sort ascending'}
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
              aria-label="Select all listed products"
            />
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {selectedProducts.length
                ? `${selectedProducts.length} selected`
                : `Select all ${items.length} listed`}
            </button>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedProducts.length}
            onClick={() => setBulkOpen(true)}
          >
            Bulk edit
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="hidden grid-cols-[26px_minmax(0,2.2fr)_minmax(0,1.2fr)_110px_110px_88px] gap-3 border-b border-border bg-muted/50 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground md:grid xl:grid-cols-[26px_48px_minmax(0,2.4fr)_minmax(0,1.3fr)_120px_110px_84px_104px_96px]">
          <span />
          <span className="hidden xl:block">Photo</span>
          <SortHeader label="Product" column="name" sort={sort} onSort={toggleSort} />
          <SortHeader label="Codes" column="codes" sort={sort} onSort={toggleSort} />
          <SortHeader label="Category" column="category" sort={sort} onSort={toggleSort} />
          <SortHeader label="On hand" column="onHand" sort={sort} onSort={toggleSort} align="right" />
          <SortHeader
            label="Reorder"
            column="reorder"
            sort={sort}
            onSort={toggleSort}
            align="right"
            className="hidden xl:flex"
          />
          <SortHeader
            label="Price"
            column="price"
            sort={sort}
            onSort={toggleSort}
            align="right"
            className="hidden xl:flex"
          />
          <span className="text-right">Actions</span>
        </div>

        {loading && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading catalog…</p>}

        {!loading && items.length === 0 && (
          <div className="px-4 py-14 text-center">
            <p className="text-sm font-medium">No products found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isFiltered
                ? 'No products match this search and these filters.'
                : 'Add your first product to start scanning.'}
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
                    aria-label={`Select ${product.name}`}
                  />
                  <ProductThumb product={product} className="hidden h-10 w-10 xl:block" />
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : product.id)}
                    className="flex min-w-0 items-center gap-2 text-left"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{product.name}</span>
                      <span className="numeric block truncate text-[11px] text-muted-foreground">
                        {product.sku}
                        {isLow && <span className="ml-2 font-mono uppercase text-warn">low</span>}
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
                  <span className="numeric hidden text-right text-sm font-semibold md:block">
                    {total}
                    <span className="ml-1 font-mono text-[10px] font-normal uppercase text-muted-foreground">
                      {product.unit || 'each'}
                    </span>
                  </span>
                  <span className="numeric hidden text-right text-xs text-muted-foreground xl:block">
                    {product.reorder_point || 0}
                  </span>
                  <span className="numeric hidden text-right text-sm xl:block">
                    {product.price ? formatMoney(product.price, profile.currency, 2) : '—'}
                  </span>

                  <div className="flex items-center justify-end gap-1">
                    <span className="numeric text-sm font-semibold md:hidden">{total}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 lg:h-8 lg:w-8"
                      aria-label={`Edit ${product.name}`}
                      onClick={() => openEdit(product)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <ProductRowMenu
                      product={product}
                      onDuplicate={duplicate}
                      onToggleArchive={toggleArchive}
                    />
                    {user?.role === 'admin' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 text-muted-foreground hover:text-destructive lg:h-8 lg:w-8"
                        aria-label={`Delete ${product.name}`}
                        onClick={() => remove(product)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
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
                            <span className={`numeric font-semibold ${q === 0 ? 'text-muted-foreground' : ''}`}>
                              {q}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                      Reorder at {product.reorder_point || 0} · cost{' '}
                      {formatMoney(product.cost, profile.currency, 2)} · price{' '}
                      {product.price || 0}
                    </p>
                    {(product.isbn || product.author || product.condition) && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {[
                          product.author,
                          product.isbn ? `ISBN ${product.isbn}` : '',
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
                          product.publisher ? `Published by ${product.publisher}` : '',
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
          toast({ title: 'Catalog updated', description: `${count} products changed` });
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
    </div>
  );
}