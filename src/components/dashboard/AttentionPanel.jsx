import { Link } from 'react-router-dom';
import { ArrowUpRight, TriangleAlert } from 'lucide-react';
import PanelHeading from '@/components/dashboard/PanelHeading';
import { t } from '@/lib/i18n';

const ROWS = 6;

/** Everything at or below its reorder point, worst first. */
export default function AttentionPanel({ low = [] }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <PanelHeading
        action={
          low.length > 0 ? (
            <Link
              to="/low-stock"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn/12 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-warn"
            >
              <TriangleAlert className="h-3 w-3" /> {low.length}
            </Link>
          ) : null
        }
      >
        {t('dashboard.needsAttention')}
      </PanelHeading>
      <div className="flex-1 divide-y divide-border">
        {low.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t('dashboard.nothingBelowReorder')}
          </p>
        )}
        {low.slice(0, ROWS).map((item) => (
          <div
            key={`${item.product.id}-${item.level.location_id}`}
            className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.product.name}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {item.product.sku} · {item.location?.code || item.location?.name}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={`numeric text-sm font-semibold ${
                  item.quantity <= 0 ? 'text-destructive' : 'text-warn'
                }`}
              >
                {item.quantity}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">{t('dashboard.minReorder', { reorder: item.reorder })}</p>
            </div>
          </div>
        ))}
        {low.length > ROWS && (
          <Link
            to="/low-stock"
            className="flex items-center gap-1 px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground sm:px-5"
          >
            {t('dashboard.moreOnLowStock', { count: low.length - ROWS })} <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </section>
  );
}