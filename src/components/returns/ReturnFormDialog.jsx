import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Plus } from 'lucide-react';
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
import { money, todayIso } from '@/lib/purchasing';
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
  onSaved,
}) {
  const { activeId } = useBusiness();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (record) {
      setForm({
        number: record.number || returnNumber(),
        kind: record.kind || 'return',
        reason: record.reason || 'changed_mind',
        order_id: record.order_id || '',
        order_number: record.order_number || '',
        customer_name: record.customer_name || '',
        received_date: record.received_date || todayIso(),
        location_id: record.location_id || locations[0]?.id || '',
        refund_amount: record.refund_amount ?? '',
        notes: record.notes || '',
        lines: (record.lines || []).map((l) => ({ ...blankReturnLine(), ...l, unit_price: l.unit_price ?? '' })),
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
        location_id: locations[0]?.id || '',
        refund_amount: '',
        notes: '',
        lines: [blankReturnLine()],
        exchange_lines: [],
      });
    }
  }, [open, record, locations]);

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
    const location = locations.find((l) => l.id === form.location_id);
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
              <Select
                value={form.location_id || 'none'}
                onValueChange={(v) => setForm({ ...form, location_id: v === 'none' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('returns.chooseLocation')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('returns.chooseLocation')}</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('returns.returnedItems')}</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankReturnLine()] }))}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> {t('returns.addItem')}
              </Button>
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
            <Label className="text-xs">{t('returns.amountRefunded')}</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={form.refund_amount}
              onChange={(e) => setForm({ ...form, refund_amount: e.target.value })}
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
      </DialogContent>
    </Dialog>
  );
}