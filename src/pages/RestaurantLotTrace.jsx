import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Printer, ScanBarcode, SearchCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import BarcodeScanner from '@/components/scan/BarcodeScanner';
import TraceabilityDoc from '@/components/print/TraceabilityDoc';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatMoney } from '@/lib/inventory';
import { formatShortDate } from '@/lib/dates';
import {
  costPerWeight,
  fetchLotTrace,
  fetchTrace,
  findLot,
  logReceivingCheck,
  productForCode,
  pullLot,
  receiveLot,
} from '@/lib/lotTrace';
import { t } from '@/lib/i18n';

/**
 * Lot codes, the recall finder and supplier traceability
 * (plan Part 7, item 392; Business-only, Restaurant Corner,
 * Stock & Ordering home, Food Safety cross-link).
 *
 * ONE back-door surface:
 *  - RECORD A DELIVERY: supplier + lot captured PER ITEM,
 *    the delivery temperature and any refusal with its
 *    reason (the receiving check log), and the ACTUAL
 *    weight for by-weight goods (catch-weight receiving),
 *    with the true cost per weight unit worked out live.
 *  - THE CORNER SCANNER RULE, in place: scan the case to
 *    find its product, then scan or type the lot stamp.
 *  - BATCHES ON HAND with their lots; a PULL locks a batch,
 *    keeps its own record, and flows what was left into
 *    the costed waste log with its reason.
 *  - THE RECALL FINDER: one search — do we have any of
 *    that lot, where is it, did any of it move?
 *  - THE TRACEABILITY LOG: pick a supplier or a lot, see
 *    where it went, and print it as a Studio document.
 *
 * Honest sizing rides the page (lotTrace.honestNote): this
 * is the restaurant's recall drill, not FSMA 204 paperwork.
 */
