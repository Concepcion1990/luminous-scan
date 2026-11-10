import { CheckCircle2, FlaskConical, TriangleAlert } from 'lucide-react';
import { t } from '@/lib/i18n';

/** The dry-run verdict: what would be created, what would be skipped, nothing written. */
export default function DryRunPanel({ dryRun, report, needsCheck, withStock }) {
  if (!dryRun) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <FlaskConical className="h-3.5 w-3.5" /> {t('import.dryRunTitle')}
        </p>
        <p className="mt-1">
          {t('import.dryRunIntro')}
        </p>
      </div>
    );
  }

  const view = needsCheck ? report : dryRun;
  const problems = needsCheck ? report.problems : dryRun.problems;

  return (
    <div
      className={`rounded-lg border p-3 text-xs ${
        needsCheck ? 'border-warn/40 bg-warn/10' : 'border-ok/40 bg-ok/10'
      }`}
    >
      <p className="flex items-center gap-1.5 font-semibold text-foreground">
        {needsCheck ? (
          <TriangleAlert className="h-3.5 w-3.5 text-warn" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-ok" />
        )}
        {needsCheck ? t('import.dryRunStale') : t('import.dryRunPassed')}
      </p>
      <p className="mt-1 text-foreground">
        <span className="numeric font-semibold">{view.ready}</span>{' '}
        {t('import.dryRunReadyWords', { s: view.ready === 1 ? '' : 's' })} ·{' '}
        <span className="numeric font-semibold">{view.skipped}</span> {t('import.dryRunSkipped')}
        {withStock && view.units > 0 ? (
          <>
            {' '}· <span className="numeric font-semibold">{view.units}</span>{' '}
            {t('import.dryRunOpeningUnits')}
          </>
        ) : null}
      </p>

      {problems.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-muted-foreground">
          {problems.slice(0, 6).map((row) => (
            <li key={row.index} className="truncate">
              {t('import.problemRow', { row: row.index + 2, problem: row.problem })}
            </li>
          ))}
          {problems.length > 6 && <li>{t('import.andMore', { count: problems.length - 6 })}</li>}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        {needsCheck ? t('import.dryRunAgain') : t('import.dryRunNothingSaved')}
      </p>
    </div>
  );
}