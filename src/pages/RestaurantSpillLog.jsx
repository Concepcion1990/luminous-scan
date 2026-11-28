import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Printer, Wine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SpillLogDoc from '@/components/print/SpillLogDoc';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatMoney } from '@/lib/inventory';
import { formatBusinessDate, formatTimeOnly } from '@/lib/dates';
import { fetchSpillLog, recordSpill, spillTotals } from '@/lib/spillLog';
import { t } from '@/lib/i18n';

/**
 * Spill & breakage log (plan Part 7, item 392A; Business-
 * only, Restaurant Corner, Stock & Ordering home beside
 * bar counting).
 *
 * The log lives with the BAR-COUNTING family: its shelf
 * door is barOnly, and this page follows the family's
 * owner switch — while bar counting is off, the log shows
 * the family's off state and takes nothing (the switch
 * itself lives on the Bar counting page).
 *
 * Each entry: date/time (its created stamp), the item,
 * how much was spilled or broken, the reason, and who
 * recorded it. Any member may log — a daily log, like the
 * waste log it feeds: the stock-out rides ONE write-off
 * movement and a costed waste row, so the loss lands in
 * the family's books exactly once.
 *
 * MONEY IS OWNER-ONLY: the pour cost is shaped server-
 * side and rides the rows only for the owner, so the
 * cost column and the total exist only on the owner's
 * screen and the owner's print.
 */
export default function RestaurantSpillLog() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ product_id: '', quantity: '', kind: 'spill', reason: '', location_id: '' });
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) return;
    setData(await fetchSpillLog(activeId));
  }, [activeId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const entries = data?.entries || [];
  const products = data?.products || [];
  const locations = data?.locations || [];
  const totals = spillTotals(entries);
  const showMoney = totals.showMoney;

  const save = async () => {
    setBusy(true);
    setError('');
    setFlash('');
    try {
      const result = await recordSpill(activeId, {
        product_id: form.product_id,
        quantity: form.quantity === '' ? '' : Number(form.quantity),
        kind: form.kind,
        reason: form.reason,
        location_id: form.location_id || null,
      });
      setFlash(t('spill.recordedToast', { product: result.entry?.product_name || '' }));
      setForm({ product_id: '', quantity: '', kind: 'spill', reason: '', location_id: '' });
      await load();
    } catch { setError(t('spill.saveFailed')); } finally { setBusy(false); }
  };

  const printLog = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 50);
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <RestaurantCrumbs route="/restaurant/spill-log" />
      </div>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-2xl font-semibold sm:text-[28px]">
            <Wine className="h-6 w-6" /> {t('spill.title')}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('spill.subtitle')}</p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('spill.lossNote')}</p>
        </div>
        {data?.enabled && entries.length ? (
          <Button variant="outline" onClick={printLog}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('spill.printButton')}
          </Button>
        ) : null}
      </div>

      {flash ? (
        <p className="no-print flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      ) : null}
      {error ? <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}

      {!data ? (
        <p className="no-print text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : !data.enabled ? (
        <div className="no-print rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <Wine className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('barCounting.offTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('barCounting.offBody')}</p>
          {!data.isOwner ? (
            <p className="mx-auto mt-3 max-w-md text-xs text-muted-foreground">{t('barCounting.ownerOnlyNote')}</p>
          ) : null}
        </div>
      ) : (
        <>
          <section className="no-print space-y-3 rounded-xl border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('spill.product')}</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.product_id}
                  onChange={(e) => setForm((f) => ({ ...f, product_id: e.target.value }))}
                >
                  <option value="" />
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{t('spill.location')}</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.location_id}
                  onChange={(e) => setForm((f) => ({ ...f, location_id: e.target.value }))}
                >
                  <option value="" />
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label>{t('spill.quantity')}</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('spill.reason')}</Label>
                <Input
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {['spill', 'breakage'].map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  variant={form.kind === kind ? 'default' : 'outline'}
                  onClick={() => setForm((f) => ({ ...f, kind }))}
                >
                  {kind === 'breakage' ? t('spill.kindBreakage') : t('spill.kindSpill')}
                </Button>
              ))}
              <Button onClick={save} disabled={busy}>{t('spill.recordButton')}</Button>
            </div>
          </section>

          {entries.length === 0 ? (
            <div className="no-print rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <Wine className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{t('spill.emptyTitle')}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('spill.emptyBody')}</p>
            </div>
          ) : (
            <div className="no-print overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="px-3 py-2 font-medium">{t('spill.colWhen')}</th>
                    <th className="px-3 py-2 font-medium">{t('spill.colItem')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('spill.colQuantity')}</th>
                    <th className="px-3 py-2 font-medium">{t('spill.colReason')}</th>
                    <th className="px-3 py-2 font-medium">{t('spill.colBy')}</th>
                    {showMoney ? <th className="px-3 py-2 text-right font-medium">{t('spill.colCost')}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        {entry.created_at ? formatBusinessDate(entry.created_at, record) : ''}
                        {entry.created_at ? <span className="block text-xs text-muted-foreground">{formatTimeOnly(entry.created_at)}</span> : null}
                      </td>
                      <td className="px-3 py-2">
                        {entry.product_name}
                        <span className="block text-xs text-muted-foreground">
                          {entry.kind === 'breakage' ? t('spill.kindBreakage') : t('spill.kindSpill')}
                          {entry.location_name ? ` · ${entry.location_name}` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{entry.quantity}</td>
                      <td className="px-3 py-2">{entry.reason}</td>
                      <td className="px-3 py-2">{entry.created_by || ''}</td>
                      {showMoney ? (
                        <td className="px-3 py-2 text-right">{entry.total_cost != null ? formatMoney(entry.total_cost, record?.currency, 2) : '—'}</td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                {showMoney ? (
                  <tfoot>
                    <tr className="bg-muted/40">
                      <td className="px-3 py-2 font-medium" colSpan={5}>{t('spill.totalLabel')}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatMoney(totals.totalCost || 0, record?.currency, 2)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          )}
        </>
      )}

      {printing ? (
        <div className="print-area hidden print:block">
          <SpillLogDoc entries={entries} business={record} docStyle={docStyle} />
        </div>
      ) : null}
    </div>
  );
}
