import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { channelLabel, ORDER_STATUS } from '@/lib/orders';
import { money } from '@/lib/purchasing';

const PILL = {
  muted: 'bg-muted text-muted-foreground',
  info: 'bg-secondary text-foreground',
  warn: 'bg-warn/15 text-warn',
  ok: 'bg-ok/12 text-ok',
  hold: 'bg-accent/20 text-foreground',
};

export default function OrderCard({ order, currency, busy, onEdit, onAction }) {
  const status = ORDER_STATUS[order.status] || ORDER_STATUS.new;
  const lines = order.lines || [];
  const canEdit = ['new', 'pending'].includes(order.status);

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-semibold">{order.number}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL[status.tone]}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-1 truncate text-sm">
            {order.customer_name || 'No customer name'}
            {order.customer_ref ? ` · ${order.customer_ref}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[channelLabel(order.channel), order.order_date, order.location_name]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <p className="numeric text-sm font-semibold">{money(order.total, currency)}</p>
      </div>

      <ul className="mt-2.5 space-y-1 border-t border-border pt-2.5 text-xs">
        {lines.map((line, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">
              {line.product_name}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{line.sku}</span>
            </span>
            <span className="numeric shrink-0 text-muted-foreground">
              {line.quantity} × {money(line.unit_price, currency)}
              {Number(line.reserved) > 0 && line.reserved === line.quantity ? ' · held' : ''}
              {Number(line.shipped) > 0 ? ` · ${line.shipped} shipped` : ''}
            </span>
          </li>
        ))}
      </ul>

      {(order.tracking_ref || order.notes) && (
        <p className="mt-2 text-xs text-muted-foreground">
          {order.tracking_ref ? `${order.carrier || 'Tracking'}: ${order.tracking_ref}` : order.notes}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {['new', 'pending'].includes(order.status) && (
          <Button size="sm" className="min-h-11 lg:min-h-0" disabled={busy} onClick={() => onAction('reserve')}>
            Hold stock
          </Button>
        )}
        {['new', 'pending', 'reserved'].includes(order.status) && (
          <Button size="sm" variant="outline" className="min-h-11 lg:min-h-0" disabled={busy} onClick={() => onAction('pack')}>
            Packed
          </Button>
        )}
        {['reserved', 'packed'].includes(order.status) && (
          <Button size="sm" variant="outline" className="min-h-11 lg:min-h-0" disabled={busy} onClick={() => onAction('release')}>
            Release hold
          </Button>
        )}
        {['reserved', 'packed', 'new', 'pending'].includes(order.status) && (
          <Button size="sm" variant="outline" className="min-h-11 lg:min-h-0" disabled={busy} onClick={() => onAction('ship')}>
            Ship
          </Button>
        )}
        {order.status === 'shipped' && (
          <Button size="sm" className="min-h-11 lg:min-h-0" disabled={busy} onClick={() => onAction('deliver')}>
            Mark delivered
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="ghost" className="min-h-11 lg:min-h-0" disabled={busy} onClick={onEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
          </Button>
        )}
        {['new', 'pending', 'reserved', 'packed'].includes(order.status) && (
          <Button size="sm" variant="ghost" className="min-h-11 lg:min-h-0" disabled={busy} onClick={() => onAction('cancel')}>
            Cancel
          </Button>
        )}
        {['new', 'pending', 'cancelled'].includes(order.status) && (
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 min-w-11 text-muted-foreground lg:min-h-0 lg:min-w-0"
            disabled={busy}
            onClick={() => onAction('delete')}
            aria-label={`Delete ${order.number}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}