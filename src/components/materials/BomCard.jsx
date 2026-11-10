import { Hammer, Pencil, Trash2, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BUILD_KINDS, usableLines } from '@/lib/bom';

const PILL = {
  blue: 'bg-secondary text-foreground',
  purple: 'bg-accent/15 text-accent-foreground',
};

export default function BomCard({
  bom,
  available,
  parts = [],
  onHand = 0,
  onAssemble,
  onDisassemble,
  onEdit,
  onDelete,
}) {
  const lines = usableLines(bom);
  const kind = BUILD_KINDS[bom.kind] || BUILD_KINDS.bundle;

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{bom.product_name}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL[bom.kind] || PILL.blue}`}>
              {kind.label}
            </span>
          </div>
          <p className="numeric mt-0.5 font-mono text-[11px] text-muted-foreground">{bom.sku}</p>
        </div>
        <div className="flex shrink-0 gap-3 text-right">
          <div>
            <p className="numeric text-lg font-semibold leading-none">{onHand}</p>
            <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">on hand</p>
          </div>
          <div>
            <p className="numeric text-lg font-semibold leading-none text-muted-foreground">{available}</p>
            <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              buildable
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex-1 overflow-hidden rounded-lg border border-border/70">
        <div className="flex items-center justify-between bg-muted/50 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
          <span>Parts in this {kind.label.toLowerCase()}</span>
          <span>per · have</span>
        </div>
        <div className="divide-y divide-border/70">
          {parts.map((part) => (
            <div key={part.component_id} className="flex items-baseline justify-between gap-2 px-2.5 py-1.5">
              <span className="truncate text-xs">{part.component_name}</span>
              <span className="numeric shrink-0 text-xs text-muted-foreground">
                ×{part.per} · {part.have}
              </span>
            </div>
          ))}
          {!lines.length && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">
              No parts yet — edit to add the components.
            </p>
          )}
        </div>
      </div>

      {bom.notes && <p className="mt-2 text-[11px] text-muted-foreground">{bom.notes}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" onClick={onAssemble} disabled={!lines.length}>
          <Hammer className="mr-1 h-3.5 w-3.5" /> Build
        </Button>
        <Button size="sm" variant="outline" onClick={onDisassemble} disabled={!lines.length || onHand < 1}>
          <Unplug className="mr-1 h-3.5 w-3.5" /> Take apart
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={onDelete}
          aria-label={`Delete build list for ${bom.product_name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}