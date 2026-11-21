import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { assessCancellationGrace } from '@/lib/cancellationGrace';
import { isBoss } from '@/lib/bossAuthority';

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
  const { user, record: businessRecord, isLoading: workspaceLoading } = useBusiness();
  const { activeId, status, record, planKey, isLoading: entitlementLoading } = useEntitlements();

  if (workspaceLoading || entitlementLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
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
      // A founding tester's workspace (Nov 21, 2026): Business
      // free for life by the operator's comp — no subscription
      // behind it, no expiry. Unlike the publisher's
      // grandfathered workspace it belongs to a real business,
      // so its members enter like any Business workspace's.
      (status === 'founding_tester' && planKey === 'business') ||
      (status === 'canceled' && withinPaidPeriod) ||
      (status === 'grandfathered' && isBoss(user, businessRecord) && planKey === 'business'));

  if (!allowed) {
    const grace = assessCancellationGrace({ status, paidThrough: record?.period_ends_at });
    if (grace.state === 'grace') {
      return <Navigate to="/grace" replace state={{ from: location.pathname }} />;
    }
    // The NEUTRAL STOP (owner's ruling, Nov 19, 2026): a non-owner
    // member of a business whose access has ended does NOT land
    // on the pricing page — money is the owner's business alone.
    // They get the same neutral stop the grace view shows them.
    // (A signed-in user with no business at all keeps the
    // historical /plans flow: there is no membership to protect.)
    if (businessRecord && !isBoss(user, businessRecord)) {
      return <Navigate to="/grace" replace state={{ from: location.pathname }} />;
    }
  }

  return allowed
    ? <Outlet />
    : <Navigate to="/plans" replace state={{ from: location.pathname }} />;
}