import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * "Products: 38 of 50" — and, when the allowance is used up, what to do next.
 * Unlimited plans render nothing: no artificial ceiling to advertise.
 */
export default function LimitBadge({ label, used, limit, className }) {
  if (limit == null) return null;
  const full = used >= limit;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs',
        full ? 'border-warn/40 bg-warn/10' : 'border-border bg-card',
        className
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="numeric font-semibold">
        {used} of {limit}
      </span>
      {full && (
        <Link to="/upgrade" className="font-medium text-primary underline underline-offset-2">
          Upgrade
        </Link>
      )}
    </div>
  );
}