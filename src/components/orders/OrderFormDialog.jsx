import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Link } from 'react-router-dom';
import { base44, apiRequest } from '@/api/client';
import { Plus, ScanBarcode } from 'lucide-react';
import BarcodeScanner from '@/components/scan/BarcodeScanner';
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
import AddLocationInline from '@/components/locations/AddLocationInline';
import { useCarrierLabel } from '@/components/print/CarrierLabelPanel';
import OrderLabelField from '@/components/orders/OrderLabelField';
import { blankLine, CHANNELS, orderNumber, orderTotals } from '@/lib/orders';
import { money, todayIso } from '@/lib/purchasing';
import { computeOrderTax, formatTaxRate, parseTaxRate } from '@/lib/taxRate';
import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';
import { t } from '@/lib/i18n';

export default function OrderFormDialog({ open, onOpenChange, order, products, locations, currency, onSaved, focusShipsFrom = false }) {
  const { activeId, record } = useBusiness();
  const [form, setForm] = useState(null);
  // The set-once tax rate (owner ruling, Nov 15, 2026): on a NEW
  // order the Tax box pre-fills from the items subtotal until the
  // moment it is typed in by hand — from then on the typed value
  // rules this order, and the setting is never written back.
  const [taxTouched, setTaxTouched] = useState(false);
  const taxRate = parseTaxRate(record?.tax_rate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addressOnFile, setAddressOnFile] = useState(false);
  const shipsFromRef = useRef(null);
  // In-form tracking scanner (Nov 18, 2026): the scan button beside
  // Tracking reference opens the camera scanner as an overlay INSIDE
  // this dialog — the form never unmounts, so a half-filled order
  // keeps every value. A carrier label's barcode (USPS numbers run
  // ~30 digits) drops straight into the field instead of being typed
  // by hand. Same pattern as the product form's code scanners: the
  // first capture is latched, the overlay closes, focus returns to
  // the field, and Save stays the only write.
  const [trackingScanOpen, setTrackingScanOpen] = useState(false);
  const trackingScanHandledRef = useRef(false);
  // The shipping-label door (Nov 18, 2026): the form's own section
  // onto the SAME carrier-label record the Print Center keeps —
  // one label, two doors. On an existing order the hook reads and
  // writes the saved record directly; on a new order the field
  // stages the file and save() attaches it the moment the order
  // exists. createdIdRef remembers a just-created order so that if
  // the label attach ever fails, pressing Save again updates that
  // order and retries the label — never a duplicate order.
  const carrier = useCarrierLabel(activeId, order?.id || '');
  const labelFieldRef = useRef(null);
  const createdIdRef = useRef('');

  const openTrackingScanner = () => {
    trackingScanHandledRef.current = false;
    setTrackingScanOpen(true);
  };

  // A capture REPLACES the field's contents with the decoded text
  // (trimmed) — exactly how the product form's scan-to-fill fields
  // behave. No product lookup, no carrier validation, no save: the
  // number simply lands in the box.
  const handleTrackingScan = (raw) => {
    if (trackingScanHandledRef.current) return;
    trackingScanHandledRef.current = true;
    const value = String(raw || '').trim();
    setTrackingScanOpen(false);
    if (!value) return;
    setForm((f) => (f ? { ...f, tracking_ref: value } : f));
    requestAnimationFrame(() => document.getElementById('tracking_ref')?.focus());
  };

  // Opened from a blocked-action banner: bring the ships-from
  // picker into view — the door opens at the missing field.
  useEffect(() => {
    if (open && focusShipsFrom && shipsFromRef.current) {
      const id = setTimeout(
        () => shipsFromRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
        90,
      );
      return () => clearTimeout(id);
    }
  }, [open, focusShipsFrom]);

  // Returning customer (create mode): the address book may hold
  // saved addresses under this customer's name (identity is name
  // + address — a name alone identifies no one). Offer them: one
  // entry prefills; several become a chooser. Choosing binds the
  // order to that entry, and saving refreshes its 90 days. Never
  // overwrites anything already typed.
  const [savedAddresses, setSavedAddresses] = useState([]);
  const applySavedAddress = (saved) => {
    setForm((f) => ({
      ...f,
      ship_street: saved.ship_street || '',
      ship_city: saved.ship_city || '',
      ship_region: saved.ship_region || '',
      ship_postal: saved.ship_postal || '',
      ship_country: saved.ship_country || '',
    }));
    setAddressOnFile(true);
    setSavedAddresses([]);
  };
  const lookupSavedAddress = async () => {
    if (order || !form) return;
    const name = form.customer_name.trim();
    if (!name) return;
    if (form.ship_street || form.ship_city || form.ship_region || form.ship_postal || form.ship_country) return;
    try {
      const params = new URLSearchParams({ name });
      const res = await apiRequest(`/api/businesses/${activeId}/customer-addresses?${params.toString()}`);
      const entries = res?.addresses || [];
      if (entries.length === 1) applySavedAddress(entries[0]);
      else if (entries.length > 1) setSavedAddresses(entries);
    } catch {
      /* no saved addresses — the form simply stays blank */
    }
  };
  // Own copy of the location list so the Ships-from picker can
  // offer the inline add-a-location door when the list is empty.
  const [localLocations, setLocalLocations] = useState(locations);

  useEffect(() => {
    if (!open) return;
    setLocalLocations(locations);
    setAddressOnFile(false);
    setSavedAddresses([]);
    setError('');
    setTaxTouched(false);
    createdIdRef.current = '';
    labelFieldRef.current?.clearStaged();
    if (order) {
      setForm({
        number: order.number || orderNumber(),
        customer_name: order.customer_name || '',
        customer_ref: order.customer_ref || '',
        customer_email: order.customer_email || '',
        customer_phone: order.customer_phone || '',
        ship_street: order.ship_street || '',
        ship_city: order.ship_city || '',
        ship_region: order.ship_region || '',
        ship_postal: order.ship_postal || '',
        ship_country: order.ship_country || '',
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
        ship_street: '',
        ship_city: '',
        ship_region: '',
        ship_postal: '',
        ship_country: '',
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

  // Pre-fill (create mode only, rate set, box untouched): Tax =
  // items subtotal × rate — shipping is NOT in the taxed base.
  // Recomputes as lines change; stops forever at the first
  // hand-typed value. Edit mode never auto-fills: a saved order's
  // tax is its own.
  useEffect(() => {
    if (!open || order || !form || taxTouched || taxRate == null) return;
    const computed = computeOrderTax(orderTotals(form).subtotal, taxRate);
    const next = computed ? computed.toFixed(2) : '';
    setForm((f) => (f && String(f.tax ?? '') !== next ? { ...f, tax: next } : f));
  }, [open, order, form, taxTouched, taxRate]);

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
    const location = localLocations.find((l) => l.id === form.location_id);
    const payload = {
      number: form.number,
      customer_name: form.customer_name.trim(),
      customer_ref: form.customer_ref.trim(),
      customer_email: form.customer_email.trim(),
      customer_phone: form.customer_phone.trim(),
      ship_street: form.ship_street.trim(),
      ship_city: form.ship_city.trim(),
      ship_region: form.ship_region.trim(),
      ship_postal: form.ship_postal.trim(),
      ship_country: form.ship_country.trim(),
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
      let savedId = order?.id || createdIdRef.current || '';
      if (order) {
        await base44.entities.Order.update(order.id, payload);
      } else if (savedId) {
        // A retry after the order was created but its staged label
        // failed to attach: update the same order, never duplicate.
        await base44.entities.Order.update(savedId, payload);
      } else {
        const created = await base44.entities.Order.create(
          withBusiness({ ...payload, status: 'new' }, activeId),
        );
        savedId = created?.id || '';
        createdIdRef.current = savedId;
      }
      // A label staged on a new order attaches NOW, onto the saved
      // order, through the same route the Print Center posts to —
      // from here on it is the order's permanent record. If the
      // attach fails, the order itself is saved; the form stays
      // open with the label still staged so Save can retry it.
      if (labelFieldRef.current?.hasStaged()) {
        const attached = savedId
          ? await labelFieldRef.current.uploadStaged(savedId)
          : false;
        if (!attached) {
          setError(t('print.carrier.failed'));
          return;
        }
      }
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
                onBlur={lookupSavedAddress}
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

          <div className="grid gap-1" ref={shipsFromRef}>
            <Label className="text-xs">{t('orders.shipsFrom')}</Label>
            {localLocations.length === 0 ? (
              <AddLocationInline
                businessId={activeId}
                onCreated={(place) => {
                  setLocalLocations([place]);
                  setForm({ ...form, location_id: place.id });
                }}
              />
            ) : (
              <Select
                value={form.location_id || 'none'}
                onValueChange={(v) => setForm({ ...form, location_id: v === 'none' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('orders.chooseLocation')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('orders.chooseLocation')}</SelectItem>
                  {localLocations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-2 rounded-lg border border-border p-3">
            <p className="text-xs font-medium">{t('orders.shipToTitle')}</p>
            {addressOnFile && (
              <p className="text-xs text-muted-foreground">{t('orders.addressOnFile')}</p>
            )}
            {savedAddresses.length > 1 && (
              <div className="grid gap-1.5">
                <p className="text-xs text-muted-foreground">{t('orders.chooseSavedAddress')}</p>
                {savedAddresses.map((saved, index) => (
                  <Button
                    key={index}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto justify-start whitespace-normal py-2 text-left"
                    onClick={() => applySavedAddress(saved)}
                  >
                    {[saved.ship_street, saved.ship_city, saved.ship_region, saved.ship_postal, saved.ship_country]
                      .filter(Boolean)
                      .join(', ')}
                  </Button>
                ))}
              </div>
            )}
            <div className="grid gap-1">
              <Label className="text-xs">{t('orders.shipStreet')}</Label>
              <Input
                value={form.ship_street}
                onChange={(e) => setForm({ ...form, ship_street: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">{t('orders.shipCity')}</Label>
                <Input
                  value={form.ship_city}
                  onChange={(e) => setForm({ ...form, ship_city: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">{t('orders.shipRegion')}</Label>
                <Input
                  value={form.ship_region}
                  onChange={(e) => setForm({ ...form, ship_region: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">{t('orders.shipPostal')}</Label>
                <Input
                  value={form.ship_postal}
                  onChange={(e) => setForm({ ...form, ship_postal: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">{t('orders.shipCountry')}</Label>
                <Input
                  value={form.ship_country}
                  onChange={(e) => setForm({ ...form, ship_country: e.target.value })}
                />
              </div>
            </div>
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
                onChange={(e) => {
                  setTaxTouched(true);
                  setForm({ ...form, tax: e.target.value });
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                {taxRate != null ? (
                  <>
                    {t('orders.taxRateSet', { rate: formatTaxRate(record?.tax_rate) })} —{' '}
                    <Link to="/settings" className="underline">
                      {t('orders.taxRateChange')}
                    </Link>
                  </>
                ) : (
                  <>
                    {t('orders.taxRateUnset')} —{' '}
                    <Link to="/settings" className="underline">
                      {t('orders.taxRateSetOne')}
                    </Link>
                  </>
                )}
              </p>
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
              <div className="flex gap-2">
                <Input
                  id="tracking_ref"
                  className="min-w-0 flex-1 font-mono text-xs"
                  value={form.tracking_ref}
                  onChange={(e) => setForm({ ...form, tracking_ref: e.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={openTrackingScanner}
                  aria-label={t('orders.scanTracking')}
                >
                  <ScanBarcode className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <OrderLabelField
            ref={labelFieldRef}
            businessId={activeId}
            orderId={order?.id || ''}
            carrier={carrier}
          />

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

        {/* In-form scanner window: rendered INSIDE the dialog, so
            the form underneath never unmounts and nothing typed is
            lost. Closing it (capture or Cancel) returns to the exact
            same half-filled order. Since Nov 20, 2026 (release 328)
            it is a real nested Radix Dialog on the Add window's
            construction, not a hand-rolled fixed overlay: the
            hand-rolled card was fixed-positioned INSIDE this
            dialog's transformed content, so it anchored to the
            dialog's box rather than the viewport, and it had no
            focus trap and no scroll lock of its own. As a nested
            dialog it portals to the viewport, holds focus, and
            locks scroll; Escape and the backdrop now also close
            the scanner (never the order form). */}
        {trackingScanOpen && (
          <DialogPrimitive.Root
            open
            onOpenChange={(next) => {
              if (!next) setTrackingScanOpen(false);
            }}
          >
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
              <DialogPrimitive.Content
                aria-describedby={undefined}
                className="fixed left-[50%] top-[50%] z-[80] w-[calc(100vw-2rem)] max-w-sm translate-x-[-50%] translate-y-[-50%] space-y-3 rounded-xl bg-card p-4 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
              >
                <DialogPrimitive.Title className="sr-only">{t('orders.scanTracking')}</DialogPrimitive.Title>
                <BarcodeScanner onDetect={handleTrackingScan} />
                <Button type="button" variant="outline" className="w-full" onClick={() => setTrackingScanOpen(false)}>
                  {t('orders.cancel')}
                </Button>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        )}
      </DialogContent>
    </Dialog>
  );
}