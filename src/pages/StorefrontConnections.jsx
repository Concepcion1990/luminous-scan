/**
 * Storefront connections — release 362.
 *
 * The owner's ruling (Nov 23, 2026): a seller connects their
 * eBay storefront ONCE; from then on, when an item sells on
 * eBay, the app hears about it and drops that product's count
 * itself, with a sale movement recorded — the same as if it
 * had been scanned out. ONE-WAY only (eBay → app).
 *
 * BOTH PLANS (her connection doctrine, Nov 23, 2026):
 * storefront connections are for Essentials and Business
 * alike — this page has NO plan gate, no PlanRedirect, and
 * the server refuses nobody for their plan. Till connections
 * (server/posRoutes.js) stay Business-only; that line is
 * deliberate and lives there, not here.
 *
 * Who manages: the owner or a manager (the workforce
 * hierarchy, mirrored from the till page). Staff can look —
 * their training lesson explains the door — but cannot
 * connect, link or check. Credentials never reach this page:
 * the overview carries the connection's public shape only.
 *
 * Honest states: when the app owner's eBay keyset is not in
 * place yet, the card says so plainly in the reader's
 * language instead of opening a broken flow.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Store, Unplug } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useBusiness } from '@/hooks/useBusiness';
import {
  getStorefrontOverview,
  connectEbay,
  disconnectEbay,
  setEbayLocation,
  checkEbayNow,
  saveStorefrontMapping,
  applyHeldStorefrontSales,
  listStorefrontPickerData,
} from '@/lib/storefronts';
import { connectionStatusLabel, eventStatusLabel, lineStatusLabel } from '@/lib/pos';
import { formatDayTime } from '@/lib/dates';

function statusTone(status) {
  switch (status) {
    case 'connected':
    case 'applied':
      return 'bg-ok/12 text-ok';
    case 'partially_applied':
    case 'insufficient_stock':
    case 'held_plan':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100';
    case 'held_unmatched':
    case 'unmatched':
    case 'error':
      return 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function Chip({ status, label }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusTone(status)}`}>
      {label}
    </span>
  );
}

function LocationSelect({ locations, value, onChange, disabled }) {
  return (
    <select
      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
      value={value || ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t('pos.location.auto')}</option>
      {locations.map((location) => (
        <option key={location.id} value={location.id}>
          {location.name}
        </option>
      ))}
    </select>
  );
}

export default function StorefrontConnections() {
  const { activeId } = useBusiness();
  const { toast } = useToast();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [mappingChoice, setMappingChoice] = useState({});
  const [savedMappings, setSavedMappings] = useState({});

  const load = useCallback(async () => {
    if (!activeId) {
      setOverview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getStorefrontOverview(activeId);
      setOverview(data);
      const picker = await listStorefrontPickerData(activeId).catch(() => ({ products: [], locations: [] }));
      setProducts(picker.products || []);
      setLocations(picker.locations || []);
    } catch (err) {
      setError(err?.message || t('pos.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('ebay');
    if (flag === 'connected') toast({ title: t('storefronts.flashConnected') });
    if (flag === 'failed') {
      toast({ title: t('pos.square.failedToast'), variant: 'destructive' });
    }
  }, [toast]);

  const canManage = overview?.level === 'owner' || overview?.level === 'manager';
  const connection = overview?.connection || { status: 'not_connected' };
  const connected = connection.status === 'connected';
  const events = overview?.events || [];

  const heldGroups = useMemo(() => {
    const groups = new Map();
    for (const line of overview?.unmatched || []) {
      const key = line.provider_item_key;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          providerItemKey: line.provider_item_key,
          label: line.item_label || line.sku || line.provider_item_key,
          sku: line.sku || '',
          lines: [],
        });
      }
      groups.get(key).lines.push(line);
    }
    return [...groups.values()];
  }, [overview]);

  const act = async (key, fn, successTitle) => {
    setBusy(key);
    try {
      const result = await fn();
      if (successTitle) toast({ title: successTitle });
      await load();
      return result;
    } catch (err) {
      toast({ title: err?.message || t('pos.actionFailed'), variant: 'destructive' });
      return null;
    } finally {
      setBusy('');
    }
  };

  const onConnect = () =>
    act('ebay-connect', async () => {
      const result = await connectEbay(activeId);
      if (!result.configured) {
        toast({ title: result.message || t('storefronts.notAvailableTitle') });
        return;
      }
      window.location.href = result.authorize_url;
    });

  const onCheckNow = () =>
    act('ebay-check', async () => {
      const result = await checkEbayNow(activeId);
      if (result?.ran) {
        toast({ title: t('storefronts.flashChecked', { count: result.applied ?? 0 }) });
      }
    });

  const onSaveMapping = (group) =>
    act(`map-${group.key}`, async () => {
      const productId = mappingChoice[group.key];
      if (!productId) return;
      const result = await saveStorefrontMapping(activeId, {
        providerItemKey: group.providerItemKey,
        productId,
      });
      if (result?.mapping?.id) {
        setSavedMappings((current) => ({ ...current, [group.key]: result.mapping.id }));
        toast({ title: t('storefronts.flashLinked') });
      }
    });

  const onApplyHeld = (group) =>
    act(`apply-${group.key}`, async () => {
      const mappingId = savedMappings[group.key];
      if (!mappingId) return;
      await applyHeldStorefrontSales(activeId, mappingId);
    }, t('storefronts.applied'));

  const lastCheck = overview?.sweep_state?.last_sweep_at;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">{t('storefronts.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('storefronts.subtitle')}</p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">{t('pos.loading')}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && overview && (
        <>
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">{t('storefronts.ebayTitle')}</h2>
              </div>
              <Chip status={connection.status} label={connectionStatusLabel(connection.status)} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t('storefronts.ebayDesc')}</p>

            {connected ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm">
                  {t('storefronts.connectedAs', { account: connection.label || connection.provider_account_id || 'eBay' })}
                </p>
                {connection.last_error ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">{connection.last_error}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">{t('storefronts.locationLabel')}</span>
                  <LocationSelect
                    locations={locations}
                    value={connection.location_id}
                    disabled={!canManage || busy === 'ebay-loc'}
                    onChange={(value) =>
                      act('ebay-loc', () => setEbayLocation(activeId, value), t('pos.location.saved'))
                    }
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t('storefronts.locationHint')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {canManage && (
                    <Button size="sm" variant="outline" disabled={busy === 'ebay-check'} onClick={onCheckNow}>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      {busy === 'ebay-check' ? t('storefronts.checking') : t('storefronts.checkNow')}
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {lastCheck
                      ? t('storefronts.lastCheck', { when: formatDayTime(lastCheck) })
                      : t('storefronts.neverChecked')}
                  </span>
                </div>
                {canManage && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === 'ebay-disconnect'}
                      onClick={() =>
                        act('ebay-disconnect', () => disconnectEbay(activeId), t('storefronts.flashDisconnected'))
                      }
                    >
                      <Unplug className="mr-1.5 h-3.5 w-3.5" />
                      {t('storefronts.disconnect')}
                    </Button>
                    <span className="text-xs text-muted-foreground">{t('storefronts.disconnectNote')}</span>
                  </div>
                )}
              </div>
            ) : overview.configured ? (
              canManage ? (
                <div className="mt-3">
                  <Button size="sm" disabled={busy === 'ebay-connect'} onClick={onConnect}>
                    {t('storefronts.connect')}
                  </Button>
                </div>
              ) : null
            ) : (
              <div className="mt-3 rounded-lg bg-muted p-3">
                <p className="text-sm font-medium">{t('storefronts.notAvailableTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('storefronts.notAvailableBody')}</p>
              </div>
            )}
            {!canManage && (
              <p className="mt-3 text-xs text-muted-foreground">{t('storefronts.staffNote')}</p>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <h2 className="text-base font-semibold">{t('storefronts.matchingTitle')}</h2>
            {heldGroups.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('storefronts.matchingEmpty')}</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('storefronts.matchingIntro', { count: heldGroups.length })}
                </p>
                <div className="mt-3 space-y-3">
                  {heldGroups.map((group) => (
                    <div key={group.key} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{group.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {t('storefronts.itemLabel')}: {group.providerItemKey}
                          {group.sku ? ` · ${t('storefronts.skuLabel')}: ${group.sku}` : ''}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {group.lines.map((line) => (
                          <li key={line.id} className="flex flex-wrap items-center gap-2 text-sm">
                            <span>
                              {t('storefronts.orderLabel', { id: line.external_sale_id })} · ×{line.quantity}
                            </span>
                            <Chip status={line.status} label={lineStatusLabel(line.status)} />
                          </li>
                        ))}
                      </ul>
                      {canManage && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <select
                            className="h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm"
                            value={mappingChoice[group.key] || ''}
                            onChange={(event) =>
                              setMappingChoice((current) => ({ ...current, [group.key]: event.target.value }))
                            }
                          >
                            <option value="">{t('storefronts.chooseProduct')}</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                                {product.sku ? ` (${product.sku})` : ''}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            disabled={!mappingChoice[group.key] || busy === `map-${group.key}`}
                            onClick={() => onSaveMapping(group)}
                          >
                            {t('storefronts.linkButton')}
                          </Button>
                          {savedMappings[group.key] && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === `apply-${group.key}`}
                              onClick={() => onApplyHeld(group)}
                            >
                              {t('storefronts.applied')}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <h2 className="text-base font-semibold">{t('storefronts.recentTitle')}</h2>
            {events.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('storefronts.recentEmpty')}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {t('storefronts.orderLabel', { id: event.external_sale_id })}
                      </span>
                      <Chip status={event.status} label={eventStatusLabel(event.status)} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDayTime(event.sold_at || event.created_at)}
                    </p>
                    <ul className="mt-2 space-y-1">
                      {(event.lines || []).map((line) => (
                        <li key={line.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <span>
                            {line.item_label || line.sku || line.provider_item_key} · ×{line.quantity}
                          </span>
                          <Chip status={line.status} label={lineStatusLabel(line.status)} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
