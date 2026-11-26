import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { base44 } from '@/api/client';
import { Check, Plus, ScanLine } from 'lucide-react';
import BarcodeScanner from '@/components/scan/BarcodeScanner';
import ReturnLineRow from '@/components/returns/ReturnLineRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  blankExchangeLine,
  blankReturnLine,
  RETURN_KINDS,
  RETURN_REASONS,
  returnNumber,
  returnTotals,
} from '@/lib/returns';
import { returnTaxInfo } from '@/lib/taxRate';
import { findProductsByCode } from '@/lib/inventory';
import { money, todayIso } from '@/lib/purchasing';
import { firstShipFromLocation, shipFromLocations } from '@/lib/locations';
import AddLocationInline from '@/components/locations/AddLocationInline';
import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';
import { t } from '@/lib/i18n';

export default function ReturnFormDialog({
  open,
  onOpenChange,
  record,
  orders,
  products,
  locations,
  currency,
  taxRate,
  taxMode,
  onSaved,
}) {
  const { activeId } = useBusiness();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The tax on the return + the refund it feeds (owner-approved
  // Nov 18, 2026; release 349): on a NEW return both boxes
  // pre-fill — the tax from the original order's own tax (or the
  // business's tax setting when there is no order tax to derive
  // from), the refund as goods + tax — until the moment either
  // is typed in by hand. From then on the typed value rules this
  // return and is never overwritten, exactly like the order
  // form's Tax box. An existing return's saved figures are its
  // own: edit mode never auto-fills.
  const [taxTouched, setTaxTouched] = useState(false);
  const [refundTouched, setRefundTouched] = useState(false);
  // Scan-to-pick (release 349): the Scan button beside Add item
  // opens the camera scanner as an overlay INSIDE this dialog —
  // the form never unmounts, so a half-filled return keeps every
  // value. The scanner stays open and tallies like the count
  // sheet's: every scan lands on the Returned items — a product
  // already on the return gains +1, a new one takes the first
  // blank line or is appended, priced from the catalog.
  const [scanOpen, setScanOpen] = useState(false);
  const [scanNote, setScanNote] = useState(null);
  const scanQueueRef = useRef(Promise.resolve());
  // Same no-dead-end rule as every location picker (Nov 14,
  // 2026): the list is kept locally so an empty "Returned to"
  // picker can offer the inline add-a-location door.
  const [localLocations, setLocalLocations] = useState(locations);

  useEffect(() => {
    if (!open) return;
    setError('');
    setLocalLocations(locations);
    setTaxTouched(false);
    setRefundTouched(false);
    setScanOpen(false);
    setScanNote(null);
    if (record) {
      const lines = (record.lines || []).map((l) => ({
        ...blankReturnLine(),
        ...l,
        unit_price: l.unit_price ?? '',
      }));
      // The saved tax is the record's own figure. A return saved
      // before release 349 stored none: when it links an order,
      // its tax is still derivable from that order's own tax, so
      // the box opens on the order's share of the saved lines —
      // a starting value only; nothing is written unless Save is
      // pressed, and no other source is ever back-filled.
      let taxInit = record.tax_amount ?? '';
      if ((taxInit === '' || Number(taxInit) === 0) && record.order_id) {
        const order = orders.find((o) => o.id === record.order_id);
        if (order) {
          const info = returnTaxInfo({ lines, order, taxRate, taxMode });
          if (info.source === 'order' && info.tax) taxInit = info.tax.toFixed(2);
        }
      }
      setForm({
        number: record.number || returnNumber(),
        kind: record.kind || 'return',
        reason: record.reason || 'changed_mind',
        order_id: record.order_id || '',
        order_number: record.order_number || '',
        customer_name: record.customer_name || '',
        received_date: record.received_date || todayIso(),
        location_id: record.location_id || firstShipFromLocation(locations)?.id || '',
        refund_amount: record.refund_amount ?? '',
        tax_amount: taxInit,
        notes: record.notes || '',
        lines,
        exchange_lines: (record.exchange_lines || []).map((l) => ({
          ...blankExchangeLine(),
          ...l,
          unit_price: l.unit_price ?? '',
        })),
      });
    } else {
      setForm({
        number: returnNumber(),
        kind: 'return',
        reason: 'changed_mind',
        order_id: '',
        order_number: '',
        customer_name: '',
        received_date: todayIso(),
        location_id: firstShipFromLocation(locations)?.id || '',
        refund_amount: '',
        tax_amount: '',
        notes: '',
        lines: [blankReturnLine()],
        exchange_lines: [],
      });
    }
  }, [open, record, locations, orders, taxRate, taxMode]);

  // The live tax derivation for the form's lines (release 349):
  // the picked order's own tax first, the business's tax setting
  // behind it — see returnTaxInfo. Drives the Tax pre-fill below
  // and the source note under the Tax box.
  const linkedOrder = form?.order_id ? orders.find((o) => o.id === form.order_id) || null : null;
  const taxInfo = useMemo(
    () =>
      returnTaxInfo({
        lines: form?.lines || [],
        order: linkedOrder,
        taxRate,
        taxMode,
      }),
    [form?.lines, linkedOrder, taxRate, taxMode]
  );

  // Tax pre-fill (create mode only, box untouched): recomputes
  // as lines and the picked order change; stops forever at the
  // first hand-typed value.
  useEffect(() => {
    if (!open || record || !form || taxTouched) return;
    const next = taxInfo.tax ? taxInfo.tax.toFixed(2) : '';
    setForm((f) => (f && String(f.tax_amount ?? '') !== next ? { ...f, tax_amount: next } : f));
  }, [open, record, form, taxTouched, taxInfo]);

  // Refund pre-fill (create mode only, box untouched, plain
  // returns): goods + tax, so her $2.50 item taxed $0.14 offers
  // $2.64 back — never just the goods. An exchange's refund
  // stays hand-entered: what is paid back on a swap is a
  // judgment call, not a sum the form should presume.
  useEffect(() => {
    if (!open || record || !form || refundTouched || form.kind !== 'return') return;
    const total = returnTotals(form).returnedValue + (Number(form.tax_amount) || 0);
    const next = total ? (Math.round(total * 100) / 100).toFixed(2) : '';
    setForm((f) => (f && String(f.refund_amount ?? '') !== next ? { ...f, refund_amount: next } : f));
  }, [open, record, form, refundTouched]);

  if (!form) return null;

  const totals = returnTotals(form);
  const updateLine = (key, index, patch) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  const pickOrder = (id) => {
    const order = orders.find((o) => o.id === id);
    if (!order) {
      setForm((f) => ({ ...f, order_id: '', order_number: '', customer_name: '' }));
      return;
    }
    const lines = (order.lines || [])
      .filter((l) => (Number(l.shipped) || 0) > 0 || (Number(l.quantity) || 0) > 0)
      .map((l) => ({
        ...blankReturnLine(),
        product_id: l.product_id,
        product_name: l.product_name,
        sku: l.sku,
        quantity: Number(l.shipped) || Number(l.quantity) || 1,
        unit_price: l.unit_price ?? '',
      }));
    setForm((f) => ({
      ...f,
      order_id: order.id,
      order_number: order.number,
      customer_name: order.customer_name || '',
      location_id: order.location_id || f.location_id,
      lines: lines.length ? lines : f.lines,
    }));
  };

  // Scan-to-pick (release 349): a scanned product lands on the
  // Returned items — already there, its quantity climbs by one;
  // new, it takes the first still-blank line or is appended,
  // priced from the catalog exactly as a picker choice prices
  // it. Nothing is saved by a scan: Save stays the only write.
  const applyScannedProduct = (product) => {
    if (!form) return;
    const lines = [...form.lines];
    const existing = lines.findIndex((l) => l.product_id === product.id);
    let count;
    if (existing >= 0) {
      count = (Number(lines[existing].quantity) || 0) + 1;
      lines[existing] = { ...lines[existing], quantity: count };
    } else {
      const line = {
        ...blankReturnLine(),
        product_id: product.id,
        product_name: product.name || '',
        sku: product.sku || '',
        unit_price: product.price ?? '',
        quantity: 1,
      };
      count = 1;
      const blank = lines.findIndex((l) => !l.product_id);
      if (blank >= 0) lines[blank] = line;
      else lines.push(line);
    }
    setForm({ ...form, lines });
    setScanNote({
      ok: true,
      text: t('returns.scanAdded', { name: product.name || t('returnsLib.lineFallback'), count }),
    });
  };

  const processScan = async (code) => {
    try {
      const matches = await findProductsByCode(code, activeId);
      if (!matches.length) {
        setScanNote({ ok: false, text: t('counts.noProductMatch', { code }) });
        return;
      }
      applyScannedProduct(matches[0]);
    } catch (e) {
      setScanNote({ ok: false, text: e.message || t('counts.codeReadFailed') });
    }
  };

  const handleScanDetect = (raw) => {
    const code = String(raw || '').trim();
    if (!code) return;
    // Serialize the captures, as the count sheet does: the camera
    // re-arms while an earlier code is still being looked up, and
    // two scans racing the same line must never lose a unit.
    scanQueueRef.current = scanQueueRef.current.then(() => processScan(code)).catch(() => {});
  };

  const save = async () => {
    const lines = form.lines
      .filter((line) => line.product_id && Number(line.quantity) > 0)
      .map((line) => ({
        product_id: line.product_id,
        product_name: line.product_name,
        sku: line.sku || '',
        quantity: Number(line.quantity) || 0,
        condition: line.condition,
        restock: Boolean(line.restock),
        unit_price: Number(line.unit_price) || 0,
      }));
    const exchange_lines = form.exchange_lines
      .filter((line) => line.product_id && Number(line.quantity) > 0)
      .map((line) => ({
        product_id: line.product_id,
        product_name: line.product_name,
        sku: line.sku || '',
        quantity: Number(line.quantity) || 0,
        unit_price: Number(line.unit_price) || 0,
      }));
    if (!lines.length) {
      setError(t('returns.needLine'));
      return;
    }
    if (form.kind === 'exchange' && !exchange_lines.length) {
      setError(t('returns.needReplacement'));
      return;
    }

    setSaving(true);
    setError('');
    const location = localLocations.find((l) => l.id === form.location_id);
    const payload = {
      number: form.number,
      kind: form.kind,
      reason: form.reason,
      order_id: form.order_id,
      order_number: form.order_number,
      customer_name: form.customer_name.trim(),
      received_date: form.received_date || todayIso(),
      location_id: location?.id || '',
      location_name: location?.name || '',
      lines,
      exchange_lines,
      refund_amount: Number(form.refund_amount) || 0,
      tax_amount: Number(form.tax_amount) || 0,
      notes: form.notes,
    };

    try {
      if (record) await base44.entities.Return.update(record.id, payload);
      else await base44.entities.Return.create(withBusiness({ ...payload, status: 'new' }, activeId));
      onOpenChange(false);
      onSaved?.(record ? t('returns.returnUpdated') : t('returns.returnLogged'));
    } catch (e) {
      setError(e.message || t('returns.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {record ? t('returns.editTitle', { number: record.number }) : t('returns.newTitle')}
          </DialogTitle>
          <DialogDescription>{t('returns.formDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t('returns.type')}</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETURN_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('returns.reason')}</Label>
              <Select value={form.reason} onValueChange={(v) => setForm({ ...form, reason: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETURN_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('returns.originalOrder')}</Label>
            <Select value={form.order_id || 'none'} onValueChange={(v) => pickOrder(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder={t('returns.noLinkedOrder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('returns.noLinkedOrder')}</SelectItem>
                {orders.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {t('returns.orderOption', {
                      number: o.number,
                      customer: o.customer_name || t('returns.noCustomer'),
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t('returns.returnNumber')}</Label>
              <Input
                className="font-mono text-xs"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('returns.receivedOn')}</Label>
              <Input
                type="date"
                value={form.received_date}
                onChange={(e) => setForm({ ...form, received_date: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t('returns.customer')}</Label>
              <Input
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('returns.returnedTo')}</Label>
              {/* Returned to names the STORE, never a shelf
                  (the owner's ruling, Nov 25, 2026, closing the
                  352 flag): the options are this business's
                  operating sites — the Ships From wall — with a
                  legacy stored value appended once so an old
                  return keeps showing what it holds. The
                  customer sees the store's name and address on
                  the return document. */}
              {shipFromLocations(localLocations, form.location_id).length === 0 ? (
                <AddLocationInline
                  businessId={activeId}
                  onCreated={(created) => {
                    setLocalLocations([created]);
                    setForm((f) => ({ ...f, location_id: created.id }));
                  }}
                />
              ) : (
                <Select
                  value={form.location_id || 'none'}
                  onValueChange={(v) => setForm({ ...form, location_id: v === 'none' ? '' : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('returns.chooseLocation')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('returns.chooseLocation')}</SelectItem>
                    {shipFromLocations(localLocations, form.location_id).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('returns.returnedItems')}</Label>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setScanNote(null);
                    setScanOpen(true);
                  }}
                >
                  <ScanLine className="mr-1 h-3.5 w-3.5" /> {t('returns.scanItem')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankReturnLine()] }))}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> {t('returns.addItem')}
                </Button>
              </div>
            </div>
            {form.lines.map((line, index) => (
              <ReturnLineRow
                key={index}
                kind="return"
                line={line}
                products={products}
                currency={currency}
                onChange={(patch) => updateLine('lines', index, patch)}
                onRemove={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }))}
              />
            ))}
          </div>

          {form.kind === 'exchange' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t('returns.replacementItems')}</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm((f) => ({ ...f, exchange_lines: [...f.exchange_lines, blankExchangeLine()] }))
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> {t('returns.addReplacement')}
                </Button>
              </div>
              {form.exchange_lines.map((line, index) => (
                <ReturnLineRow
                  key={index}
                  kind="exchange"
                  line={line}
                  products={products}
                  currency={currency}
                  onChange={(patch) => updateLine('exchange_lines', index, patch)}
                  onRemove={() =>
                    setForm((f) => ({
                      ...f,
                      exchange_lines: f.exchange_lines.filter((_, i) => i !== index),
                    }))
                  }
                />
              ))}
            </div>
          )}

          <div className="grid gap-1">
            <Label className="text-xs">{t('returns.taxOnReturn')}</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={form.tax_amount}
              onChange={(e) => {
                setTaxTouched(true);
                setForm({ ...form, tax_amount: e.target.value });
              }}
              placeholder="0.00"
            />
            {!record && (
              <p className="text-[11px] text-muted-foreground">
                {taxInfo.source === 'order' && t('returns.taxFromOrder')}
                {taxInfo.source === 'state' && t('returns.taxFromState')}
                {taxInfo.source === 'setting' && t('returns.taxFromSetting')}
                {taxInfo.source === 'none' && t('returns.taxNone')}
              </p>
            )}
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('returns.amountRefunded')}</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={form.refund_amount}
              onChange={(e) => {
                setRefundTouched(true);
                setForm({ ...form, refund_amount: e.target.value });
              }}
              placeholder="0.00"
            />
            <p className="text-[11px] text-muted-foreground">
              {t('returns.refundHint')}
            </p>
          </div>

          <div className="rounded-lg bg-secondary px-3 py-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>{t('returns.returnedValue')}</span>
              <span className="numeric">{money(totals.returnedValue, currency)}</span>
            </div>
            <div className="mt-1 flex justify-between text-muted-foreground">
              <span>{t('returns.taxOnReturn')}</span>
              <span className="numeric">{money(Number(form.tax_amount) || 0, currency)}</span>
            </div>
            {form.kind === 'exchange' && (
              <div className="mt-1 flex justify-between text-muted-foreground">
                <span>{t('returns.replacementValue')}</span>
                <span className="numeric">{money(totals.exchangeValue, currency)}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between font-medium">
              <span>{t('returns.refundRecordedTotal')}</span>
              <span className="numeric">{money(totals.refund, currency)}</span>
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('returns.notes')}</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={t('returns.notesPlaceholder')}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('returns.cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t('returns.saving') : t('returns.saveReturn')}
          </Button>
        </DialogFooter>

        {/* In-form scanner window (release 349): a real nested
            Radix Dialog on the release-328 construction, rendered
            INSIDE this dialog so the form underneath never
            unmounts and nothing typed is lost. It stays open and
            tallies like the count sheet's scanner — every capture
            lands on the Returned items — and Escape, the backdrop
            and Done all close the scanner, never the return form. */}
        {scanOpen && (
          <DialogPrimitive.Root
            open
            onOpenChange={(next) => {
              if (!next) setScanOpen(false);
            }}
          >
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
              <DialogPrimitive.Content
                aria-describedby={undefined}
                className="fixed left-[50%] top-[50%] z-[80] w-[calc(100vw-2rem)] max-w-sm translate-x-[-50%] translate-y-[-50%] space-y-3 rounded-xl bg-card p-4 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
              >
                <DialogPrimitive.Title className="flex items-center gap-1.5 text-sm font-medium">
                  <ScanLine className="h-4 w-4" /> {t('returns.scanTitle')}
                </DialogPrimitive.Title>
                <BarcodeScanner onDetect={handleScanDetect} />
                <p className="text-sm text-muted-foreground">{t('returns.scanHint')}</p>
                {scanNote && (
                  <p
                    className={`flex items-start gap-1.5 text-sm ${
                      scanNote.ok ? 'text-ok' : 'text-destructive'
                    }`}
                    role="status"
                  >
                    {scanNote.ok && <Check className="mt-0.5 h-4 w-4 shrink-0" />}
                    <span>{scanNote.text}</span>
                  </p>
                )}
                <Button type="button" className="w-full" onClick={() => setScanOpen(false)}>
                  {t('scanTally.done')}
                </Button>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        )}
      </DialogContent>
    </Dialog>
  );
}