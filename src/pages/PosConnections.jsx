/**
 * Till connections (POS) — POS phase.
 *
 * The owner's decision (Nov 12, 2026): when somebody purchases
 * merchandise at the till, it also reflects in the app's
 * inventory. This page is where a store connects its till:
 * Square and Shopify POS cards, the six providers of the
 * Nov 14, 2026 expansion (Clover by OAuth; Toast, Lightspeed,
 * PayPal Zettle, Stripe Terminal and Wix by credential paste),
 * the CSV end-of-day fallback for tills with no API, the mapping
 * screen for items a sale could not match, and the recent-sales
 * list in plain words.
 *
 * BUSINESS PLAN ONLY (the owner's ruling, Nov 13, 2026): the
 * page sits behind the PlanGate locked door — Essentials sees
 * the door, never a hidden absence — and the server refuses
 * Essentials on every POS route the same way. The server still
 * decides everything else — who may connect (owner/manager),
 * what a sale may move, and the never-double-count rule.
 * Statuses are honest: a provider that is not switched on yet
 * says so plainly instead of pretending.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cable, FileUp, Link2, TriangleAlert, Unplug } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { useBusiness } from '@/hooks/useBusiness';
import PlanGate from '@/components/plan/PlanGate';
import {
  getPosOverview,
  startSquareConnect,
  connectShopify,
  startCloverConnect,
  connectToast,
  connectLightspeed,
  connectZettle,
  connectStripeTerminal,
  connectWix,
  disconnectProvider,
  setProviderLocation,
  savePosMapping,
  applyHeldForMapping,
  applyHeldPlanSales,
  importPosCsv,
  listPosPickerData,
  providerLabel,
  connectionStatusLabel,
  eventStatusLabel,
  lineStatusLabel,
} from '@/lib/pos';
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
    case 'connected':
    case 'applied':
      return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100';
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

/**
 * The credential-paste providers (POS expansion, Nov 14, 2026):
 * one card shape for all of them — the fields each provider's
 * documented API actually uses, pasted from the owner's own
 * provider account, stored server-side only. `connect` is the
 * src/lib/pos.js wrapper; `webhookPendingKey` names the
 * platform-readiness flag in overview.providers (null when the
 * provider's readiness is per-connection instead).
 */
const CREDENTIAL_PROVIDERS = [
  {
    provider: 'toast',
    titleKey: 'pos.provider.toast',
    helpKey: 'pos.toast.help',
    connectKey: 'pos.toast.connect',
    connectedToastKey: 'pos.toast.connectedToast',
    connectFn: connectToast,
    fields: [
      { name: 'client_id', placeholderKey: 'pos.toast.clientIdPlaceholder' },
      { name: 'client_secret', placeholderKey: 'pos.toast.clientSecretPlaceholder', type: 'password' },
      { name: 'restaurant_guid', placeholderKey: 'pos.toast.restaurantPlaceholder' },
    ],
    noteKey: 'pos.toast.credentialNote',
    webhookPendingKey: 'toast',
  },
  {
    provider: 'lightspeed',
    titleKey: 'pos.provider.lightspeed',
    helpKey: 'pos.lightspeed.help',
    connectKey: 'pos.lightspeed.connect',
    connectedToastKey: 'pos.lightspeed.connectedToast',
    connectFn: connectLightspeed,
    fields: [
      { name: 'domain_prefix', placeholderKey: 'pos.lightspeed.domainPlaceholder' },
      { name: 'api_token', placeholderKey: 'pos.lightspeed.tokenPlaceholder', type: 'password' },
    ],
    noteKey: 'pos.lightspeed.tokenNote',
    webhookPendingKey: null,
    showWebhookUrl: true,
  },
  {
    provider: 'zettle',
    titleKey: 'pos.provider.zettle',
    helpKey: 'pos.zettle.help',
    connectKey: 'pos.zettle.connect',
    connectedToastKey: 'pos.zettle.connectedToast',
    connectFn: connectZettle,
    fields: [
      { name: 'organization_uuid', placeholderKey: 'pos.zettle.orgPlaceholder' },
      { name: 'signing_key', placeholderKey: 'pos.zettle.signingKeyPlaceholder', type: 'password' },
    ],
    noteKey: 'pos.zettle.credentialNote',
    webhookPendingKey: null,
  },
  {
    provider: 'stripe_terminal',
    titleKey: 'pos.provider.stripeTerminal',
    helpKey: 'pos.stripeTerminal.help',
    connectKey: 'pos.stripeTerminal.connect',
    connectedToastKey: 'pos.stripeTerminal.connectedToast',
    connectFn: connectStripeTerminal,
    fields: [
      { name: 'account_id', placeholderKey: 'pos.stripeTerminal.accountPlaceholder' },
      { name: 'webhook_secret', placeholderKey: 'pos.stripeTerminal.secretPlaceholder', type: 'password' },
    ],
    noteKey: 'pos.stripeTerminal.secretNote',
    alwaysNoteKey: 'pos.stripeTerminal.itemsNote',
    webhookPendingKey: null,
  },
  {
    provider: 'wix',
    titleKey: 'pos.provider.wix',
    helpKey: 'pos.wix.help',
    connectKey: 'pos.wix.connect',
    connectedToastKey: 'pos.wix.connectedToast',
    connectFn: connectWix,
    fields: [{ name: 'instance_id', placeholderKey: 'pos.wix.instancePlaceholder' }],
    noteKey: 'pos.wix.instanceNote',
    webhookPendingKey: 'wix',
  },
];

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

