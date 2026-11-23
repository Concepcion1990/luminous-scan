import { useEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { assessCancellationGrace, failedPaymentRoadState } from '@/lib/cancellationGrace';
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

/** A plan row that opens the app for its business (mirrors `allowed` below). */
function rowGrantsEntry(row) {
  if (!row) return false;
  if (['active', 'trialing', 'past_due', 'founding_tester'].includes(row.status)) return true;
  if (row.status === 'canceled') {
    const ends = Date.parse(row.period_ends_at || '');
    return Number.isFinite(ends) && ends > Date.now();
  }
  return false;
}

export default function SubscriptionAccessRoute() {
  const location = useLocation();
  const {
    user,
    record: businessRecord,
    businesses,
    plans,
    plansLoading,
    switchTo,
    isLoading: workspaceLoading,
  } = useBusiness();
  const { activeId, status, record, planKey, isLoading: entitlementLoading } = useEntitlements();
  const rescueAttemptedFor = useRef(null);

  const paidThrough = Date.parse(record?.period_ends_at || '');
  const withinPaidPeriod = Number.isFinite(paidThrough) && paidThrough > Date.now();
  // The failed-payment road (release 341): while the road runs,
  // the workspace stays OPEN — full use inside the 14-day payment
  // grace, and view-only inside the 15 days after cancellation
  // (the server refuses every write there; staff can still look
  // and reach their own pay stubs). Only when the view-only days
  // are over does the road close the door like any ended account.
  const road = failedPaymentRoadState(record);
  const onRoad = road.state === 'grace' || road.state === 'view_only';
  const allowed =
    Boolean(activeId) &&
    (status === 'active' ||
      status === 'trialing' ||
      (status === 'past_due' && road.state !== 'deletion_due') ||
      (status === 'canceled' && onRoad) ||
      // A founding tester's workspace (Nov 21, 2026): Business
      // free for life by the operator's comp — no subscription
      // behind it, no expiry. Unlike the publisher's
      // grandfathered workspace it belongs to a real business,
      // so its members enter like any Business workspace's.
      (status === 'founding_tester' && planKey === 'business') ||
      (status === 'canceled' && withinPaidPeriod) ||
      (status === 'grandfathered' && isBoss(user, businessRecord) && planKey === 'business'));

  // The boot rescue (release 356, Nov 23, 2026): the active
  // business has never been entitled — no row of its own and
  // nothing inherited (status reads pending_checkout) — but the
  // signed-in user OWNS another business whose plan row grants
  // entry. Boot must open the business they can work in, never
  // wall them off on the public pages while a healthy business
  // sits behind the switcher they cannot reach. (Before 356 an
  // added business stranded its owner exactly this way.)
  // Narrow by construction: it fires only for the never-entitled
  // state — a business carrying a real row (canceled, in grace,
  // on the failed-payment road) keeps its existing road below,
  // so the grace view stays reachable and no switch loop can
  // form — and only toward a business the user owns.
  const rescueTarget =
    !allowed &&
    status === 'pending_checkout' &&
    user &&
    !workspaceLoading &&
    !entitlementLoading &&
    !plansLoading
      ? businesses.find(
          (business) =>
            business.id !== activeId &&
            (business.owner_id === user.id || business.created_by_id === user.id) &&
            rowGrantsEntry(plans.find((row) => row.business_id === business.id)),
        ) ?? null
      : null;

  useEffect(() => {
    if (!rescueTarget) return;
    if (rescueAttemptedFor.current === activeId) return;
    rescueAttemptedFor.current = activeId;
    void switchTo(rescueTarget.id).catch(() => {});
  }, [rescueTarget, activeId, switchTo]);

  if (workspaceLoading || entitlementLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
      </div>
    );
  }

  if (rescueTarget) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-foreground" />
      </div>
    );
  }

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
