import { CheckCircle2, FlaskConical, TriangleAlert } from 'lucide-react';

/** The dry-run verdict: what would be created, what would be skipped, nothing written. */
export default function DryRunPanel({ dryRun, report, needsCheck, withStock }) {
  if (!dryRun) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <FlaskConical className="h-3.5 w-3.5" /> Dry run
        </p>
        <p className="mt-1">
          Run a dry run to test every row against the catalog. It saves nothing.
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
        {needsCheck ? 'The setup changed since the dry run' : 'Dry run passed'}
      </p>
      <p className="mt-1 text-foreground">
        <span className="numeric font-semibold">{view.ready}</span> row{view.ready === 1 ? '' : 's'} would be
        created · <span className="numeric font-semibold">{view.skipped}</span> skipped
        {withStock && view.units > 0 ? (
          <>
            {' '}
            · <span className="numeric font-semibold">{view.units}</span> opening units
          </>
        ) : null}
      </p>

      {problems.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-muted-foreground">
          {problems.slice(0, 6).map((row) => (
            <li key={row.index} className="truncate">
              Row {row.index + 2}: {row.problem}
            </li>
          ))}
          {problems.length > 6 && <li>and {problems.length - 6} more</li>}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        {needsCheck
          ? 'Run the dry run again before importing.'
          : 'Nothing has been saved — this was only a check.'}
      </p>
    </div>
  );
}