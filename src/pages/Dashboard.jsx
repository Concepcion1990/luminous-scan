import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Clock3, Lock, Plus, ScanLine } from 'lucide-react';
import StatCard from '@/components/StatCard';
import ReorderPanel from '@/components/dashboard/ReorderPanel';
import LocationStockPanel from '@/components/dashboard/LocationStockPanel';
import AttentionPanel from '@/components/dashboard/AttentionPanel';
import PanelHeading from '@/components/dashboard/PanelHeading';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import OrdersToFulfil from '@/components/dashboard/OrdersToFulfil';
import IncomingStock from '@/components/dashboard/IncomingStock';
import { formatMoney, loadInventory, summarize } from '@/lib/inventory';
import { loadOperations } from '@/lib/dashboardOps';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { trialLabel, trialWarningDetails } from '@/lib/entitlements';
import { trialInAppNotice } from '@/lib/trialNotices';
import { displayLimit } from '@/lib/plans';
import PullToRefresh from '@/components/mobile/PullToRefresh';

/**
 * A stat card for a Business-only figure on Essentials: the number is never
 * shown, but the card stays in the grid so the page keeps its shape and the
 * customer can see what Business adds. Same locked-teaser shape as the
 * PlanGate lock screen, shrunk to a card.
 */
function LockedStatCard({ label, hint }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Lock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-muted-foreground">Business</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {hint}{' '}
        <Link to="/upgrade" className="font-medium text-primary underline underline-offset-2">
          See Business
        </Link>
      </p>
    </div>
  );
}

