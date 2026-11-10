import { formatMoney } from '@/lib/inventory';
import { t } from '@/lib/i18n';

export default function ReportTable({ report, currency }) {
  const { rows, totals, valueLabel, groupLabel } = report;

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-12 text-center">
        <p className="text-sm font-medium">{t('reports.nothingMatches')}</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          {t('reports.nothingMatchesHint')}
        </p>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold">{t('reports.byGroup', { group: groupLabel.toLowerCase() })}</h2>
        <p className="numeric text-[11px] text-muted-foreground">
          {t('reports.groupsCount', { count: rows.length, s: rows.length === 1 ? '' : 's' })}
        </p>
      </div>

      <div className="hidden grid-cols-[1fr_84px_84px_120px] gap-3 border-b border-border bg-secondary/50 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground sm:grid sm:px-5">
        <span>{groupLabel}</span>
        <span className="text-right">{t('reports.colRecords')}</span>
        <span className="text-right">{t('reports.colUnits')}</span>
        <span className="text-right">{valueLabel}</span>
      </div>

      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_84px_84px_120px] sm:items-center sm:gap-3 sm:px-5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.label}</p>
              <p className="numeric truncate text-[11px] text-muted-foreground">
                {row.sub ? `${row.sub} · ` : ''}
                {t('reports.recordsCount', { count: row.count, s: row.count === 1 ? '' : 's' })}
                <span className="sm:hidden">
                  {' '}·{' '}
                  {t('reports.unitsCount', { count: row.units, s: row.units === 1 ? '' : 's' })}
                </span>
              </p>
            </div>
            <p className="numeric hidden text-right text-sm text-muted-foreground sm:block">
              {row.count}
            </p>
            <p className="numeric hidden text-right text-sm sm:block">{row.units}</p>
            <p className="numeric text-sm font-semibold sm:text-right">
              {formatMoney(row.value, currency, 2)}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-1 border-t border-border bg-secondary/40 px-4 py-3 sm:grid-cols-[1fr_84px_84px_120px] sm:items-center sm:gap-3 sm:px-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('reports.total')}</p>
        <p className="numeric hidden text-right text-sm text-muted-foreground sm:block">
          {totals.count}
        </p>
        <p className="numeric hidden text-right text-sm sm:block">{totals.units}</p>
        <p className="numeric text-sm font-semibold sm:text-right">
          {formatMoney(totals.value, currency, 2)}
        </p>
      </div>
    </section>
  );
}