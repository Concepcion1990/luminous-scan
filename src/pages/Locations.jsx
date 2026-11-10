import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Plus } from 'lucide-react';
import LocationFormDialog from '@/components/locations/LocationFormDialog';
import LocationTreeCard from '@/components/locations/LocationTreeCard';
import { useBusiness } from '@/hooks/useBusiness';
import { buildLocationTree } from '@/lib/locations';
import { scoped } from '@/lib/scoped';
import { isOperatingSite } from '@/lib/entitlements';
import { productTruncationNotice } from '@/lib/inventory';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import useEntitlements from '@/hooks/useEntitlements';
import { displayLimit } from '@/lib/plans';
import LimitBadge from '@/components/plan/LimitBadge';

export default function Locations() {
  const { activeId } = useBusiness();
  const { limits, isLoading: entitlementLoading } = useEntitlements();
  const { toast } = useToast();
  const [locations, setLocations] = useState([]);
  const [levels, setLevels] = useState([]);
  const [products, setProducts] = useState([]);
  const [productTotal, setProductTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [parentId, setParentId] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [locPage, levelPage, prodPage, total] = await Promise.all([
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
        base44.entities.StockLevel.filter(scoped({}, activeId), { limit: 2000 }),
        base44.entities.Product.filter(scoped({}, activeId), { limit: 500 }),
        base44.entities.Product.count(scoped({}, activeId)),
      ]);
      setLocations(locPage.items ?? []);
      setLevels(levelPage.items ?? []);
      setProducts(prodPage.items ?? []);
      setProductTotal(total);
      setLoading(false);
    })();
  }, [reload, activeId]);

  const productById = new Map(products.map((p) => [p.id, p]));
  const { roots } = buildLocationTree(locations);

  // A site is a top-level store, warehouse or other place. Shelves, bins and vans
  // inside one are storage, not sites, and cost nothing against the allowance.
  // The predicate is isOperatingSite (src/lib/entitlements.js) — the same one
  // the server count uses — so the badge and the enforcement never disagree.
  const siteCount = locations.filter(isOperatingSite).length;
  // While the entitlement row is still loading the cap is unknown (null),
  // never the Essentials 1: a Business login with two sites briefly showed
  // "2 of 1" and blocked adding before its own plan had loaded.
  const siteLimit = displayLimit(limits.sites, entitlementLoading);
  const atSiteLimit = siteLimit != null && siteCount >= siteLimit;

  const openNew = (parent = null) => {
    if (!parent && atSiteLimit) {
      toast({
        title: `This plan includes ${siteLimit} site${siteLimit === 1 ? '' : 's'}`,
        description:
          'Add shelves, bins or vans inside an existing site, or move to Business for up to five sites.',
        variant: 'destructive',
      });
      return;
    }
    setEditing(null);
    setParentId(parent?.id || '');
    setDialogOpen(true);
  };

  const openEdit = (location) => {
    setEditing(location);
    setParentId('');
    setDialogOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Network</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Locations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stores, warehouses and vehicles — with the shelves and bins inside them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LimitBadge label="Sites" used={siteCount} limit={siteLimit} />
          <Button onClick={() => openNew()}>
            <Plus className="mr-1.5 h-4 w-4" /> New location
          </Button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading locations…</p>}

      {!loading && productTruncationNotice(products.length, productTotal) && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          {productTruncationNotice(products.length, productTotal)} — location stock cards only cover
          the first 500 products alphabetically.
        </p>
      )}

      {!loading && locations.length === 0 && (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-sm font-medium">No locations yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add a store or warehouse to start tracking stock.</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {roots.map((location) => (
          <LocationTreeCard
            key={location.id}
            location={location}
            locations={locations}
            levels={levels}
            productById={productById}
            onEdit={openEdit}
            onAddChild={openNew}
          />
        ))}
      </div>

      <LocationFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        location={editing}
        locations={locations}
        initialParentId={parentId}
        onSaved={() => setReload((r) => r + 1)}
      />
    </div>
  );
}