import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowUpRight } from 'lucide-react';
import PanelHeading from '@/components/dashboard/PanelHeading';
import { openQty, poProgress } from '@/lib/purchasing';

const ROWS = 5;

function expectedLabel(value) {
  if (!value) return 'No date set';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'No date set';
  return date < new Date() ? `Was due ${format(date, 'd MMM')}` : `Due ${format(date, 'd MMM')}`;
}

/** Purchase orders that have not fully arrived, soonest expected first. */
export default function IncomingStock({ purchaseOrders = [] }) {
  const units = purchaseOrders.reduce(
    (sum, order) => sum + (order.lines || []).reduce((lineSum, line) => lineSum + openQty(line), 0),
    0
  );

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <PanelHeading
        sub={
          purchaseOrders.length
            ? `${purchaseOrders.length} on order · ${units} unit${units === 1 ? '' : 's'} due`
            : undefined
        }
        action={
          <Link
            to="/purchasing"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Purchasing <ArrowUpRight className="h-3 w-3" />
          </Link>
        }
      >
        Incoming stock
      </PanelHeading>
      <div className="divide-y divide-border">
        {purchaseOrders.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing on order.</p>
        )}
        {purchaseOrders.slice(0, ROWS).map((order) => {
          const progress = poProgress(order);
          return (
            <Link
              key={order.id}
              to="/purchasing"
              className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="numeric truncate text-xs font-semibold">{order.number}</p>
                <p className="truncate text-xs text-muted-foreground">{order.supplier_name || 'No supplier'}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="numeric text-xs font-semibold">
                  {progress.received}/{progress.ordered}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {expectedLabel(order.expected_date)}
                </p>
              </div>
            </Link>
          );
        })}
        {purchaseOrders.length > ROWS && (
          <p className="px-4 py-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {purchaseOrders.length - ROWS} more
          </p>
        )}
      </div>
    </section>
  );
}