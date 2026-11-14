/**
 * Cross-store inbox — T6.2. The receiving store's surface for the
 * requests T6 built only as an endpoint: staff here see the requests
 * OTHER stores sent them (incoming — "ship this to us / bring it
 * over") and the requests THIS store sent out (outgoing), and can
 * acknowledge, resolve or decline an incoming one.
 *
 * The page also carries the transfer door (Nov 13, 2026): an
 * owner-only panel that moves stock directly into another owned
 * store through POST /businesses/:bid/cross-business-move — the
 * requests below are for asking; the door is for the owner doing.
 *
 * Business-only by nature: Essentials has one store, so there is
 * nowhere else to look. The route is PlanGate-wrapped in App.jsx,
 * the nav entry carries feature 'crossStore', and this page mirrors
 * the gate in-page (finding 36 pattern) so it is safe on its own.
 * The server still decides: create/lookup refuse Essentials with
 * cross_store_business_only, and only the target store's staff can
 * answer a request (everyone else gets 404).
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, Check, Inbox, Send, Store, X } from 'lucide-react';
import { base44 } from '@/api/client';
import { t } from '@/lib/i18n';
import PlanGate from '@/components/plan/PlanGate';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import {
  listCrossStoreRequests,
  updateCrossStoreRequest,
  moveStockBetweenBusinesses,
  crossStoreStatusLabel,
  crossStoreModeLabel,
  canAnswerCrossStoreRequest,
} from '@/lib/crossStore';
import { getLevelsForProduct } from '@/lib/inventory';
import { scoped } from '@/lib/scoped';
import { toLocalDate } from '@/lib/dates';

function formatWhen(value) {
  const date = toLocalDate(value);
  if (!date) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusTone(status) {
  switch (status) {
    case 'open':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100';
    case 'acknowledged':
      return 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100';
    case 'resolved':
      return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100';
    case 'declined':
      return 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function RequestCard({ request, direction, onAnswer, busyId }) {
  const otherStore =
    direction === 'incoming'
      ? request.business_name || t('crossStore.anotherStore')
      : request.target_business_name || t('crossStore.anotherStore');
  const busy = busyId === request.id;
  const answerable = direction === 'incoming' && canAnswerCrossStoreRequest(request);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{request.product_name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {request.sku ? `${request.sku} · ` : ''}
            {crossStoreModeLabel(request.mode)} ·{' '}
            {direction === 'incoming'
              ? t('crossStore.fromStore', { store: otherStore })
              : t('crossStore.toStore', { store: otherStore })}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusTone(request.status)}`}>
          {crossStoreStatusLabel(request.status)}
        </span>
      </div>

      {request.message ? (
        <p className="mt-2 text-sm leading-relaxed">“{request.message}”</p>
      ) : null}

      <p className="mt-2 text-xs text-muted-foreground">
        {request.requested_by
          ? t('crossStore.askedBy', { name: request.requested_by })
          : t('crossStore.askedByStaff')}
        {request.created_at ? ` · ${formatWhen(request.created_at)}` : ''}
      </p>

      {answerable && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {request.status === 'open' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAnswer(request, 'acknowledged')}>
              {busy ? t('crossStore.sending') : t('crossStore.acknowledge')}
            </Button>
          )}
          <Button size="sm" disabled={busy} onClick={() => onAnswer(request, 'resolved')}>
            <Check className="mr-1.5 h-3.5 w-3.5" /> {busy ? t('crossStore.sending') : t('crossStore.markDone')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAnswer(request, 'declined')}>
            <X className="mr-1.5 h-3.5 w-3.5" /> {busy ? t('crossStore.sending') : t('crossStore.decline')}
          </Button>
        </div>
      )}
    </div>
  );
}

const transferLabelCls = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const transferFieldCls =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * The transfer door (Nov 13, 2026): the owner moves stock DIRECTLY
 * from this store into another store they own — no request, no
 * waiting for an answer. The engine is the tested server endpoint
 * POST /businesses/:bid/cross-business-move; this panel is its
 * first client. Owner-only twice over: the panel renders only for
 * the business's creator, its target list only offers businesses
 * the same person owns, and the server refuses anyone else anyway.
 * A matching SKU in the target merges; otherwise the product is
 * copied over with the stock. Both stores keep a ledger record.
 */
