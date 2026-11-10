import { format } from 'date-fns';
import { Loader2, RotateCcw, Undo2 } from 'lucide-react';
import { MOVEMENT_TYPES } from '@/lib/inventory';
import { toLocalDate } from '@/lib/dates';
import { Button } from '@/components/ui/button';

const toneClass = {
  in: 'text-ok',
  out: 'text-destructive',
  count: 'text-foreground',
  move: 'text-accent-foreground',
  warn: 'text-warn',
  hold: 'text-accent',
};

const dotClass = {
  in: 'bg-ok',
  out: 'bg-destructive',
  warn: 'bg-warn',
  move: 'bg-accent',
  hold: 'bg-accent',
};

export function deltaLabel(movement) {
  const direction = MOVEMENT_TYPES[movement.type]?.direction;
  if (direction === 'set') return `${movement.previous_qty ?? 0} → ${movement.new_qty ?? 0}`;
  if (direction === 'hold') {
    const sign = movement.type === 'reserved' ? '+' : '−';
    return `${sign}${movement.quantity} held`;
  }
  if (direction === 'in') return `+${movement.quantity}`;
  return `−${movement.quantity}`;
}

export default function MovementRow({
  movement,
  reversed,
  blocker,
  confirming,
  busy,
  onAskReverse,
  onConfirmReverse,
  onCancelReverse,
}) {
  const meta = MOVEMENT_TYPES[movement.type] || { label: movement.type, tone: 'count' };
  const date = toLocalDate(movement.created_date);

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass[meta.tone] || 'bg-accent'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{movement.product_name || 'Product'}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{movement.sku}</span>
          {reversed && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              reversed
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {meta.label} · {movement.location_name}
          {movement.type === 'transfer' && movement.to_location_name ? ` → ${movement.to_location_name}` : ''}
          {movement.note ? ` · ${movement.note}` : ''}
          {movement.reference ? ` · ${movement.reference}` : ''}
        </p>
        {movement.reversal_of_id && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-accent">
            <Undo2 className="h-3 w-3" /> Reverses {movement.reversal_of_label || 'an earlier entry'}
          </p>
        )}
        {blocker && confirming && (
          <p className="mt-1 text-[11px] text-destructive">{blocker}</p>
        )}
        {!blocker && !reversed && !movement.reversal_of_id && (
          <div className="mt-1.5 flex items-center gap-1.5">
            {confirming ? (
              <>
                <Button size="sm" variant="outline" className="min-h-11 lg:min-h-0" onClick={onConfirmReverse} disabled={busy}>
                  {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Confirm reversal
                </Button>
                <Button size="sm" variant="ghost" className="min-h-11 lg:min-h-0" onClick={onCancelReverse} disabled={busy}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" className="h-11 px-1.5 text-[11px] lg:h-7" onClick={onAskReverse}>
                <RotateCcw className="mr-1 h-3 w-3" /> Reverse
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className={`numeric text-sm font-semibold ${toneClass[meta.tone] || ''}`}>{deltaLabel(movement)}</p>
        <p className="numeric font-mono text-[10px] text-muted-foreground">
          {date ? format(date, 'd MMM, HH:mm') : ''}
        </p>
      </div>
    </div>
  );
}