function CredentialProviderCard({
  config,
  connection,
  canManage,
  locations,
  busy,
  form,
  setField,
  act,
  activeId,
  webhookPending,
}) {
  const provider = config.provider;
  const connected = connection.status === 'connected';
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cable className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t(config.titleKey)}</h2>
        </div>
        <Chip status={connection.status} label={connectionStatusLabel(connection.status)} />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t(config.helpKey)}</p>
      {config.alwaysNoteKey && (
        <p className="mt-2 text-xs text-muted-foreground">{t(config.alwaysNoteKey)}</p>
      )}
      {connected ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{connection.label || connection.provider_account_id}</span>
            {canManage && (
              <>
                <LocationSelect
                  locations={locations}
                  value={connection.location_id}
                  disabled={busy === `loc-${provider}`}
                  onChange={(value) =>
                    act(`loc-${provider}`, () => setProviderLocation(activeId, provider, value), t('pos.location.saved'))
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === `${provider}-disconnect`}
                  onClick={() =>
                    act(`${provider}-disconnect`, () => disconnectProvider(activeId, provider), t('pos.disconnectedToast'))
                  }
                >
                  <Unplug className="mr-1.5 h-3.5 w-3.5" /> {t('pos.disconnect')}
                </Button>
              </>
            )}
          </div>
          {config.showWebhookUrl && connection.webhook_path && (
            <div>
              <p className="text-xs font-medium">{t('pos.lightspeed.webhookUrlLabel')}</p>
              <p className="mt-1 break-all rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs">
                {typeof window !== 'undefined' ? window.location.origin : ''}
                {connection.webhook_path}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t('pos.lightspeed.webhookUrlNote')}</p>
            </div>
          )}
        </div>
      ) : canManage ? (
        <div className="mt-3 grid max-w-xl gap-2">
          {config.fields.map((field) => (
            <Input
              key={field.name}
              type={field.type || 'text'}
              placeholder={t(field.placeholderKey)}
              value={form[field.name] || ''}
              onChange={(event) => setField(provider, field.name, event.target.value)}
            />
          ))}
          <p className="text-xs text-muted-foreground">{t(config.noteKey)}</p>
          <div>
            <Button
              size="sm"
              disabled={busy === `${provider}-connect`}
              onClick={() =>
                act(
                  `${provider}-connect`,
                  () => config.connectFn(activeId, { ...form }),
                  t(config.connectedToastKey),
                )
              }
            >
              <Link2 className="mr-1.5 h-3.5 w-3.5" /> {t(config.connectKey)}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{t('pos.managerOnly')}</p>
      )}
      {webhookPending && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('pos.webhookPending')}
        </p>
      )}
    </section>
  );
}

export default function PosConnections() {
  // Business-only module: Essentials gets the shown locked door,
  // never a hidden absence (the server refuses the API the same way).
  return (
    <PlanGate feature="pos">
      <PosConnectionsInner />
    </PlanGate>
  );
}

