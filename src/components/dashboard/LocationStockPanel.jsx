import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import PanelHeading from '@/components/dashboard/PanelHeading';

/** Units held per location, with a bar scaled to the fullest place. */
export default function LocationStockPanel({ perLocation = [] }) {
  const maxUnits = Math.max(...perLocation.map((row) => row.units), 1);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <PanelHeading
        action={
          <Link
            to="/locations"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Manage <ArrowUpRight className="h-3 w-3" />
          </Link>
        }
      >
        Stock by location
      </PanelHeading>
      <div className="divide-y divide-border">
        {perLocation.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No locations yet — add a store or warehouse.
          </p>
        )}
        {perLocation.map((row) => (
          <div key={row.location.id} className="px-4 py-3.5 sm:px-5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-sm font-medium">{row.location.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {row.location.code || row.location.kind}
                </span>
              </div>
              <span className="numeric shrink-0 text-sm font-semibold">{row.units.toLocaleString()}</span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max((row.units / maxUnits) * 100, 3)}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                {row.skus} SKUs
                {row.low > 0 && <span className="ml-2 text-warn">{row.low} low</span>}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}