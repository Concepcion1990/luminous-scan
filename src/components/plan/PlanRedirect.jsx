import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import useEntitlements from '@/hooks/useEntitlements';
import { t } from '@/lib/i18n';

/**
 * The invisible door (the owner's ruling, Nov 14, 2026 — first
 * applied to Till connections, then extended the same day to every
 * Business-only surface the gate audit found): where PlanGate shows
 * a locked-door upsell page, PlanRedirect makes the surface simply
 * not exist on plans that lack the feature — navigation hides the
 * entry (the nav item carries the same `feature`), and a typed URL,
 * bookmark or stale link bounces quietly to the Overview instead of
 * opening a gate page. Business plans render the page exactly as
 * before.
 */
export default function PlanRedirect({ feature, children }) {
  const { can, isLoading } = useEntitlements();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('plan.gate.checking')}
      </div>
    );
  }

  if (!can(feature)) return <Navigate to="/" replace />;

  return children;
}
