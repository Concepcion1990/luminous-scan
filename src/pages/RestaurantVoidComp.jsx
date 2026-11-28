import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Printer, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import VoidCompDoc from '@/components/print/VoidCompDoc';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatMoney } from '@/lib/inventory';
import { formatBusinessDate, formatTimeOnly } from '@/lib/dates';
import { fetchVoidComp, recordVoidComp, voidCompTotals } from '@/lib/voidComp';
import { t } from '@/lib/i18n';

/**
 * Void & comp log (plan Part 7, owner-ruled addition G-C;
 * Business-only, Restaurant Corner, Invoices & Money
 * shelf — one clean door on the money shelf, no new nav).
 *
 * The register of voids and comps: which kind it was, its
 * value, the reason, and who approved it. The date/time
 * and who recorded it ride along, stamped when the entry
 * is written — the house log shape.
 *
 * HAND-ENTERED, HONESTLY: until a live till feed exists,
 * a person types each entry, and the page says so in its
 * own copy (voidcomp.handNote) — nothing here pretends an
 * entry arrived from a till.
 *
 * OWNER/MANAGER MONEY: the server serves the register to
 * the owner and managers only and refuses plain staff
 * before any row is read, so this page's data simply
 * never exists for anyone else.
 */
export default function RestaurantVoidComp() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ kind: 'void', amount: '', reason: '', approver: '' });
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) return;
    setData(await fetchVoidComp(activeId));
  }, [activeId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const entries = data?.entries || [];
  const totals = voidCompTotals(entries);

  const save = async () => {
    setBusy(true);
    setError('');
    setFlash('');
    try {
      await recordVoidComp(activeId, {
        kind: form.kind,
        amount: form.amount === '' ? '' : Number(form.amount),
        reason: form.reason,
        approver: form.approver,
      });
      setFlash(t('voidcomp.recordedToast'));
      setForm({ kind: 'void', amount: '', reason: '', approver: '' });
      await load();
    } catch { setError(t('voidcomp.saveFailed')); } finally { setBusy(false); }
  };

  const printLog = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 50);
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <RestaurantCrumbs route="/restaurant/void-comp" />
      </div>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-2xl font-semibold sm:text-[28px]">
            <Receipt className="h-6 w-6" /> {t('voidcomp.title')}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('voidcomp.subtitle')}</p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('voidcomp.handNote')}</p>
        </div>
        {entries.length ? (
          <Button variant="outline" onClick={printLog}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('voidcomp.printButton')}
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
      ) : (
        <>
          <section className="no-print space-y-3 rounded-xl border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('voidcomp.value')}</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('voidcomp.approver')}</Label>
                <Input
                  value={form.approver}
                  onChange={(e) => setForm((f) => ({ ...f, approver: e.target.value }))}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>{t('voidcomp.reason')}</Label>
                <Input
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {['void', 'comp'].map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  variant={form.kind === kind ? 'default' : 'outline'}
                  onClick={() => setForm((f) => ({ ...f, kind }))}
                >
                  {kind === 'comp' ? t('voidcomp.kindComp') : t('voidcomp.kindVoid')}
                </Button>
              ))}
              <Button onClick={save} disabled={busy}>{t('voidcomp.recordButton')}</Button>
            </div>
          </section>

          {entries.length === 0 ? (
            <div className="no-print rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <Receipt className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{t('voidcomp.emptyTitle')}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('voidcomp.emptyBody')}</p>
            </div>
          ) : (
            <div className="no-print overflow-hidden rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th className="px-3 py-2 font-medium">{t('voidcomp.colWhen')}</th>
                    <th className="px-3 py-2 font-medium">{t('voidcomp.colKind')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('voidcomp.colValue')}</th>
                    <th className="px-3 py-2 font-medium">{t('voidcomp.colReason')}</th>
                    <th className="px-3 py-2 font-medium">{t('voidcomp.colApprover')}</th>
                    <th className="px-3 py-2 font-medium">{t('voidcomp.colBy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        {entry.created_at ? formatBusinessDate(entry.created_at, record) : ''}
                        {entry.created_at ? <span className="block text-xs text-muted-foreground">{formatTimeOnly(entry.created_at)}</span> : null}
                      </td>
                      <td className="px-3 py-2">{entry.kind === 'comp' ? t('voidcomp.kindComp') : t('voidcomp.kindVoid')}</td>
                      <td className="px-3 py-2 text-right">{formatMoney(entry.amount, record?.currency, 2)}</td>
                      <td className="px-3 py-2">{entry.reason}</td>
                      <td className="px-3 py-2">{entry.approver}</td>
                      <td className="px-3 py-2">{entry.created_by || ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40">
                    <td className="px-3 py-2 font-medium" colSpan={2}>{t('voidcomp.totalVoids')}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatMoney(totals.totalVoids, record?.currency, 2)}</td>
                    <td colSpan={3} />
                  </tr>
                  <tr className="bg-muted/40">
                    <td className="px-3 py-2 font-medium" colSpan={2}>{t('voidcomp.totalComps')}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatMoney(totals.totalComps, record?.currency, 2)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {printing ? (
        <div className="print-area hidden print:block">
          <VoidCompDoc entries={entries} business={record} docStyle={docStyle} />
        </div>
      ) : null}
    </div>
  );
}