function TransferPanel({ activeId, businesses, user }) {
  const { toast } = useToast();
  const targets = businesses.filter(
    (row) => row.id !== activeId && (row.owner_id === user?.id || row.created_by_id === user?.id),
  );
  const [targetId, setTargetId] = useState('');
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [locations, setLocations] = useState([]);
  const [levels, setLevels] = useState([]);
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocations, setToLocations] = useState([]);
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  useEffect(() => {
    if (!targetId && targets.length) setTargetId(targets[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets.length, targetId]);

  useEffect(() => {
    if (!activeId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [prodPage, locPage] = await Promise.all([
          base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
          base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
        ]);
        if (cancelled) return;
        setProducts(prodPage.items ?? []);
        setLocations(locPage.items ?? []);
      } catch {
        // The panel stays empty; a move attempt surfaces the error.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const refreshLevels = useCallback(async () => {
    if (!activeId || !productId) {
      setLevels([]);
      setFromLocationId('');
      return;
    }
    const rows = await getLevelsForProduct(productId, activeId);
    setLevels(rows);
    setFromLocationId((current) => {
      if (rows.some((row) => row.location_id === current)) return current;
      const stocked = rows.find((row) => Number(row.quantity) > 0);
      return stocked?.location_id || rows[0]?.location_id || '';
    });
  }, [activeId, productId]);

  useEffect(() => {
    refreshLevels().catch(() => {});
  }, [refreshLevels]);

  useEffect(() => {
    if (!targetId) {
      setToLocations([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const page = await base44.entities.Location.filter(scoped({}, targetId), {
          sort: 'name',
          limit: 100,
        });
        if (!cancelled) setToLocations(page.items ?? []);
      } catch {
        if (!cancelled) setToLocations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  const locationName = (id) => locations.find((row) => row.id === id)?.name || '';
  const fromOptions = levels.map((row) => ({
    id: row.location_id,
    name: locationName(row.location_id),
    qty: Number(row.quantity ?? 0),
  }));
  const onHand = fromOptions.find((row) => row.id === fromLocationId)?.qty ?? 0;
  const product = products.find((row) => row.id === productId);
  const target = targets.find((row) => row.id === targetId);
  const qtyNum = Number(quantity);
  const canSubmit =
    Boolean(targetId && productId && fromLocationId) &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    qtyNum <= onHand &&
    !busy;

  const submit = async () => {
    setBusy(true);
    setDone('');
    try {
      await moveStockBetweenBusinesses(activeId, {
        targetBusinessId: targetId,
        items: [
          {
            product_id: productId,
            location_id: fromLocationId,
            quantity: qtyNum,
            ...(toLocationId ? { to_location_id: toLocationId } : {}),
          },
        ],
      });
      const message = t('crossStore.transferSuccess', {
        quantity: qtyNum,
        product: product?.name || '',
        store: target?.name || '',
      });
      setDone(message);
      toast({ title: message });
      setQuantity('');
      await refreshLevels().catch(() => {});
    } catch (err) {
      toast({
        title: t('crossStore.transferFailed'),
        description: err?.message || t('crossStore.tryAgain'),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t('crossStore.transferTitle')}
      className="rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{t('crossStore.transferTitle')}</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('crossStore.transferIntro')}</p>

      {targets.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          {t('crossStore.transferNoTargets')}
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block space-y-1.5">
              <span className={transferLabelCls}>{t('crossStore.transferTarget')}</span>
              <select
                className={transferFieldCls}
                value={targetId}
                onChange={(event) => {
                  setTargetId(event.target.value);
                  setToLocationId('');
                }}
              >
                {targets.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className={transferLabelCls}>{t('crossStore.transferProduct')}</span>
              <select
                className={transferFieldCls}
                value={productId}
                onChange={(event) => {
                  setProductId(event.target.value);
                  setQuantity('');
                  setDone('');
                }}
              >
                <option value="">{t('crossStore.transferChooseProduct')}</option>
                {products.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                    {row.sku ? ` · ${row.sku}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className={transferLabelCls}>{t('crossStore.transferFromLocation')}</span>
              <select
                className={transferFieldCls}
                value={fromLocationId}
                disabled={!productId}
                onChange={(event) => setFromLocationId(event.target.value)}
              >
                {fromOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · {t('crossStore.transferOnHand', { count: row.qty })}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className={transferLabelCls}>{t('crossStore.transferToLocation')}</span>
              <select
                className={transferFieldCls}
                value={toLocationId}
                onChange={(event) => setToLocationId(event.target.value)}
              >
                <option value="">{t('crossStore.transferToFirstLocation')}</option>
                {toLocations.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className={transferLabelCls}>{t('crossStore.transferQuantity')}</span>
              <input
                className={transferFieldCls}
                type="number"
                min="1"
                max={onHand || undefined}
                step="any"
                value={quantity}
                disabled={!productId}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <Button size="sm" disabled={!canSubmit} onClick={submit}>
              <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
              {busy ? t('crossStore.sending') : t('crossStore.transferButton')}
            </Button>
            {done ? (
              <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
                <Check className="h-4 w-4" /> {done}
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

export default function CrossStoreInbox() {
  const { profile, activeId, businesses, user, record } = useBusiness();
  const { toast } = useToast();
  // In-page mirror of the route-level PlanGate (App.jsx): the page is safe
  // on its own if it is ever rendered without the route gate. While the
  // entitlement is still loading the plan is unknown, so nothing is locked
  // yet — the same fail-open-while-loading shape PlanGate itself uses.
  const { can, isLoading: entitlementLoading } = useEntitlements();
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    if (!activeId) {
      setIncoming([]);
      setOutgoing([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await listCrossStoreRequests(activeId);
      setIncoming(data.incoming);
      setOutgoing(data.outgoing);
    } catch (err) {
      setError(err?.message || t('crossStore.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    load();
  }, [load]);

  const answer = async (request, status) => {
    setBusyId(request.id);
    try {
      const updated = await updateCrossStoreRequest(activeId, request.id, status);
      setIncoming((current) => current.map((row) => (row.id === request.id ? updated : row)));
    } catch (err) {
      toast({
        title: t('crossStore.updateFailed'),
        description: err?.message || t('crossStore.tryAgain'),
        variant: 'destructive',
      });
    } finally {
      setBusyId('');
    }
  };

  if (!entitlementLoading && !can('crossStore')) return <PlanGate feature="crossStore" />;

  // The transfer door is the owner's alone (the endpoint 403s anyone
  // else): the panel renders only for the business's creator.
  const isOwner = Boolean(record?.id && user?.id && record.created_by_id === user.id);

  const openIncoming = incoming.filter((row) => row.status === 'open' || row.status === 'acknowledged');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {profile?.name ? t('crossStore.eyebrow', { name: profile.name }) : t('crossStore.eyebrowPlain')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('crossStore.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('crossStore.subtitle')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? t('crossStore.loading') : t('crossStore.refresh')}
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {isOwner ? <TransferPanel activeId={activeId} businesses={businesses} user={user} /> : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('crossStore.loadingRequests')}</p>
      ) : (
        <>
          <section aria-label={t('crossStore.incomingSection')}>
            <div className="mb-2 flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">
                {openIncoming.length
                  ? t('crossStore.incomingWaiting', { count: openIncoming.length })
                  : t('crossStore.incoming')}
              </h2>
            </div>
            {incoming.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {t('crossStore.noIncoming')}
              </p>
            ) : (
              <div className="space-y-3">
                {incoming.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    direction="incoming"
                    onAnswer={answer}
                    busyId={busyId}
                  />
                ))}
              </div>
            )}
          </section>

          <section aria-label={t('crossStore.outgoingSection')}>
            <div className="mb-2 flex items-center gap-2">
              <Send className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">{t('crossStore.outgoing')}</h2>
            </div>
            {outgoing.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {t('crossStore.noOutgoing')}
              </p>
            ) : (
              <div className="space-y-3">
                {outgoing.map((request) => (
                  <RequestCard key={request.id} request={request} direction="outgoing" />
                ))}
              </div>
            )}
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Store className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t('crossStore.outgoingNote')}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