function PosConnectionsInner() {
  const { profile, activeId } = useBusiness();
  const { toast } = useToast();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [shopDomain, setShopDomain] = useState('');
  const [shopToken, setShopToken] = useState('');
  const [forms, setForms] = useState({});
  const setField = useCallback((provider, name, value) => {
    setForms((current) => ({ ...current, [provider]: { ...(current[provider] || {}), [name]: value } }));
  }, []);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [csvResult, setCsvResult] = useState(null);
  const [mappingChoice, setMappingChoice] = useState({});
  const [savedMappings, setSavedMappings] = useState({});
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!activeId) {
      setOverview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getPosOverview(activeId);
      setOverview(data);
      if ((data.held || []).length) {
        const picker = await listPosPickerData(activeId);
        setProducts(picker.products || []);
        setLocations(picker.locations || []);
      } else {
        const picker = await listPosPickerData(activeId).catch(() => ({ locations: [] }));
        setLocations(picker.locations || []);
      }
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
    const flag = new URLSearchParams(window.location.search).get('square');
    if (flag === 'connected') toast({ title: t('pos.square.connectedToast') });
    if (flag === 'failed') {
      toast({ title: t('pos.square.failedToast'), variant: 'destructive' });
    }
    const cloverFlag = new URLSearchParams(window.location.search).get('clover');
    if (cloverFlag === 'connected') toast({ title: t('pos.clover.connectedToast') });
    if (cloverFlag === 'failed') {
      toast({ title: t('pos.clover.failedToast'), variant: 'destructive' });
    }
  }, [toast]);

  const canManage = overview?.level === 'owner' || overview?.level === 'manager';
  const connections = useMemo(() => {
    const byProvider = {};
    for (const row of overview?.connections || []) byProvider[row.provider] = row;
    return byProvider;
  }, [overview]);

  const heldGroups = useMemo(() => {
    const groups = new Map();
    for (const line of overview?.held || []) {
      const key = `${line.event_provider}:${line.provider_item_key}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          provider: line.event_provider,
          providerItemKey: line.provider_item_key,
          label: line.item_label || line.sku || line.provider_item_key,
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

  const onSquareConnect = () =>
    act('square-connect', async () => {
      const result = await startSquareConnect(activeId);
      if (!result.configured) {
        toast({ title: result.message || t('pos.square.notConfigured') });
        return;
      }
      window.location.href = result.authorize_url;
    });

  const onShopifyConnect = () =>
    act(
      'shopify-connect',
      () => connectShopify(activeId, { shop_domain: shopDomain.trim(), access_token: shopToken.trim() }),
      t('pos.shopify.connectedToast'),
    );

  const onCloverConnect = () =>
    act('clover-connect', async () => {
      const result = await startCloverConnect(activeId);
      if (!result.configured) {
        toast({ title: result.message || t('pos.clover.notConfigured') });
        return;
      }
      window.location.href = result.authorize_url;
    });

  const onCsvFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = await act('csv', () => importPosCsv(activeId, text));
    if (result) setCsvResult(result);
    event.target.value = '';
  };

  const onSaveMapping = async (group) => {
    const productId = mappingChoice[group.key];
    if (!productId) {
      toast({ title: t('pos.mapping.pickFirst'), variant: 'destructive' });
      return;
    }
    const result = await act(`map-${group.key}`, () =>
      savePosMapping(activeId, {
        provider: group.provider,
        provider_item_key: group.providerItemKey,
        product_id: productId,
      }),
    );
    if (result?.mapping) {
      setSavedMappings((current) => ({
        ...current,
        [group.key]: { id: result.mapping.id, heldCount: result.held_count },
      }));
    }
  };

  const onApplyHeld = async (group) => {
    const saved = savedMappings[group.key];
    if (!saved) return;
    const result = await act(
      `apply-${group.key}`,
      () => applyHeldForMapping(activeId, saved.id),
      t('pos.mapping.appliedToast'),
    );
    if (result) {
      setSavedMappings((current) => {
        const next = { ...current };
        delete next[group.key];
        return next;
      });
    }
  };

  const square = connections.square || { status: 'not_connected' };
  const shopify = connections.shopify || { status: 'not_connected' };
  const clover = connections.clover || { status: 'not_connected' };
  const squareReady = overview?.providers?.square?.oauth_configured;
  const cloverReady = overview?.providers?.clover?.oauth_configured;

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {profile?.name ? t('pos.eyebrow', { name: profile.name }) : t('pos.eyebrowPlain')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('pos.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('pos.subtitle')}</p>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('pos.loading')}</p>
      ) : (
        <>
          {/* ---- Square ---- */}
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cable className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">{t('pos.provider.square')}</h2>
              </div>
              <Chip status={square.status} label={connectionStatusLabel(square.status)} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t('pos.square.help')}</p>
            {square.status === 'connected' ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm">{square.label || square.provider_account_id}</span>
                {canManage && (
                  <>
                    <LocationSelect
                      locations={locations}
                      value={square.location_id}
                      disabled={busy === 'loc-square'}
                      onChange={(value) =>
                        act('loc-square', () => setProviderLocation(activeId, 'square', value), t('pos.location.saved'))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === 'square-disconnect'}
                      onClick={() => act('square-disconnect', () => disconnectProvider(activeId, 'square'), t('pos.disconnectedToast'))}
                    >
                      <Unplug className="mr-1.5 h-3.5 w-3.5" /> {t('pos.disconnect')}
                    </Button>
                  </>
                )}
              </div>
            ) : canManage ? (
              <div className="mt-3">
                <Button size="sm" disabled={busy === 'square-connect'} onClick={onSquareConnect}>
                  <Link2 className="mr-1.5 h-3.5 w-3.5" /> {t('pos.square.connect')}
                </Button>
                {!squareReady && (
                  <p className="mt-2 text-xs text-muted-foreground">{t('pos.square.notConfigured')}</p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{t('pos.managerOnly')}</p>
            )}
          </section>

          {/* ---- Shopify ---- */}
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cable className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">{t('pos.provider.shopify')}</h2>
              </div>
              <Chip status={shopify.status} label={connectionStatusLabel(shopify.status)} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t('pos.shopify.help')}</p>
            {shopify.status === 'connected' ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm">{shopify.label || shopify.provider_account_id}</span>
                {canManage && (
                  <>
                    <LocationSelect
                      locations={locations}
                      value={shopify.location_id}
                      disabled={busy === 'loc-shopify'}
                      onChange={(value) =>
                        act('loc-shopify', () => setProviderLocation(activeId, 'shopify', value), t('pos.location.saved'))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === 'shopify-disconnect'}
                      onClick={() => act('shopify-disconnect', () => disconnectProvider(activeId, 'shopify'), t('pos.disconnectedToast'))}
                    >
                      <Unplug className="mr-1.5 h-3.5 w-3.5" /> {t('pos.disconnect')}
                    </Button>
                  </>
                )}
              </div>
            ) : canManage ? (
              <div className="mt-3 grid max-w-xl gap-2">
                <Input
                  placeholder={t('pos.shopify.domainPlaceholder')}
                  value={shopDomain}
                  onChange={(event) => setShopDomain(event.target.value)}
                />
                <Input
                  type="password"
                  placeholder={t('pos.shopify.tokenPlaceholder')}
                  value={shopToken}
                  onChange={(event) => setShopToken(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t('pos.shopify.tokenNote')}</p>
                <div>
                  <Button size="sm" disabled={busy === 'shopify-connect'} onClick={onShopifyConnect}>
                    <Link2 className="mr-1.5 h-3.5 w-3.5" /> {t('pos.shopify.connect')}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{t('pos.managerOnly')}</p>
            )}
            {!overview?.providers?.shopify?.webhook_configured && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('pos.webhookPending')}
              </p>
            )}
          </section>

          {/* ---- Clover ---- */}
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <Cable className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">{t('pos.provider.clover')}</h2>
              </div>
              <Chip status={clover.status} label={connectionStatusLabel(clover.status)} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t('pos.clover.help')}</p>
            {clover.status === 'connected' ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm">{clover.label || clover.provider_account_id}</span>
                {canManage && (
                  <>
                    <LocationSelect
                      locations={locations}
                      value={clover.location_id}
                      disabled={busy === 'loc-clover'}
                      onChange={(value) =>
                        act('loc-clover', () => setProviderLocation(activeId, 'clover', value), t('pos.location.saved'))
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === 'clover-disconnect'}
                      onClick={() => act('clover-disconnect', () => disconnectProvider(activeId, 'clover'), t('pos.disconnectedToast'))}
                    >
                      <Unplug className="mr-1.5 h-3.5 w-3.5" /> {t('pos.disconnect')}
                    </Button>
                  </>
                )}
              </div>
            ) : canManage ? (
              <div className="mt-3">
                <Button size="sm" disabled={busy === 'clover-connect'} onClick={onCloverConnect}>
                  <Link2 className="mr-1.5 h-3.5 w-3.5" /> {t('pos.clover.connect')}
                </Button>
                {!cloverReady && (
                  <p className="mt-2 text-xs text-muted-foreground">{t('pos.clover.notConfigured')}</p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{t('pos.managerOnly')}</p>
            )}
          </section>

          {/* ---- Credential providers: Toast, Lightspeed, Zettle, Stripe Terminal, Wix ---- */}
          {CREDENTIAL_PROVIDERS.map((config) => (
            <CredentialProviderCard
              key={config.provider}
              config={config}
              connection={connections[config.provider] || { status: 'not_connected' }}
              canManage={canManage}
              locations={locations}
              busy={busy}
              form={forms[config.provider] || {}}
              setField={setField}
              act={act}
              activeId={activeId}
              webhookPending={
                config.webhookPendingKey
                  ? !overview?.providers?.[config.webhookPendingKey]?.webhook_configured
                  : false
              }
            />
          ))}

          {/* ---- CSV fallback ---- */}
          <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">{t('pos.csv.title')}</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{t('pos.csv.help')}</p>
            <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs">
              sale_id, sold_at, sku_or_barcode, quantity, item_name, location
            </p>
            {canManage ? (
              <div className="mt-3">
                <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={onCsvFile} />
                <Button size="sm" disabled={busy === 'csv'} onClick={() => fileRef.current?.click()}>
                  {t('pos.csv.choose')}
                </Button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">{t('pos.managerOnly')}</p>
            )}
            {csvResult && (
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  {t('pos.csv.result', {
                    imported: csvResult.imported,
                    duplicates: csvResult.duplicates,
                  })}
                </p>
                {(csvResult.problems || []).map((problem, i) => (
                  <p key={i} className="text-xs text-destructive">
                    {t('pos.csv.problemRow', { row: problem.row })}: {problem.problem}
                  </p>
                ))}
              </div>
            )}
          </section>

          {/* ---- Unmatched items ---- */}
          <section>
            <h2 className="mb-2 text-base font-semibold">{t('pos.mapping.title')}</h2>
            {heldGroups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {t('pos.mapping.empty')}
              </p>
            ) : (
              <div className="space-y-3">
                {heldGroups.map((group) => {
                  const heldUnits = group.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
                  const saved = savedMappings[group.key];
                  return (
                    <div key={group.key} className="rounded-lg border border-border bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{group.label}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {providerLabel(group.provider)} · {group.providerItemKey} ·{' '}
                            {t('pos.mapping.heldLines', { count: group.lines.length, units: heldUnits })}
                          </p>
                        </div>
                        <Chip status={group.lines[0].status} label={lineStatusLabel(group.lines[0].status)} />
                      </div>
                      {canManage && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                          <select
                            className="h-9 min-w-52 rounded-md border border-input bg-background px-2 text-sm"
                            value={mappingChoice[group.key] || ''}
                            onChange={(event) =>
                              setMappingChoice((current) => ({ ...current, [group.key]: event.target.value }))
                            }
                          >
                            <option value="">{t('pos.mapping.pick')}</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.name}
                                {product.sku ? ` · ${product.sku}` : ''}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            disabled={busy === `map-${group.key}`}
                            onClick={() => onSaveMapping(group)}
                          >
                            {t('pos.mapping.save')}
                          </Button>
                          {saved && saved.heldCount > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === `apply-${group.key}`}
                              onClick={() => onApplyHeld(group)}
                            >
                              {t('pos.mapping.applyHeld', { count: saved.heldCount })}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ---- Recent sales ---- */}
          <section>
            <h2 className="mb-2 text-base font-semibold">{t('pos.events.title')}</h2>
            {(overview?.held_plan_events || 0) > 0 && (
              <div className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                <p className="text-sm">{t('pos.events.heldPlanNote')}</p>
                {canManage && (
                  <Button
                    size="sm"
                    className="mt-2"
                    disabled={busy === 'apply-held-plan'}
                    onClick={() =>
                      act('apply-held-plan', () => applyHeldPlanSales(activeId), t('pos.mapping.appliedToast'))
                    }
                  >
                    {t('pos.events.applyHeldPlan')}
                  </Button>
                )}
              </div>
            )}
            {(overview?.events || []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {t('pos.events.empty')}
              </p>
            ) : (
              <div className="space-y-3">
                {(overview?.events || []).map((event) => (
                  <div key={event.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {providerLabel(event.provider)} · {event.external_sale_id}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatWhen(event.sold_at || event.created_at)}
                          {event.total_amount != null
                            ? ` · ${event.total_currency || ''} ${Number(event.total_amount).toFixed(2)}`
                            : ''}
                        </p>
                      </div>
                      <Chip status={event.status} label={eventStatusLabel(event.status)} />
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {(event.lines || []).map((line) => (
                        <li key={line.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {line.item_label || line.sku || line.provider_item_key} × {line.quantity}
                          </span>
                          <span className="text-xs text-muted-foreground">{lineStatusLabel(line.status)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
