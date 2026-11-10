import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReorderPanel from '@/components/dashboard/ReorderPanel';
import PlanGate from '@/components/plan/PlanGate';
import { loadInventory, summarize } from '@/lib/inventory';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';

export default function LowStock() {
  const { profile, activeId } = useBusiness();
  // In-page mirror of the route-level PlanGate (App.jsx): the page is safe
  // on its own if it is ever rendered without the route gate. While the
  // entitlement is still loading the plan is unknown, so nothing is locked
  // yet — the same fail-open-while-loading shape PlanGate itself uses.
  const { can, isLoading: entitlementLoading } = useEntitlements();
  const [low, setLow] = useState(null);

  useEffect(() => {
    setLow(null);
    loadInventory(activeId || '').then((inventory) => setLow(summarize(inventory).low));
  }, [activeId]);

  if (!entitlementLoading && !can('alerts')) return <PlanGate feature="alerts" />;

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Reorder suggestions
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Low stock</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every product at or below its reorder point, by location — turn them into a purchase order in
          one tap.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          <Link to="/products" className="underline underline-offset-2 hover:text-foreground">
            Set reorder points
          </Link>{' '}
          on a product so it shows up here.
        </p>
      </div>

      {low === null ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Loading suggestions…
        </div>
      ) : (
        <ReorderPanel items={low} currency={profile.currency} businessId={activeId} />
      )}
    </div>
  );
}