import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { assessCancellationGrace } from '@/lib/cancellationGrace';

/**
 * Do not render the inventory workspace until the selected business has a
 * provider-confirmed paid/trial entitlement. Keep the publisher's admin
 * complimentary Business workspace available for testing.
 *
 * A canceled subscription past its paid-through date but still inside the
 * 15-day read-only grace window does NOT get the workspace — it gets the
 * /grace view (products only, nothing else). Past grace, /plans as before.
 */
export default function SubscriptionAccessRoute() {
  const location = useLocation();
  const { user, isLoading: workspaceLoading } = useBusiness();
  const { activeId, status, record, planKey, isLoading: entitlementLoading } = useEntitlements();

  if (workspaceLoading || entitlementLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
      </div>
    );
  }

  const paidThrough = Date.parse(record?.period_ends_at || '');
  const withinPaidPeriod = Number.isFinite(paidThrough) && paidThrough > Date.now();
  const allowed =
    Boolean(activeId) &&
    (status === 'active' ||
      status === 'trialing' ||
      status === 'past_due' ||
      (status === 'canceled' && withinPaidPeriod) ||
      (status === 'grandfathered' && user?.role === 'admin' && planKey === 'business'));

  if (!allowed) {
    const grace = assessCancellationGrace({ status, paidThrough: record?.period_ends_at });
    if (grace.state === 'grace') {
      return <Navigate to="/grace" replace state={{ from: location.pathname }} />;
    }
  }

  return allowed
    ? <Outlet />
    : <Navigate to="/plans" replace state={{ from: location.pathname }} />;
}