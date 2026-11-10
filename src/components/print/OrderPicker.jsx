const STATUS_TONE = {
  draft: 'bg-muted text-muted-foreground',
  ordered: 'bg-secondary text-secondary-foreground',
  partial: 'bg-warn/15 text-warn',
  received: 'bg-ok/15 text-ok',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

export default function OrderPicker({ orders, value, onChange }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Purchase orders
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">Pick the order to print.</p>
      <div className="mt-3 max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
        {orders.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No purchase orders yet — create one in Purchasing.
          </p>
        )}
        {orders.map((order) => (
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
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] capitalize ${STATUS_TONE[order.status] || STATUS_TONE.draft}`}
              >
                {order.status}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {order.supplier_name} · {(order.lines || []).length} line
              {(order.lines || []).length === 1 ? '' : 's'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}