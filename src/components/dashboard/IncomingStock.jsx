import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowUpRight } from 'lucide-react';
import PanelHeading from '@/components/dashboard/PanelHeading';
import { openQty, poProgress } from '@/lib/purchasing';
import { t } from '@/lib/i18n';

const ROWS = 5;

function expectedLabel(value) {
  if (!value) return t('dashboard.noDateSet');
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return t('dashboard.noDateSet');
  return date < new Date()
    ? t('dashboard.wasDue', { date: format(date, 'd MMM') })
    : t('dashboard.dueOn', { date: format(date, 'd MMM') });
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
            ? t('dashboard.incomingSub', { count: purchaseOrders.length, units, s: units === 1 ? '' : 's' })
            : undefined
        }
        action={
          <Link
            to="/purchasing"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {t('dashboard.purchasing')} <ArrowUpRight className="h-3 w-3" />
          </Link>
        }
      >
        {t('dashboard.incomingStock')}
      </PanelHeading>
      <div className="divide-y divide-border">
        {purchaseOrders.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('dashboard.nothingOnOrder')}</p>
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
                <p className="truncate text-xs text-muted-foreground">{order.supplier_name || t('dashboard.noSupplier')}</p>
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
            {t('dashboard.moreCount', { count: purchaseOrders.length - ROWS })}
          </p>
        )}
      </div>
    </section>
  );
}