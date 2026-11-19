import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { useBusiness } from '@/hooks/useBusiness';
import { isBoss } from '@/lib/bossAuthority';

/**
 * "Products: 38 of 50" — and, when the allowance is used up, what to do next.
 * Unlimited plans render nothing: no artificial ceiling to advertise.
 *
 * The badge names a PLAN allowance, so it is money-class
 * information (money-surfaces audit, Nov 19, 2026): it renders
 * for the boss only. Staff, managers and viewers never see a
 * plan limit or the Upgrade door — the cap still refuses their
 * writes server-side, with a plan-neutral message.
 */
export default function LimitBadge({ label, used, limit, className }) {
  const { user, record } = useBusiness();
  if (!isBoss(user, record)) return null;
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
        {t('plan.limitBadge.usedOf', { used, limit })}
      </span>
      {full && (
        <Link to="/upgrade" className="font-medium text-link underline underline-offset-2">
          {t('plan.limitBadge.upgrade')}
        </Link>
      )}
    </div>
  );
}