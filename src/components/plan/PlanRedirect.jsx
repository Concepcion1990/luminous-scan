import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import useEntitlements from '@/hooks/useEntitlements';
import useStaffAccess from '@/hooks/useStaffAccess';
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
 *
 * The optional `perm` is the per-person layer (owner ruling,
 * Nov 20, 2026): an owner-handed enrollment tick the signed-in
 * person must also hold — the Low stock and Alerts routes carry
 * the alerts.view tick, so on Business an unticked member's typed
 * URL bounces quietly to the Overview just as an Essentials one
 * does. The owner holds every tick inherently.
 */
export default function PlanRedirect({ feature, perm, children }) {
  const { can, isLoading } = useEntitlements();
  const { can: canStaff, loading: staffLoading } = useStaffAccess();

  if (isLoading || (perm && staffLoading)) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('plan.gate.checking')}
      </div>
    );
  }

  if (!can(feature)) return <Navigate to="/" replace />;
  if (perm && !canStaff(perm)) return <Navigate to="/" replace />;

  return children;
}
