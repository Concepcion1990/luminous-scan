import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import PanelHeading from '@/components/dashboard/PanelHeading';
import { MOVEMENT_TYPES } from '@/lib/inventory';
import { toLocalDate } from '@/lib/dates';
import { t } from '@/lib/i18n';

const TONE_CLASS = {
  in: 'bg-ok',
  out: 'bg-destructive',
};

/**
 * The latest inventory activity, the same shape on phone and
 * laptop: ledger entries, with committed imports interleaved as
 * summary lines (owner ruling, Nov 15, 2026 — an import that moved
 * no stock still belongs in the inventory's story). Import lines
 * are activity, never movements: no quantity, no SKU, no stock
 * math anywhere near them.
 */
export default function ActivityFeed({ movements = [], importEvents = [] }) {
  const feed = [
    ...movements.map((movement) => ({ kind: 'movement', at: movement.created_date || '', row: movement })),
    ...importEvents.map((event) => ({ kind: 'import', at: event.created_date || '', row: event })),
  ]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 8);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <PanelHeading
        action={
          <Link to="/movements" className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground">
            {t('dashboard.fullHistory')}
          </Link>
        }
      >
        {t('dashboard.recentActivity')}
      </PanelHeading>
      <ul className="divide-y divide-border">
        {feed.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            {t('dashboard.noMovementsYet')}
          </li>
        )}
        {feed.map(({ kind, row }) =>
          kind === 'import' ? (
            <li key={`import-${row.id}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span className="text-sm font-medium">
                {t(row.kind === 'update' ? 'dashboard.activityUpdated' : 'dashboard.activityImported', {
                  count: row.product_count || 0,
                  plural: row.product_count === 1 ? '' : 's',
                })}
              </span>
              <span className="numeric ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {toLocalDate(row.created_date)
                  ? format(toLocalDate(row.created_date), 'd MMM, HH:mm')
                  : ''}
              </span>
            </li>
          ) : (
            renderMovement(row)
          ),
        )}
      </ul>
    </section>
  );
}

function renderMovement(movement) {
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
}