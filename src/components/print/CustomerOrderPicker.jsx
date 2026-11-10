import { channelLabel, ORDER_STATUS } from '@/lib/orders';

const TONE = {
  muted: 'bg-muted text-muted-foreground',
  warn: 'bg-warn/15 text-warn',
  hold: 'bg-accent/20 text-accent-foreground',
  info: 'bg-secondary text-secondary-foreground',
  ok: 'bg-ok/15 text-ok',
};

export default function CustomerOrderPicker({ orders, value, onChange }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Customer orders
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">Pick the order to print.</p>
      <div className="mt-3 max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
        {orders.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No customer orders yet — create one in Orders.
          </p>
        )}
        {orders.map((order) => {
          const status = ORDER_STATUS[order.status] || ORDER_STATUS.new;
          return (
            <button
              key={order.id}
              type="button"
              onClick={() => onChange(order.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                value === order.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="numeric text-xs font-semibold">{order.number}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${TONE[status.tone] || TONE.muted}`}>
                  {status.label}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {order.customer_name || 'No customer'} · {channelLabel(order.channel)} ·{' '}
                {(order.lines || []).length} line{(order.lines || []).length === 1 ? '' : 's'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}