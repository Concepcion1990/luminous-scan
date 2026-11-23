import { formatTrailStamp } from '@/lib/trail';
import { t } from '@/lib/i18n';

/**
 * The time trail at the foot of a record card (release 357):
 * one line per stage the record has truly passed — stage name,
 * DATE + TIME, and the name of who did it where the stage
 * records an actor. Facts about the record, shown to anyone
 * who can already see the record.
 */
export default function TrailList({ stages }) {
  if (!stages?.length) return null;
  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {t('trail.title')}
      </p>
      <ul className="mt-1.5 space-y-1 text-xs">
        {stages.map((s) => (
          <li key={s.key} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{s.label}</span>
            <span className="text-muted-foreground">{formatTrailStamp(s.at)}</span>
            {s.actor ? <span className="text-muted-foreground">· {s.actor}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
