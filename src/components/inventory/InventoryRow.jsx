import { SlidersHorizontal } from 'lucide-react';
import ProductThumb from '@/components/products/ProductThumb';
import { Button } from '@/components/ui/button';

/** One product in the inventory list: what is on hand, where, and how to change it. */
export default function InventoryRow({ product, levels = [], locations = [], onAdjust }) {
  const total = levels.reduce((sum, level) => sum + (level.quantity || 0), 0);
  const held = levels.reduce((sum, level) => sum + (level.reserved || 0), 0);
  const placed = locations
    .map((location) => ({
      location,
      level: levels.find((entry) => entry.location_id === location.id),
    }))
    .filter((entry) => (entry.level?.quantity || 0) > 0);
  const atReorder = (product.reorder_point || 0) > 0 && total <= product.reorder_point;

  return (
    <div className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-b-0 sm:px-4">
      <ProductThumb product={product} className="h-11 w-11" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="truncate text-sm font-medium">{product.name}</p>
          {product.sku && (
            <span className="font-mono text-[11px] text-muted-foreground">{product.sku}</span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {placed.length === 0 ? (
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              No stock placed
            </span>
          ) : (
            placed.map(({ location, level }) => (
              <span
                key={location.id}
                className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {location.name} · <span className="numeric text-foreground">{level.quantity}</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="text-right">
          <p className={`numeric text-lg font-semibold ${atReorder ? 'text-warn' : ''}`}>{total}</p>
          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
            {atReorder ? `Reorder at ${product.reorder_point}` : held ? `${held} held` : 'on hand'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => onAdjust(product)}>
          <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
          <span className="hidden sm:inline">Adjust</span>
        </Button>
      </div>
    </div>
  );
}