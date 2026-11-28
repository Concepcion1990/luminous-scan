import { useCallback, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, Printer, Repeat, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PriceBookDoc from '@/components/print/PriceBookDoc';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatMoney } from '@/lib/inventory';
import { scoped } from '@/lib/scoped';
import {
  createStandingOrder,
  deleteStandingOrder,
  fetchStandingOrders,
  makeStandingDraft,
  updateStandingOrder,
} from '@/lib/standingOrders';
import { t } from '@/lib/i18n';

/**
 * Standing orders + supplier price compare (plan release
 * 377, Nov 26, 2026): Business-only, Restaurant Corner,
 * Stock & Ordering shelf. The recurring staples — the
 * Tuesday order — set up once as a template; one tap
 * makes this week's DRAFT purchase order in Purchasing
 * for the owner to confirm. The app never sends an order
 * on its own. Below, the supplier price book: one
 * ingredient, every supplier's current price side by
 * side, cheapest first — from the invoices and orders
 * the app already collected, with each price's history.
 */
const WEEKDAY_KEYS = [
  'standingOrders.weekdayMon', 'standingOrders.weekdayTue', 'standingOrders.weekdayWed',
  'standingOrders.weekdayThu', 'standingOrders.weekdayFri', 'standingOrders.weekdaySat',
  'standingOrders.weekdaySun',
];
const BLANK = { name: '', supplier_id: '', weekday: '', active: true, note: '', lines: [{ product_id: '', qty: '' }] };

