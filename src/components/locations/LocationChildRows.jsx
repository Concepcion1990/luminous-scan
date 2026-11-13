import { Pencil, Plus } from 'lucide-react';
import { t } from '@/lib/i18n';

import { orderedLocations, descendantIds } from '@/lib/locations';
import { Button } from '@/components/ui/button';

/**
 * The shelves and bins stored inside one location, shown as an indented list.
 * Each row reports the units held there plus anything nested deeper.
 */
export default function LocationChildRows({ rootId, locations = [], levels = [], onEdit, onAddChild }) {
  const KIND_LABELS = {
    store: t('locations.kindStore'),
    warehouse: t('locations.kindWarehouse'),
    van: t('locations.kindVan'),
    shelf: t('locations.kindShelf'),
    bin: t('locations.kindBin'),
    other: t('locations.kindOther'),
  };

  const ids = new Set(descendantIds(locations, rootId));
  const rows = orderedLocations(locations).filter(
    ({ location }) => location.id !== rootId && ids.has(location.id)
  );

  if (!rows.length) return null;

  return (
    <div className="mt-3 space-y-1 border-t border-border pt-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{t('locations.insideLabel')}</p>
      {rows.map(({ location, depth }) => {
        const ownIds = descendantIds(locations, location.id);
        const units = levels
          .filter((level) => ownIds.includes(level.location_id))
          .reduce((sum, level) => sum + (level.quantity || 0), 0);
        return (
          <div
            key={location.id}
            className="flex items-center gap-2 rounded-md bg-secondary/60 px-2 py-1.5"
            style={{ marginLeft: `${Math.min(depth, 3) * 12}px` }}
          >
            <span className="truncate text-xs font-medium">{location.name}</span>
            <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              {KIND_LABELS[location.kind] || location.kind}
            </span>
            <span className="numeric ml-auto text-xs font-semibold">{units}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t('locations.addInsideAria', { name: location.name })}
              onClick={() => onAddChild(location)}
            >
              <Plus className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t('locations.editAria', { name: location.name })}
              onClick={() => onEdit(location)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}