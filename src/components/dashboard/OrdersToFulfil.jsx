import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import PanelHeading from '@/components/dashboard/PanelHeading';
import { ORDER_STATUS, heldUnits } from '@/lib/orders';
import { formatMoney } from '@/lib/inventory';

const ROWS = 5;

/** Orders that still owe the customer stock, newest first. */
export default function OrdersToFulfil({ orders = [], currency = 'USD' }) {
  const units = orders.reduce((sum, order) => sum + heldUnits(order), 0);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <PanelHeading
        sub={
          orders.length
            ? `${orders.length} open · ${units} unit${units === 1 ? '' : 's'} held`
            : undefined
        }
        action={
          <Link
            to="/orders"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Orders <ArrowUpRight className="h-3 w-3" />
          </Link>
        }
      >
        Orders to fulfil
      </PanelHeading>
      <div className="divide-y divide-border">
        {orders.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No orders waiting on stock.</p>
        )}
        {orders.slice(0, ROWS).map((order) => (
          <Link
            key={order.id}
            to="/orders"
            className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
          >
            <div className="min-w-0">
              <p className="numeric truncate text-xs font-semibold">{order.number}</p>
              <p className="truncate text-xs text-muted-foreground">{order.customer_name || 'No customer name'}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="numeric text-xs font-semibold">{formatMoney(order.total, currency, 2)}</p>
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {ORDER_STATUS[order.status]?.label || order.status}
              </p>
            </div>
          </Link>
        ))}
        {orders.length > ROWS && (
          <p className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {orders.length - ROWS} more
          </p>
        )}
      </div>
    </section>
  );
}