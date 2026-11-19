import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { isBoss } from '@/lib/bossAuthority';
import { t } from '@/lib/i18n';

/**
 * The boss's door (Nov 19, 2026): Plan & limits is the
 * subscription's home — trial state, plan changes, payment
 * warnings — and money information is the OWNER's alone. Where
 * PlanRedirect hides a surface from plans that lack a feature,
 * BossRedirect hides it from people who are not the boss:
 * navigation hides the entry (the nav item carries `bossOnly`),
 * and a typed URL or stale link bounces quietly to the Overview.
 * The owner renders the page exactly as before.
 */
export default function BossRedirect({ children }) {
  const { user, record, isLoading } = useBusiness();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('plan.gate.checking')}
      </div>
    );
  }

  if (!isBoss(user, record)) return <Navigate to="/" replace />;

  return children;
}
