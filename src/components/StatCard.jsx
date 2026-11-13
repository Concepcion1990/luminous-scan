export default function StatCard({ label, value, unit, hint, tone = 'default' }) {
  const valueTone =
    tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-foreground';

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`numeric text-2xl font-semibold sm:text-3xl ${valueTone}`}>{value}</span>
        {unit && (
          <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}