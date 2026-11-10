import { Building2, Pencil, Plus, Store, Truck, Warehouse } from 'lucide-react';
import { t } from '@/lib/i18n';

import LocationChildRows from '@/components/locations/LocationChildRows';
import { descendantIds } from '@/lib/locations';
import { Button } from '@/components/ui/button';

const kindIcon = { store: Store, warehouse: Warehouse, van: Truck, other: Building2 };

/** One top-level location with its totals (including everything nested inside). */
export default function LocationTreeCard({
  location,
  locations = [],
  levels = [],
  productById,
  onEdit,
  onAddChild,
}) {
  const ids = new Set(descendantIds(locations, location.id));
  const own = levels.filter((level) => ids.has(level.location_id));
  const units = own.reduce((sum, level) => sum + (level.quantity || 0), 0);
  const skus = own.filter((level) => (level.quantity || 0) > 0).length;
  const low = own.filter((level) => {
    const product = productById.get(level.product_id);
    return product && product.reorder_point > 0 && (level.quantity || 0) <= product.reorder_point;
  }).length;
  const KIND_LABELS = {
    store: t('locations.kindStore'),
    warehouse: t('locations.kindWarehouse'),
    van: t('locations.kindVan'),
    shelf: t('locations.kindShelf'),
    bin: t('locations.kindBin'),
    other: t('locations.kindOther'),
  };

  const Icon = kindIcon[location.kind] || Building2;

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{location.name}</p>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              {location.code || KIND_LABELS[location.kind] || location.kind}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t('locations.addInsideAria', { name: location.name })}
            onClick={() => onAddChild(location)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t('locations.editAria', { name: location.name })}
            onClick={() => onEdit(location)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{t('locations.unitsLabel')}</p>
          <p className="numeric text-lg font-semibold">{units.toLocaleString()}</p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{t('locations.skusLabel')}</p>
          <p className="numeric text-lg font-semibold">{skus}</p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{t('locations.lowLabel')}</p>
          <p className={`numeric text-lg font-semibold ${low > 0 ? 'text-warn' : ''}`}>{low}</p>
        </div>
      </div>

      {location.address && (
        <p className="mt-3 truncate text-xs text-muted-foreground">{location.address}</p>
      )}

      <LocationChildRows
        rootId={location.id}
        locations={locations}
        levels={levels}
        onEdit={onEdit}
        onAddChild={onAddChild}
      />
    </div>
  );
}