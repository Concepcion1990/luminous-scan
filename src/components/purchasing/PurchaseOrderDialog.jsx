import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Plus } from 'lucide-react';
import OrderLineRow from '@/components/purchasing/OrderLineRow';
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
import { blankLine, money, poNumber, poTotals, todayIso } from '@/lib/purchasing';
import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';

const STATUSES = ['draft', 'ordered', 'cancelled'];

const STATUS_LABELS = {
  draft: 'Draft',
  ordered: 'On order',
  partial: 'Partly received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export default function PurchaseOrderDialog({
  open,
  onOpenChange,
  order,
  suppliers,
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
    if (order) {
      setForm({
        supplier_id: order.supplier_id || '',
        number: order.number || poNumber(),
        status: order.status || 'ordered',
        order_date: order.order_date || todayIso(),
        expected_date: order.expected_date || '',
        location_id: order.location_id || locations[0]?.id || '',
        shipping: order.shipping ?? '',
        tax: order.tax ?? '',
        note: order.note || '',
        lines: (order.lines || []).map((l) => ({ ...blankLine(), ...l, unit_cost: l.unit_cost ?? '' })),
      });
    } else {
      setForm({
        supplier_id: '',
        number: poNumber(),
        status: 'ordered',
        order_date: todayIso(),
        expected_date: '',
        location_id: locations[0]?.id || '',
        shipping: '',
        tax: '',
        note: '',
        lines: [blankLine()],
      });
    }
  }, [open, order, locations]);

  if (!form) return null;

  const totals = poTotals({ lines: form.lines, shipping: form.shipping, tax: form.tax });
  // A partly or fully received order keeps its own status on the list.
  const statusOptions = STATUSES.includes(form.status) ? STATUSES : [form.status, ...STATUSES];
  const updateLine = (index, patch) =>
    setForm((f) => ({
      ...f,
      lines: f.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));

  const save = async () => {
    const supplier = suppliers.find((s) => s.id === form.supplier_id);
    if (!supplier) {
      setError('Choose a supplier for this order.');
      return;
    }
    const lines = form.lines
      .filter((line) => line.product_id && Number(line.qty_ordered) > 0)
      .map((line) => ({
        product_id: line.product_id,
        product_name: line.product_name,
        sku: line.sku || '',
        qty_ordered: Number(line.qty_ordered) || 0,
        qty_received: Number(line.qty_received) || 0,
        unit_cost: Number(line.unit_cost) || 0,
      }));
    if (!lines.length) {
      setError('Add at least one product with a quantity.');
      return;
    }

    const receivedAlready = (order?.lines || []).reduce(
      (sum, line) => sum + (Number(line.qty_received) || 0),
      0
    );
    if (order) {
      if (order.status === 'received' && form.status !== 'received') {
        setError('This order is fully received — its status stays Received.');
        return;
      }
      if (form.status === 'cancelled' && receivedAlready > 0) {
        setError('Stock already arrived on this order, so it cannot be cancelled.');
        return;
      }
      const regressed = lines.find((line) => (Number(line.qty_received) || 0) > line.qty_ordered);
      if (regressed) {
        setError(
          `${regressed.product_name}: ${regressed.qty_received} already received — the ordered quantity cannot be lower.`
        );
        return;
      }
    }

    setSaving(true);
    setError('');
    const location = locations.find((l) => l.id === form.location_id);
    const payload = {
      number: form.number,
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      status: form.status,
      order_date: form.order_date || todayIso(),
      expected_date: form.expected_date || '',
      location_id: location?.id || '',
      location_name: location?.name || '',
      lines,
      subtotal: totals.subtotal,
      shipping: Number(form.shipping) || 0,
      tax: Number(form.tax) || 0,
      total: totals.total,
      note: form.note.trim(),
    };
    try {
      const saved = order
        ? await base44.entities.PurchaseOrder.update(order.id, payload)
        : await base44.entities.PurchaseOrder.create(withBusiness(payload, activeId));
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not save this order.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{order ? `Edit ${order.number}` : 'New purchase order'}</DialogTitle>
          <DialogDescription>
            Costs entered here become each product's cost when you receive the order.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Supplier</Label>
            <Select
              value={form.supplier_id || 'none'}
              onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v === 'none' ? '' : v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a supplier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose a supplier</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="po-number">PO number</Label>
              <Input
                id="po-number"
                value={form.number}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                className="font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s] || s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="order-date">Order date</Label>
              <Input
                id="order-date"
                type="date"
                value={form.order_date}
                onChange={(e) => setForm((f) => ({ ...f, order_date: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="expected">Expected</Label>
              <Input
                id="expected"
                type="date"
                value={form.expected_date}
                onChange={(e) => setForm((f) => ({ ...f, expected_date: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Receiving location</Label>
            <Select
              value={form.location_id || 'none'}
              onValueChange={(v) => setForm((f) => ({ ...f, location_id: v === 'none' ? '' : v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose a location</SelectItem>
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
              <Label>Lines</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add line
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
                  setForm((f) => ({
                    ...f,
                    lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== index) : f.lines,
                  }))
                }
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="shipping">Shipping</Label>
              <Input
                id="shipping"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.shipping}
                onChange={(e) => setForm((f) => ({ ...f, shipping: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tax">Tax</Label>
              <Input
                id="tax"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.tax}
                onChange={(e) => setForm((f) => ({ ...f, tax: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1 rounded-lg bg-secondary px-3 py-2.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span className="numeric">{money(totals.subtotal, currency)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="numeric">{money(totals.total, currency)}</span>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="po-note">Note</Label>
            <Textarea
              id="po-note"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              rows={2}
              placeholder="Special order, rep name, backorder details"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : order ? 'Save order' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}