/** "Needs attention" for Essentials: same panel shape, no low-stock rows. */
function LockedAttentionPanel() {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <PanelHeading>Needs attention</PanelHeading>
      <div className="flex flex-1 flex-col items-start justify-center gap-2 px-4 py-6 sm:px-5">
        <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">Low-stock alerts are a Business feature</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Business watches every reorder point and flags what needs attention, instead of
          leaving it to a manual check.
        </p>
        <Link
          to="/upgrade"
          className="text-xs font-medium text-primary underline underline-offset-2"
        >
          See what Business includes
        </Link>
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { profile, activeId } = useBusiness();
  const { record: entitlementRecord, can, limits, isLoading: entitlementLoading } = useEntitlements();
  // Purchasing cards are Business-only. While the entitlement row is still
  // loading the plan is unknown (a missing row resolves to restricted
  // Essentials), so show nothing rather than flash Business cards to an
  // Essentials account — the PR #44 unknown-null pattern.
  // LIVE FINDING (2026-11-07): the Essentials home page showed the
  // "Incoming stock" and "Reorder suggestions" cards, both purchasing.
  const showPurchasing = !entitlementLoading && can('purchasing');
  // AUDIT FINDING 4: the Low-stock card and the Needs-attention panel are
  // the low-stock ALERTS surface (/low-stock and /alerts are PlanGate-
  // locked), and the Stock-value card is the valuation surface — so they
  // follow the same pattern. On Essentials they render as locked teasers
  // linking to /upgrade (the choice: a teaser, not a silent gap — the
  // customer sees what Business adds instead of a missing card). Passive
  // low-stock counts stay visible on the Products, Inventory and Category
  // pages by design; only the alerts surface is gated here.
  const showAlerts = !entitlementLoading && can('alerts');
  const showValuation = !entitlementLoading && can('valuation');
  // FINDING 36: a persistent quiet trial chip — the trial banner only
  // speaks at 5 days, 3 days and the last 24 hours, so on every other
  // trial day the Dashboard said nothing about the trial at all.
  const trialChip = trialLabel(entitlementRecord);
  // FINDING 36: a customer at 50/50 only discovered the cap on the
  // Products page. The hint below the New product button says so here.
  const productLimit = displayLimit(limits.products, entitlementLoading);
  const trialNotice = trialWarningDetails(entitlementRecord);
  const trialNoticeStage = trialNotice?.warningStage;
  const isPrelaunch = trialNotice?.kind === 'prelaunch';
  // Concepcion's three in-app notices (5 days, 3 days, 24 hours) come
  // from trialInAppNotice; the pre-launch preview keeps its own banner.
  const inAppNotice = trialInAppNotice(entitlementRecord);
  const showTrialBanner = isPrelaunch ? Boolean(trialNoticeStage) : Boolean(inAppNotice);
  const [data, setData] = useState(null);
  const [ops, setOps] = useState({ orders: [], purchaseOrders: [] });
  const [loading, setLoading] = useState(true);
  const currentBusinessRef = useRef(activeId);
  currentBusinessRef.current = activeId;

  // Refetch both dashboard sources without clearing the displayed totals.
  const refresh = useCallback(async () => {
    const [inventory, operations] = await Promise.all([
      loadInventory(activeId || ''),
      loadOperations(activeId || '', { includePurchaseOrders: showPurchasing }),
    ]);
    if (currentBusinessRef.current !== activeId) return;
    setData(inventory);
    setOps(operations);
  }, [activeId, showPurchasing]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      loadInventory(activeId || ''),
      loadOperations(activeId || '', { includePurchaseOrders: showPurchasing }),
    ])
      .then(([inventory, operations]) => {
        if (!alive) return;
        setData(inventory);
        setOps(operations);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeId, showPurchasing]);

  const stats = data ? summarize(data) : null;
  const atProductLimit =
    productLimit != null && stats != null && stats.activeSkus >= productLimit;

  return (
    <PullToRefresh className="space-y-6" onRefresh={refresh}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {profile.name} · {format(new Date(), 'EEEE, d MMMM')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Inventory overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats && stats.perLocation.length > 0
              ? `Live positions across ${stats.perLocation.length} location${
                  stats.perLocation.length === 1 ? '' : 's'
                } · every movement lands here.`
              : 'Set up your locations and products to start tracking.'}
          </p>
          {trialChip && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
              <Clock3 className="h-3 w-3" aria-hidden="true" /> {trialChip}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <Link
              to="/scan"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <ScanLine className="h-4 w-4" />
              Scan an item
            </Link>
            <Link
              to="/products"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              New product
            </Link>
          </div>
          {atProductLimit && (
            <p className="text-xs text-muted-foreground">
              Products {stats.activeSkus} of {productLimit} —{' '}
              <Link to="/upgrade" className="font-medium text-primary underline underline-offset-2">
                Upgrade for unlimited products
              </Link>
            </p>
          )}
        </div>
      </div>

      {showTrialBanner && (
        <div role="status" className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-secondary px-4 py-3">
          <Clock3 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {isPrelaunch
                ? (trialNoticeStage === 'one-day'
                  ? 'Your seven-day pre-launch preview check-in is within 24 hours'
                  : 'Your seven-day pre-launch preview check-in is within 3 days')
                : inAppNotice.message}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {isPrelaunch
                ? 'This is an informational seven-day preview reminder. Complimentary access continues, and no payment is scheduled.'
                : 'Check your plan and cancellation options. This is an in-app trial reminder, not confirmation of a scheduled payment.'}
            </p>
          </div>
          <Link
            to="/settings"
            className="inline-flex min-h-10 items-center rounded-md border border-border bg-card px-3 text-xs font-semibold underline underline-offset-2"
          >
            View subscription settings
          </Link>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[104px] animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Units on hand" value={stats.totalUnits.toLocaleString()} hint="Across all locations" />
            <StatCard label="Active SKUs" value={stats.activeSkus.toLocaleString()} hint="Tracked products" />
            {entitlementLoading ? (
              <>
                <div className="h-[104px] animate-pulse rounded-xl border border-border bg-card" />
                <div className="h-[104px] animate-pulse rounded-xl border border-border bg-card" />
              </>
            ) : (
              <>
                {showAlerts ? (
                  <StatCard
                    label="Low stock"
                    value={stats.low.length}
                    unit="alerts"
                    tone={stats.low.length > 0 ? 'warn' : 'default'}
                    hint="At or below reorder point"
                  />
                ) : (
                  <LockedStatCard label="Low stock" hint="Low-stock alerts are a Business feature." />
                )}
                {showValuation ? (
                  <StatCard
                    label="Stock value"
                    value={formatMoney(stats.stockValue, profile.currency)}
                    tone="ok"
                    hint="At current cost"
                  />
                ) : (
                  <LockedStatCard label="Stock value" hint="Stock valuation is a Business feature." />
                )}
              </>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <LocationStockPanel perLocation={stats.perLocation} />
            </div>
            {entitlementLoading ? (
              <div className="h-[220px] animate-pulse rounded-xl border border-border bg-card" />
            ) : showAlerts ? (
              <AttentionPanel low={stats.low} />
            ) : (
              <LockedAttentionPanel />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ActivityFeed movements={data.movements} />
            </div>
            <div className="space-y-4">
              <OrdersToFulfil orders={ops.orders} currency={profile.currency} />
              {showPurchasing && <IncomingStock purchaseOrders={ops.purchaseOrders} />}
            </div>
          </div>

          {showPurchasing && (
            <ReorderPanel items={stats.low} currency={profile.currency} businessId={activeId} />
          )}
        </>
      )}
    </PullToRefresh>
  );
}