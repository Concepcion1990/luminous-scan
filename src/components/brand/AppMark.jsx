import { ScanLine } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '@/lib/business';

/**
 * The permanent software identity. It is never affected by the merchant's
 * business name, tagline or logo.
 */
export default function AppMark({ compact = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`grid shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground ${
          compact ? 'h-5 w-5' : 'h-8 w-8'
        }`}
      >
        <ScanLine className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
      </span>
      <div className="min-w-0 leading-tight">
        <p
          className={
            compact
              ? 'truncate font-mono text-[9px] uppercase tracking-[0.18em] text-primary-foreground/55'
              : 'truncate font-heading text-[13px] font-semibold tracking-tight'
          }
        >
          {APP_NAME}
        </p>
        {!compact && (
          <p className="text-[9.5px] leading-snug text-primary-foreground/45">{APP_TAGLINE}</p>
        )}
      </div>
    </div>
  );
}