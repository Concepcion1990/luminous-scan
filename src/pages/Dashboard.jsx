import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useDataFresh from '@/hooks/useDataFresh';
import { dataVersion } from '@/lib/dataFreshness';
import { format } from 'date-fns';
import { Clock3, Plus, ScanLine } from 'lucide-react';
import StatCard from '@/components/StatCard';
import ReorderPanel from '@/components/dashboard/ReorderPanel';
import LocationStockPanel from '@/components/dashboard/LocationStockPanel';
import AttentionPanel from '@/components/dashboard/AttentionPanel';
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
import { t } from '@/lib/i18n';

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
  // the low-stock ALERTS surface (/low-stock and /alerts are Business-
  // only), and the Stock-value card is the valuation surface — so they
  // follow the same pattern. They once rendered on Essentials as locked
  // teaser cards linking to /upgrade; the owner's invisibility ruling
  // (Nov 14, 2026 — "anything pertaining to business shouldn't be
  // popping up on essentials") superseded that: on Essentials the two
  // cards do not render at all, and the Needs-attention panel shows
  // only its normal empty state (its rows are the Business alerts
  // surface; the upsell block is gone, nothing invented in its place).
  // Passive low-stock counts stay visible on the Products, Inventory
  // and Category pages by design; only the alerts surface is gated here.
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
  // Which business has completed a load here. A background refetch
  // (freshness bus, filter change) must never blank a list that
  // already has content — the loading state is only for the first
  // load of a business, when there is nothing to show yet (owner
  // ruling, Nov 14, 2026: a stepper tap flashed "Loading catalog…").
  const loadedForRef = useRef('');
  const [reload, setReload] = useState(0);
  // Kept alive in a hidden tab layer like Products: when inventory
  // changes on another screen, refetch on becoming visible so the
  // summary (active SKUs, units on hand) agrees with the catalog.
  useDataFresh('inventory', '/', () => setReload((r) => r + 1));

  useEffect(() => {
    let alive = true;
    let retryTimer = null;
    if (loadedForRef.current !== activeId) setLoading(true);
    // The freshness version this load answers for. If a change
    // lands while the load is in flight, the load's snapshot may
    // predate it — and such a paint must NEVER land (Nov 14, 2026:
    // the Overview sat empty ~15s, then painted the numbers from
    // before a product was created). The bump that moved the
    // version already raised `reload`, so a newer run of this
    // effect owns the next paint; this run drops its snapshot.
    const startVersion = dataVersion('inventory');
    let attempt = 0;
    const load = () => {
      attempt += 1;
      Promise.all([
        loadInventory(activeId || ''),
        loadOperations(activeId || '', { includePurchaseOrders: showPurchasing }),
      ])
        .then(([inventory, operations]) => {
          if (!alive) return;
          if (dataVersion('inventory') !== startVersion) return;
          setData(inventory);
          setOps(operations);
          loadedForRef.current = activeId;
          setLoading(false);
        })
        .catch(() => {
          if (!alive) return;
          // A failed load must not clear the loading state over
          // the previous snapshot — that is exactly how stale
          // numbers once painted as if current. Retry with
          // backoff instead; the paint only ever lands on a load
          // that succeeded and is still current.
          if (attempt <= 6) {
            retryTimer = setTimeout(load, Math.min(800 * attempt, 5000));
          } else {
            setLoading(false);
          }
        });
    };
    load();
    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [activeId, showPurchasing, reload]);

  const stats = data ? summarize(data) : null;
  const atProductLimit =
    productLimit != null && stats != null && stats.activeSkus >= productLimit;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {profile.name} · {format(new Date(), 'EEEE, d MMMM')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('dashboard.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats && stats.perLocation.length > 0
              ? t('dashboard.livePositions', {
                  count: stats.perLocation.length,
                  s: stats.perLocation.length === 1 ? '' : 's',
                })
              : t('dashboard.emptySubtitle')}
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
              {t('dashboard.scanItem')}
            </Link>
            <Link
              to="/products"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Plus className="h-4 w-4" />
              {t('dashboard.newProduct')}
            </Link>
          </div>
          {atProductLimit && (
            <p className="text-xs text-muted-foreground">
              {t('dashboard.productLimit', { count: stats.activeSkus, limit: productLimit })}{' '}
              <Link to="/upgrade" className="font-medium text-link underline underline-offset-2">
                {t('dashboard.upgradeUnlimited')}
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
                  ? t('dashboard.prelaunchOneDay')
                  : t('dashboard.prelaunchThreeDays'))
                : inAppNotice.message}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {isPrelaunch
                ? t('dashboard.prelaunchBody')
                : t('dashboard.trialReminderBody')}
            </p>
          </div>
          <Link
            to="/settings"
            className="inline-flex min-h-10 items-center rounded-md border border-border bg-card px-3 text-xs font-semibold underline underline-offset-2"
          >
            {t('dashboard.viewSubscriptionSettings')}
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
            <StatCard label={t('dashboard.unitsOnHand')} value={stats.totalUnits.toLocaleString()} hint={t('dashboard.acrossAllLocations')} />
            <StatCard label={t('dashboard.activeSkus')} value={stats.activeSkus.toLocaleString()} hint={t('dashboard.trackedProducts')} />
            {entitlementLoading ? (
              <>
                <div className="h-[104px] animate-pulse rounded-xl border border-border bg-card" />
                <div className="h-[104px] animate-pulse rounded-xl border border-border bg-card" />
              </>
            ) : (
              <>
                {showAlerts && (
                  <StatCard
                    label={t('dashboard.lowStock')}
                    value={stats.low.length}
                    unit={t('dashboard.alertsUnit')}
                    tone={stats.low.length > 0 ? 'warn' : 'default'}
                    hint={t('dashboard.atOrBelowReorder')}
                  />
                )}
                {showValuation && (
                  <StatCard
                    label={t('dashboard.stockValue')}
                    value={formatMoney(stats.stockValue, profile.currency)}
                    tone="ok"
                    hint={t('dashboard.atCurrentCost')}
                  />
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
              <AttentionPanel low={[]} />
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

          <p className="pt-1 text-center text-xs text-muted-foreground">
            {t('bookshop.dashboardLine')}{' '}
            <a
              href="https://theluminousbookshop.com"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-link underline underline-offset-2"
            >
              {t('bookshop.visit')}
            </a>
          </p>
        </>
      )}
    </div>
  );
}