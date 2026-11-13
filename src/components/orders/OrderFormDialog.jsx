import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Plus } from 'lucide-react';
import OrderLineRow from '@/components/orders/OrderLineRow';
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
import { blankLine, CHANNELS, orderNumber, orderTotals } from '@/lib/orders';
import { money, todayIso } from '@/lib/purchasing';
import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';
import { t } from '@/lib/i18n';

export default function OrderFormDialog({ open, onOpenChange, order, products, locations, currency, onSaved }) {
  const { activeId } = useBusiness();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (order) {
      setForm({
        number: order.number || orderNumber(),
        customer_name: order.customer_name || '',
        customer_ref: order.customer_ref || '',
        customer_email: order.customer_email || '',
        customer_phone: order.customer_phone || '',
        channel: order.channel || 'manual',
        order_date: order.order_date || todayIso(),
        location_id: order.location_id || locations[0]?.id || '',
        discount: order.discount ?? '',
        shipping: order.shipping ?? '',
        tax: order.tax ?? '',
        carrier: order.carrier || '',
        tracking_ref: order.tracking_ref || '',
        notes: order.notes || '',
        lines: (order.lines || []).map((l) => ({ ...blankLine(), ...l, unit_price: l.unit_price ?? '' })),
      });
    } else {
      setForm({
        number: orderNumber(),
        customer_name: '',
        customer_ref: '',
        customer_email: '',
        customer_phone: '',
        channel: 'manual',
        order_date: todayIso(),
        location_id: locations[0]?.id || '',
        discount: '',
        shipping: '',
        tax: '',
        carrier: '',
        tracking_ref: '',
        notes: '',
        lines: [blankLine()],
      });
    }
  }, [open, order, locations]);

  if (!form) return null;

  const totals = orderTotals(form);
  const updateLine = (index, patch) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  const save = async () => {
    const lines = form.lines
      .filter((line) => line.product_id && Number(line.quantity) > 0)
      .map((line) => ({
        product_id: line.product_id,
        product_name: line.product_name,
        sku: line.sku || '',
        quantity: Number(line.quantity) || 0,
        unit_price: Number(line.unit_price) || 0,
        reserved: Number(line.reserved) || 0,
        shipped: Number(line.shipped) || 0,
      }));
    if (!lines.length) {
      setError(t('orders.needLine'));
      return;
    }

    setSaving(true);
    setError('');
    const location = locations.find((l) => l.id === form.location_id);
    const payload = {
      number: form.number,
      customer_name: form.customer_name.trim(),
      customer_ref: form.customer_ref.trim(),
      customer_email: form.customer_email.trim(),
      customer_phone: form.customer_phone.trim(),
      channel: form.channel,
      order_date: form.order_date || todayIso(),
      location_id: location?.id || '',
      location_name: location?.name || '',
      lines,
      discount: Number(form.discount) || 0,
      shipping: Number(form.shipping) || 0,
      tax: Number(form.tax) || 0,
      subtotal: totals.subtotal,
      total: totals.total,
      carrier: form.carrier.trim(),
      tracking_ref: form.tracking_ref.trim(),
      notes: form.notes,
    };

    try {
      if (order) await base44.entities.Order.update(order.id, payload);
      else await base44.entities.Order.create(withBusiness({ ...payload, status: 'new' }, activeId));
      onOpenChange(false);
      onSaved?.(order ? t('orders.orderUpdated') : t('orders.orderCreated'));
    } catch (e) {
      setError(e.message || t('orders.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {order ? t('orders.editTitle', { number: order.number }) : t('orders.newTitle')}
          </DialogTitle>
          <DialogDescription>{t('orders.formDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">{t('orders.orderNumber')}</Label>
            <Input
              className="font-mono text-xs"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.customer')}</Label>
              <Input
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                placeholder={t('orders.customerNamePlaceholder')}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.customerReference')}</Label>
              <Input
                value={form.customer_ref}
                onChange={(e) => setForm({ ...form, customer_ref: e.target.value })}
                placeholder={t('orders.customerReferencePlaceholder')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.email')}</Label>
              <Input
                type="email"
                value={form.customer_email}
                onChange={(e) => setForm({ ...form, customer_email: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.phone')}</Label>
              <Input
                value={form.customer_phone}
                onChange={(e) => setForm({ ...form, customer_phone: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.channel')}</Label>
              <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.orderDate')}</Label>
              <Input
                type="date"
                value={form.order_date}
                onChange={(e) => setForm({ ...form, order_date: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('orders.shipsFrom')}</Label>
            <Select
              value={form.location_id || 'none'}
              onValueChange={(v) => setForm({ ...form, location_id: v === 'none' ? '' : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('orders.chooseLocation')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('orders.chooseLocation')}</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('orders.products')}</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> {t('orders.addLine')}
              </Button>
            </div>
            {form.lines.map((line, index) => (
              <OrderLineRow
                key={index}
                line={line}
                products={products}
                currency={currency}
                onChange={(patch) => updateLine(index, patch)}
                onRemove={() =>
                  setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }))
                }
              />
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.discount')}</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.discount}
                onChange={(e) => setForm({ ...form, discount: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.shipping')}</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.shipping}
                onChange={(e) => setForm({ ...form, shipping: e.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.tax')}</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.tax}
                onChange={(e) => setForm({ ...form, tax: e.target.value })}
              />
            </div>
          </div>

          <div className="rounded-lg bg-secondary px-3 py-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>{t('orders.subtotal')}</span>
              <span className="numeric">{money(totals.subtotal, currency)}</span>
            </div>
            <div className="mt-1 flex justify-between font-medium">
              <span>{t('orders.total')}</span>
              <span className="numeric">{money(totals.total, currency)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.carrier')}</Label>
              <Input
                value={form.carrier}
                onChange={(e) => setForm({ ...form, carrier: e.target.value })}
                placeholder={t('orders.carrierPlaceholder')}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.trackingReference')}</Label>
              <Input
                className="font-mono text-xs"
                value={form.tracking_ref}
                onChange={(e) => setForm({ ...form, tracking_ref: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('orders.notes')}</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={t('orders.notesPlaceholder')}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('orders.cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t('orders.saving') : t('orders.saveOrder')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}