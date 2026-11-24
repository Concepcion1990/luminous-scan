import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useDataFresh from '@/hooks/useDataFresh';
import { dataVersion } from '@/lib/dataFreshness';
import { formatHeaderDate } from '@/lib/dates';
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
import { isBoss } from '@/lib/bossAuthority';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import useStaffAccess from '@/hooks/useStaffAccess';
import { trialLabel, trialWarningDetails } from '@/lib/entitlements';
import { trialInAppNotice } from '@/lib/trialNotices';
import { displayLimit } from '@/lib/plans';
import { t } from '@/lib/i18n';

export default function Dashboard() {
  const { profile, activeId, user, record } = useBusiness();
  // Money information is the owner's alone (Nov 19, 2026): the
  // trial banner and the trial chip are subscription news, so
  // they render for the boss only. Staff, managers and viewers
  // see neither — no banner, no chip, no teaser.
  const boss = isBoss(user, record);
  const { record: entitlementRecord, can, limits, isLoading: entitlementLoading } = useEntitlements();
  // No dangling doors (owner ruling, Nov 19, 2026): the New product
  // button hangs on this page only for a person who can actually
  // create products — products.edit, or the owner's per-member
  // products.create tick. Everyone else never sees it.
  const { can: canStaff } = useStaffAccess();
  const canCreateProducts = canStaff('products.edit') || canStaff('products.create');
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
  // cards do not render at all. The panel at first kept its normal
  // empty state on Essentials — until the owner caught the lie in it
  // (Nov 20, 2026: the Stock-by-location card said "1 low" while the
  // panel below said "Nothing below its reorder point") and ruled the
  // whole box belongs to Business: on Essentials the panel does not
  // render at all, and neither does any other low-stock trace (the
  // location card's low counts included — the Nov 20 sweep took every
  // low-stock surface off Essentials, Products/Inventory/Categories
  // included).
  // The per-person layer (owner ruling, Nov 20, 2026): on
  // Business the alert surfaces belong to the owner, and to a
  // member only when the owner handed them the alerts.view
  // enrollment tick. An unticked member's Overview carries no
  // Needs attention box, no low-stock card and no low counts —
  // the surfaces do not exist for that person.
  const showAlerts = !entitlementLoading && can('alerts') && canStaff('alerts.view');
  const showValuation = !entitlementLoading && can('valuation');
  // FINDING 36: a persistent quiet trial chip — the trial banner only
  // speaks at 5 days, 3 days and the last 24 hours, so on every other
  // trial day the Dashboard said nothing about the trial at all.
  const trialChip = boss ? trialLabel(entitlementRecord) : null;
  // FINDING 36: a customer at 50/50 only discovered the cap on the
  // Products page. The hint below the New product button says so here.
  const productLimit = displayLimit(limits.products, entitlementLoading);
  const trialNotice = trialWarningDetails(entitlementRecord);
  const trialNoticeStage = trialNotice?.warningStage;
  const isPrelaunch = trialNotice?.kind === 'prelaunch';
  // Concepcion's three in-app notices (5 days, 3 days, 24 hours) come
  // from trialInAppNotice; the pre-launch preview keeps its own banner.
  const inAppNotice = trialInAppNotice(entitlementRecord);
  const showTrialBanner = boss && (isPrelaunch ? Boolean(trialNoticeStage) : Boolean(inAppNotice));
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
  // The limit hint speaks the one counting rule (owner, Nov 14,
  // 2026): distinct originals — the same number the server cap
  // enforces and the Active SKUs card shows. A hint counting rows
  // while the gate counts products would be a lie at the boundary.
  // The at-cap hint names the plan limit and links to the plan
  // page — money-class information (money-surfaces audit, Nov 19,
  // 2026), so it renders for the boss only, like the trial chip
  // and banner above.
  const atProductLimit =
    boss && productLimit != null && stats != null && stats.distinctSkus >= productLimit;

  return (
    <div className="space-y-6" data-tour="overview">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {profile.name} · {formatHeaderDate(new Date())}
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
            {canCreateProducts && (
              <Link
                to="/products"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Plus className="h-4 w-4" />
                {t('dashboard.newProduct')}
              </Link>
            )}
          </div>
          {atProductLimit && canCreateProducts && (
            <p className="text-xs text-muted-foreground">
              {t('dashboard.productLimit', { count: stats.distinctSkus, limit: productLimit })}{' '}
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
            <StatCard label={t('dashboard.activeSkus')} value={stats.distinctSkus.toLocaleString()} hint={t('dashboard.trackedProducts')} />
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
                    value={formatMoney(stats.stockValue, profile.currency, 2)}
                    tone="ok"
                    hint={`${t('dashboard.atCurrentCost')} · ${t('dashboard.atSellingPrice')}: ${formatMoney(stats.retailValue, profile.currency, 2)}`}
                  />
                )}
              </>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <LocationStockPanel perLocation={stats.perLocation} showLow={showAlerts} />
            </div>
            {entitlementLoading ? (
              <div className="h-[220px] animate-pulse rounded-xl border border-border bg-card" />
            ) : showAlerts ? (
              <AttentionPanel low={stats.low} />
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ActivityFeed
                movements={data.movements}
                importEvents={data.importEvents ?? []}
              />
            </div>
            <div className="space-y-4">
              <OrdersToFulfil orders={ops.orders} currency={profile.currency} />
              {showPurchasing && <IncomingStock purchaseOrders={ops.purchaseOrders} />}
            </div>
          </div>

          {/* Reorder suggestions name the low products, so this
              panel is a low-stock ALERT surface too (owner ruling,
              Nov 20, 2026): it follows the same effective alert
              visibility as every other low-stock surface —
              showAlerts (the plan's alerts feature, and for a
              member the owner's alerts.view tick). An unticked
              Business member sees no product named as low here.
              Incoming stock above stays on showPurchasing alone:
              it names open purchase orders, not low products. */}
          {showPurchasing && showAlerts && (
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