export default function RestaurantLotTrace() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const [data, setData] = useState(null);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [scanning, setScanning] = useState(false);

  const [form, setForm] = useState({
    product_id: '', supplier_name: '', lot_code: '', quantity: '', location_id: '',
    expires_on: '', actual_weight: '', weight_unit: '', temperature: '', scale: 'F',
    refused: false, refusal_reason: '',
  });
  const [pullReasons, setPullReasons] = useState({});
  const [finderLot, setFinderLot] = useState('');
  const [found, setFound] = useState(null);
  const [tracePick, setTracePick] = useState({ supplier: '', lot: '' });
  const [traceResult, setTraceResult] = useState(null);

  const load = useCallback(async () => {
    if (!activeId) return;
    const result = await fetchLotTrace(activeId);
    setData(result);
  }, [activeId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const products = data?.products || [];
  const batches = data?.batches || [];
  const pulls = data?.pulls || [];
  const checks = data?.checks || [];
  const canStock = Boolean(data?.canStock);
  const product = products.find((p) => p.id === form.product_id) || null;

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  // The Corner Scanner Rule: a scan on THIS surface either
  // names the case's product (barcode/UPC/SKU) or, when a
  // product is already picked, fills the lot stamp.
  const onScan = (code) => {
    const hit = productForCode(products, code);
    if (hit) {
      set({ product_id: hit.id, supplier_name: hit.supplier_name || form.supplier_name });
    } else if (form.product_id) {
      set({ lot_code: String(code || '').trim() });
    } else {
      setFinderLot(String(code || '').trim());
    }
    setScanning(false);
  };

  const trueCost = product && form.actual_weight
    ? costPerWeight((Number(product.cost) || 0) * (Number(form.quantity) || 0), form.actual_weight)
    : null;

  const submitReceive = async () => {
    setBusy(true);
    setError('');
    setFlash('');
    try {
      const payload = {
        product_id: form.product_id,
        supplier_name: form.supplier_name,
        lot_code: form.lot_code,
        quantity: form.quantity === '' ? null : Number(form.quantity),
        location_id: form.location_id || null,
        expires_on: form.expires_on || null,
        actual_weight: form.actual_weight === '' ? null : Number(form.actual_weight),
        weight_unit: form.weight_unit || product?.unit || '',
        temperature: form.temperature === '' ? null : Number(form.temperature),
        scale: form.scale,
        refused: form.refused,
        refusal_reason: form.refusal_reason,
      };
      if (form.refused && !form.temperature) {
        // A refusal on its own is a receiving check — the
        // evidence a supplier credit memo wants attached.
        await logReceivingCheck(activeId, payload);
      } else {
        await receiveLot(activeId, payload);
      }
      setFlash(form.refused
        ? t('lotTrace.refusedToast', { product: product?.name || '' })
        : t('lotTrace.receivedToast', { product: product?.name || '', lot: form.lot_code }));
      setForm((prev) => ({ ...prev, lot_code: '', quantity: '', actual_weight: '', temperature: '', refusal_reason: '', refused: false }));
      await load();
    } catch { setError(t('lotTrace.saveFailed')); } finally { setBusy(false); }
  };

  const submitPull = async (batch) => {
    setBusy(true);
    setError('');
    setFlash('');
    try {
      await pullLot(activeId, { batch_id: batch.id, reason: pullReasons[batch.id] || '' });
      setFlash(t('lotTrace.pulledToast', { lot: batch.lot_code || '' }));
      await load();
    } catch { setError(t('lotTrace.saveFailed')); } finally { setBusy(false); }
  };

  const runFinder = async () => {
    setError('');
    try {
      setFound(await findLot(activeId, finderLot));
    } catch { setError(t('lotTrace.saveFailed')); }
  };

  const runTrace = async (pick) => {
    setTracePick(pick);
    try {
      setTraceResult(await fetchTrace(activeId, pick));
    } catch { setError(t('lotTrace.saveFailed')); }
  };

  const printTrace = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 50);
  };

  const traceLines = traceResult?.lines || [];
  const supplierNames = [...new Set([
    ...(data?.suppliers || []).map((s) => s.name),
    ...batches.map((b) => b.supplier_name).filter(Boolean),
  ])];

  return (
    <div className="space-y-5">
      <div className="no-print">
        <RestaurantCrumbs route="/restaurant/lot-trace" />
      </div>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('lotTrace.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('lotTrace.subtitle')}</p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('lotTrace.honestNote')}</p>
        </div>
        <Button variant="outline" onClick={() => setScanning((s) => !s)}>
          <ScanBarcode className="mr-1.5 h-4 w-4" /> {t('lotTrace.scanButton')}
        </Button>
      </div>

      {scanning ? (
        <div className="no-print rounded-xl border border-border p-3">
          <p className="mb-2 text-sm text-muted-foreground">{t('lotTrace.scanHint')}</p>
          <BarcodeScanner onDetect={onScan} />
        </div>
      ) : null}

      {flash && (
        <p className="no-print flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}
      {error ? <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}

      {!data ? (
        <p className="no-print text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : (
        <>
          {canStock ? (
            <section className="no-print space-y-3 rounded-xl border border-border p-4">
              <h2 className="text-base font-semibold">{t('lotTrace.receiveTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('lotTrace.scanHint')}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label>{t('lotTrace.product')}</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                    value={form.product_id}
                    onChange={(e) => {
                      const picked = products.find((p) => p.id === e.target.value);
                      set({ product_id: e.target.value, supplier_name: picked?.supplier_name || form.supplier_name });
                    }}
                  >
                    <option value="">—</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>{t('lotTrace.supplier')}</Label>
                  <Input value={form.supplier_name} onChange={(e) => set({ supplier_name: e.target.value })} list="lot-suppliers" />
                  <datalist id="lot-suppliers">
                    {supplierNames.map((name) => <option key={name} value={name} />)}
                  </datalist>
                </div>
                <div>
                  <Label>{t('lotTrace.lotCode')}</Label>
                  <Input value={form.lot_code} onChange={(e) => set({ lot_code: e.target.value })} />
                </div>
                <div>
                  <Label>{t('lotTrace.quantity')}</Label>
                  <Input type="number" min="0" step="any" value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} />
                </div>
                <div>
                  <Label>{t('lotTrace.location')}</Label>
                  <select
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                    value={form.location_id}
                    onChange={(e) => set({ location_id: e.target.value })}
                  >
                    <option value="">—</option>
                    {(data.locations || []).map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label>{t('lotTrace.expiry')}</Label>
                  <Input type="date" value={form.expires_on} onChange={(e) => set({ expires_on: e.target.value })} />
                </div>
                <div>
                  <Label>{t('lotTrace.actualWeight')}</Label>
                  <Input type="number" min="0" step="any" value={form.actual_weight} onChange={(e) => set({ actual_weight: e.target.value })} />
                </div>
                <div>
                  <Label>{t('lotTrace.weightUnit')}</Label>
                  <Input value={form.weight_unit} onChange={(e) => set({ weight_unit: e.target.value })} placeholder={product?.unit || ''} />
                </div>
                <div>
                  <Label>{t('lotTrace.deliveryTemp')}</Label>
                  <div className="flex gap-2">
                    <Input type="number" step="any" value={form.temperature} onChange={(e) => set({ temperature: e.target.value })} />
                    <select
                      className="rounded-md border border-input bg-background px-2 py-2 text-sm"
                      value={form.scale}
                      onChange={(e) => set({ scale: e.target.value })}
                    >
                      <option value="F">°F</option>
                      <option value="C">°C</option>
                    </select>
                  </div>
                </div>
              </div>
              {trueCost !== null ? (
                <p className="text-sm font-medium">
                  {t('lotTrace.costPerWeight', { cost: formatMoney(trueCost, record?.currency, 2), unit: form.weight_unit || product?.unit || '' })}
                </p>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.refused} onChange={(e) => set({ refused: e.target.checked })} />
                {t('lotTrace.refusedToggle')}
              </label>
              {form.refused ? (
                <div>
                  <Label>{t('lotTrace.refusalReason')}</Label>
                  <Input value={form.refusal_reason} onChange={(e) => set({ refusal_reason: e.target.value })} />
                </div>
              ) : null}
              <Button onClick={submitReceive} disabled={busy || !form.product_id}>{t('lotTrace.receiveButton')}</Button>
            </section>
          ) : null}

          <section className="no-print space-y-3">
            <h2 className="text-base font-semibold">{t('lotTrace.batchesTitle')}</h2>
            {batches.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t('lotTrace.batchesEmpty')}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left">
                      <th className="px-3 py-2 font-medium">{t('lotTrace.product')}</th>
                      <th className="px-3 py-2 font-medium">{t('lotTrace.lotCode')}</th>
                      <th className="px-3 py-2 font-medium">{t('lotTrace.supplier')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('lotTrace.quantity')}</th>
                      <th className="px-3 py-2 font-medium">{t('lotTrace.location')}</th>
                      <th className="px-3 py-2 font-medium">{t('lotTrace.actualWeight')}</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr key={batch.id} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2">{batch.product_name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{batch.lot_code || '—'}</td>
                        <td className="px-3 py-2">{batch.supplier_name || '—'}</td>
                        <td className="px-3 py-2 text-right">{batch.quantity}</td>
                        <td className="px-3 py-2">{batch.location_name || '—'}</td>
                        <td className="px-3 py-2">
                          {batch.actual_weight ? `${batch.actual_weight} ${batch.weight_unit || ''}` : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {batch.status === 'pulled' ? (
                            <span className="font-medium text-destructive">{t('lotTrace.statusPulled')}</span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-2">
                              <span>{t('lotTrace.statusActive')}</span>
                              {canStock ? (
                                <>
                                  <Input
                                    className="h-8 w-44"
                                    placeholder={t('lotTrace.pullReason')}
                                    value={pullReasons[batch.id] || ''}
                                    onChange={(e) => setPullReasons((prev) => ({ ...prev, [batch.id]: e.target.value }))}
                                  />
                                  <Button size="sm" variant="outline" disabled={busy} onClick={() => submitPull(batch)}>
                                    {t('lotTrace.pullButton')}
                                  </Button>
                                </>
                              ) : null}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {pulls.length > 0 ? (
            <section className="no-print space-y-2">
              <h2 className="text-base font-semibold">{t('lotTrace.pullsTitle')}</h2>
              <ul className="space-y-1 text-sm">
                {pulls.map((pull) => (
                  <li key={pull.id} className="rounded-lg border border-border px-3 py-2">
                    <span className="font-medium">{pull.product_name}</span>
                    {' — '}{t('lotTrace.lotCode')} {pull.lot_code || '—'}
                    {' · '}{pull.quantity}
                    {' · '}{pull.reason}
                    {pull.created_at ? <span className="block text-xs text-muted-foreground">{formatShortDate(pull.created_at)}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="no-print space-y-3 rounded-xl border border-border p-4">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <SearchCheck className="h-4 w-4" /> {t('lotTrace.finderTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('lotTrace.finderHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <Input className="w-64" placeholder={t('lotTrace.finderPlaceholder')} value={finderLot} onChange={(e) => setFinderLot(e.target.value)} />
              <Button onClick={runFinder} disabled={!finderLot.trim()}>{t('lotTrace.finderButton')}</Button>
            </div>
            {found ? (
              found.found ? (
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{t('lotTrace.finderOnHand', { quantity: found.onHand })}</p>
                  <ul className="space-y-1">
                    {found.batches.map((b) => (
                      <li key={b.id}>
                        {b.product_name} — {b.location_name || '—'} — {b.quantity}
                        {b.status === 'pulled' ? ` — ${t('lotTrace.statusPulled')}` : ''}
                      </li>
                    ))}
                  </ul>
                  {found.movements.length > 0 ? (
                    <>
                      <p className="font-medium">{t('lotTrace.finderMovedTitle')}</p>
                      <ul className="space-y-1">
                        {found.movements.map((m) => (
                          <li key={m.id}>
                            {m.type} · {m.quantity} · {m.location_name || '—'}
                            {m.created_at ? ` · ${formatShortDate(m.created_at)}` : ''}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('lotTrace.finderEmpty')}</p>
              )
            ) : null}
          </section>

          <section className="no-print space-y-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{t('lotTrace.traceTitle')}</h2>
              <Button variant="outline" onClick={printTrace} disabled={traceLines.length === 0}>
                <Printer className="mr-1.5 h-4 w-4" /> {t('lotTrace.printButton')}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{t('lotTrace.traceHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-md border border-input bg-background px-2 py-2 text-sm"
                value={tracePick.supplier}
                onChange={(e) => runTrace({ ...tracePick, supplier: e.target.value })}
              >
                <option value="">{t('lotTrace.supplier')}</option>
                {supplierNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <Input
                className="w-56"
                placeholder={t('lotTrace.lotCode')}
                value={tracePick.lot}
                onChange={(e) => setTracePick({ ...tracePick, lot: e.target.value })}
                onBlur={() => runTrace(tracePick)}
              />
              <Button variant="outline" onClick={() => runTrace(tracePick)}>{t('lotTrace.finderButton')}</Button>
            </div>
            {traceResult ? (
              traceLines.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('lotTrace.traceEmpty')}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {traceLines.map((line, i) => (
                    <li key={`${line.at || ''}-${i}`} className="rounded-lg border border-border px-3 py-2">
                      <span className="font-medium">{line.product_name}</span>
                      {' — '}{line.lot_code || '—'}
                      {line.supplier_name ? ` · ${line.supplier_name}` : ''}
                      {line.location_name ? ` · ${line.location_name}` : ''}
                      {line.quantity ? ` · ${line.quantity}` : ''}
                      {line.detail ? <span className="block text-xs text-muted-foreground">{line.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </section>

          <section className="no-print space-y-2">
            <h2 className="text-base font-semibold">{t('lotTrace.checksTitle')}</h2>
            {checks.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('lotTrace.checksEmpty')}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {checks.slice(0, 50).map((check) => (
                  <li key={check.id} className="rounded-lg border border-border px-3 py-2">
                    <span className="font-medium">{check.product_name}</span>
                    {check.lot_code ? ` — ${check.lot_code}` : ''}
                    {check.temperature !== null && check.temperature !== undefined ? ` · ${check.temperature}°${check.scale || 'F'}` : ''}
                    {check.refused ? <span className="block text-xs text-destructive">{t('lotTrace.refusedToggle')}: {check.refusal_reason}</span> : null}
                    {check.created_at ? <span className="block text-xs text-muted-foreground">{formatShortDate(check.created_at)}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {printing && traceResult ? (
        <div className="print-area hidden print:block">
          <TraceabilityDoc
            lines={traceLines}
            pickLabel={[tracePick.supplier, tracePick.lot].filter(Boolean).join(' · ')}
            business={record}
            docStyle={docStyle}
          />
        </div>
      ) : null}
    </div>
  );
}