export default function RestaurantStandingOrders() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const [data, setData] = useState(null);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(null);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) return;
    const [standing, productPage, supplierPage] = await Promise.all([
      fetchStandingOrders(activeId),
      base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
      base44.entities.Supplier.filter(scoped({}, activeId), { sort: 'name', limit: 200 }),
    ]);
    setData(standing);
    setProducts(productPage.items ?? []);
    setSuppliers(supplierPage.items ?? []);
  }, [activeId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const canOrder = Boolean(data?.canOrder);
  const standingOrders = data?.standingOrders || [];
  const priceBook = data?.priceBook || [];
  const money = (value) => formatMoney(value, record?.currency, 2);
  const weekdayLabel = (day) => (day === null || day === undefined ? t('standingOrders.weekdayAny') : t(WEEKDAY_KEYS[day]));
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const startNew = () => { setForm({ ...BLANK, lines: [{ product_id: '', qty: '' }] }); setError(''); };
  const startEdit = (order) => {
    setForm({
      id: order.id,
      name: order.name || '',
      supplier_id: order.supplier_id || '',
      weekday: order.weekday === null || order.weekday === undefined ? '' : String(order.weekday),
      active: order.active !== false,
      note: order.note || '',
      lines: (order.lines || []).map((line) => ({ product_id: line.product_id || '', qty: String(line.qty || '') })),
    });
    setError('');
  };
  const setField = (key, value) => setForm((cur) => ({ ...cur, [key]: value }));
  const setLine = (index, patch) => setForm((cur) => ({
    ...cur,
    lines: cur.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
  }));

  const save = async () => {
    setSaving(true);
    try {
      const supplier = suppliers.find((s) => s.id === form.supplier_id);
      const body = {
        name: form.name,
        supplier_id: form.supplier_id || '',
        supplier_name: supplier?.name || '',
        weekday: form.weekday === '' ? null : Number(form.weekday),
        active: Boolean(form.active),
        note: form.note,
        lines: form.lines.map((line) => {
          const product = productById.get(line.product_id);
          return {
            product_id: line.product_id,
            product_name: product?.name || '',
            sku: product?.sku || '',
            qty: line.qty === '' ? 0 : Number(line.qty),
            unit_cost: Number(product?.cost) || 0,
          };
        }),
      };
      if (form.id) await updateStandingOrder(activeId, form.id, body);
      else await createStandingOrder(activeId, body);
      setForm(null);
      setFlash(t('standingOrders.saved'));
      await load();
    } catch { setError(t('standingOrders.saveFailed')); } finally { setSaving(false); }
  };

  const remove = async (order) => {
    try {
      await deleteStandingOrder(activeId, order.id);
      if (form?.id === order.id) setForm(null);
      await load();
    } catch { setError(t('standingOrders.saveFailed')); }
  };

  const makeDraft = async (order) => {
    try {
      const result = await makeStandingDraft(activeId, order.id);
      setFlash(t('standingOrders.draftMade', { number: result.draft.number }));
      await load();
    } catch { setError(t('standingOrders.draftFailed')); }
  };

  const printBook = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 50);
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <RestaurantCrumbs route="/restaurant/standing-orders" />
      </div>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-2xl font-semibold sm:text-[28px]">
            <Repeat className="h-6 w-6" /> {t('standingOrders.title')}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('standingOrders.subtitle')}</p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('standingOrders.draftNote')}</p>
        </div>
        {canOrder ? <Button onClick={startNew}>{t('standingOrders.newButton')}</Button> : null}
      </div>

      {flash ? (
        <p className="no-print flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      ) : null}
      {error ? <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}

      {form ? (
        <section className="no-print space-y-3 rounded-xl border border-border p-4">
          <h2 className="font-medium">{form.id ? t('recipes.editButton') : t('standingOrders.newButton')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('standingOrders.nameLabel')}</Label>
              <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('standingOrders.supplierLabel')}</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.supplier_id}
                onChange={(e) => setField('supplier_id', e.target.value)}
              >
                <option value="">—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t('standingOrders.weekdayLabel')}</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.weekday}
                onChange={(e) => setField('weekday', e.target.value)}
              >
                <option value="">{t('standingOrders.weekdayAny')}</option>
                {WEEKDAY_KEYS.map((key, day) => <option key={key} value={day}>{t(key)}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(form.active)} onChange={(e) => setField('active', e.target.checked)} />
              {t('standingOrders.activeLabel')}
            </label>
          </div>
          <div className="space-y-2">
            <Label>{t('standingOrders.linesLabel')}</Label>
            {form.lines.map((line, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <select
                  className="min-w-48 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={line.product_id}
                  onChange={(e) => setLine(index, { product_id: e.target.value })}
                >
                  <option value="">{t('standingOrders.productLabel')}</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <Input
                  type="number" min="0" step="any" className="w-28"
                  placeholder={t('standingOrders.qtyLabel')}
                  value={line.qty}
                  onChange={(e) => setLine(index, { qty: e.target.value })}
                />
                <Button
                  size="sm" variant="outline"
                  onClick={() => setForm((cur) => ({ ...cur, lines: cur.lines.filter((_, i) => i !== index) }))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm" variant="outline"
              onClick={() => setForm((cur) => ({ ...cur, lines: [...cur.lines, { product_id: '', qty: '' }] }))}
            >
              {t('standingOrders.addLine')}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>{t('standingOrders.saveButton')}</Button>
            <Button variant="outline" onClick={() => setForm(null)}>{t('alerts.cancel')}</Button>
          </div>
        </section>
      ) : null}

      <section className="no-print space-y-3">
        {!data ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : standingOrders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <Repeat className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{t('standingOrders.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('standingOrders.emptyBody')}</p>
          </div>
        ) : (
          standingOrders.map((order) => {
            const total = (order.lines || []).reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unit_cost) || 0), 0);
            return (
              <div key={order.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {order.name}
                    {order.supplier_name ? <span className="text-muted-foreground">{` · ${order.supplier_name}`}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {`${weekdayLabel(order.weekday)} · ${t('standingOrders.lineSummary', { lines: (order.lines || []).length, total: money(total) })}`}
                    {order.active === false ? ` · ${t('standingOrders.activeLabel')}` : ''}
                  </p>
                </div>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {(order.lines || []).map((line, index) => (
                    <li key={index}>{`${line.qty} × ${line.product_name}`}</li>
                  ))}
                </ul>
                {order.last_draft_number ? (
                  <p className="mt-1 text-xs text-muted-foreground">{order.last_draft_number}</p>
                ) : null}
                {canOrder ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => makeDraft(order)}>{t('standingOrders.makeDraftButton')}</Button>
                    <Button size="sm" variant="outline" onClick={() => startEdit(order)}>{t('recipes.editButton')}</Button>
                    <Button size="sm" variant="outline" onClick={() => remove(order)}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> {t('recipes.deleteButton')}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </section>

      <section className="no-print space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{t('priceBook.title')}</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('priceBook.subtitle')}</p>
          </div>
          <Button variant="outline" onClick={printBook}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('priceBook.printButton')}
          </Button>
        </div>
        {!data ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : priceBook.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <p className="text-sm font-medium">{t('priceBook.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('priceBook.emptyBody')}</p>
          </div>
        ) : (
          priceBook.map((entry) => (
            <div key={entry.product_id} className="overflow-hidden rounded-xl border border-border">
              <p className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium">
                {entry.product_name || entry.product_id}
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-3 py-2 font-medium">{t('priceBook.colSupplier')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('priceBook.colPrice')}</th>
                    <th className="px-3 py-2 font-medium">{t('priceBook.colDate')}</th>
                    <th className="px-3 py-2 font-medium">{t('priceBook.colSource')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.offers.map((offer, index) => (
                    <tr key={`${offer.supplier_id || offer.supplier_name}-${offer.date}`} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        {offer.supplier_name || '—'}
                        {index === 0 ? (
                          <span className="ml-2 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-xs text-ok">
                            {t('priceBook.cheapest')}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{money(offer.unit_cost)}</td>
                      <td className="px-3 py-2">{offer.date || '—'}</td>
                      <td className="px-3 py-2">{offer.source === 'invoice' ? t('priceBook.sourceInvoice') : t('priceBook.sourceOrder')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {entry.history.length > entry.offers.length ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  {entry.history.map((h) => `${h.supplier_name || '—'}: ${money(h.unit_cost)}${h.date ? ` (${h.date})` : ''}`).join(' · ')}
                </p>
              ) : null}
            </div>
          ))
        )}
      </section>

      {printing ? (
        <div className="print-area hidden print:block">
          <PriceBookDoc priceBook={priceBook} business={record} docStyle={docStyle} />
        </div>
      ) : null}
    </div>
  );
}
