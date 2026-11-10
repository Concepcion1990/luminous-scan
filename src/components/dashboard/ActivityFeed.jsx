import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import PanelHeading from '@/components/dashboard/PanelHeading';
import { MOVEMENT_TYPES } from '@/lib/inventory';
import { toLocalDate } from '@/lib/dates';

const TONE_CLASS = {
  in: 'bg-ok',
  out: 'bg-destructive',
};

/** The latest ledger entries, the same shape on phone and laptop. */
export default function ActivityFeed({ movements = [] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <PanelHeading
        action={
          <Link to="/movements" className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground">
            Full history
          </Link>
        }
      >
        Recent inventory activity
      </PanelHeading>
      <ul className="divide-y divide-border">
        {movements.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            No movements recorded yet.
          </li>
        )}
        {movements.map((movement) => {
          const meta = MOVEMENT_TYPES[movement.type] || { label: movement.type, tone: 'count' };
          return (
            <li key={movement.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_CLASS[meta.tone] || 'bg-accent'}`}
              />
              <span className="text-sm font-medium">
                {meta.label} {movement.quantity}
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">{movement.sku}</span>
              <span className="ml-auto hidden truncate text-xs text-muted-foreground sm:block">
                {movement.location_name}
              </span>
              <span className="numeric ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground sm:ml-3">
                {toLocalDate(movement.created_date)
                  ? format(toLocalDate(movement.created_date), 'd MMM, HH:mm')
                  : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}