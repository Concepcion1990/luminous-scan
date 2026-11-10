import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';
import { LISTING_CHANNELS, LISTING_STATUSES } from '@/lib/listings';

const EMPTY = {
  product_id: '',
  channel: 'other',
  status: 'draft',
  price: '',
  quantity_listed: '',
  external_id: '',
  url: '',
  listed_on: '',
  last_checked: '',
  notes: '',
};

export default function ListingFormDialog({ open, onOpenChange, listing, products, onSaved }) {
  const { activeId } = useBusiness();
  const [values, setValues] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setValues(
      listing
        ? {
            product_id: listing.product_id || '',
            channel: listing.channel || 'other',
            status: listing.status || 'draft',
            price: listing.price ?? '',
            quantity_listed: listing.quantity_listed ?? '',
            external_id: listing.external_id || '',
            url: listing.url || '',
            listed_on: listing.listed_on || '',
            last_checked: listing.last_checked || '',
            notes: listing.notes || '',
          }
        : EMPTY
    );
    setError('');
  }, [open, listing]);

  const set = (key, value) => setValues((prev) => ({ ...prev, [key]: value }));

  // A listing whose product has left the catalog, or sits beyond the products loaded
  // here, must still be editable: keep its own stored product as a choice.
  const options = useMemo(() => {
    if (!listing?.product_id) return products;
    if (products.some((product) => product.id === listing.product_id)) return products;
    return [
      {
        id: listing.product_id,
        name: listing.product_name || 'Product',
        sku: listing.sku || '',
        gone: true,
      },
      ...products,
    ];
  }, [products, listing]);

  const save = async () => {
    setError('');
    const product = options.find((p) => p.id === values.product_id);
    if (!product) {
      setError('Choose which product the listing is for.');
      return;
    }
    const price = values.price === '' ? null : Number(values.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setError('Enter a listed price of 0 or more.');
      return;
    }
    const listed = values.quantity_listed === '' ? null : Number(values.quantity_listed);
    if (listed !== null && (!Number.isFinite(listed) || listed < 0)) {
      setError('Enter a listed quantity of 0 or more.');
      return;
    }
    setSaving(true);
    try {
      const payload = withBusiness(
        {
          product_id: product.id,
          product_name: product.name,
          sku: product.sku || '',
          channel: values.channel,
          status: values.status,
          price,
          quantity_listed: listed,
          external_id: values.external_id,
          url: values.url,
          listed_on: values.listed_on || null,
          last_checked: values.last_checked || null,
          notes: values.notes,
        },
        activeId
      );
      if (listing) await base44.entities.Listing.update(listing.id, payload);
      else await base44.entities.Listing.create(payload);
      onOpenChange(false);
      onSaved(listing ? `${product.name}: listing updated.` : `${product.name}: listing added.`);
    } catch (e) {
      setError(e.message || 'Could not save this listing.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{listing ? 'Edit listing' : 'New listing'}</DialogTitle>
          <DialogDescription>
            Kept by hand — nothing syncs with a marketplace, so update it whenever you change a listing there.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Product</Label>
            <Select
              value={values.product_id || 'none'}
              onValueChange={(v) => set('product_id', v === 'none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a product" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Choose a product</SelectItem>
                {options.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.sku ? `${p.name} · ${p.sku}` : p.name}
                    {p.gone ? ' (no longer in the catalog)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label className="text-xs">Channel</Label>
              <Select value={values.channel} onValueChange={(v) => set('channel', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LISTING_CHANNELS).map(([key, meta]) => (
                    <SelectItem key={key} value={key}>
                      {meta.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Status</Label>
              <Select value={values.status} onValueChange={(v) => set('status', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LISTING_STATUSES).map(([key, meta]) => (
                    <SelectItem key={key} value={key}>
                      {meta.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label className="text-xs">Listed price</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={values.price}
                onChange={(e) => set('price', e.target.value)}
                placeholder="What it sells for there"
                className="numeric"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Quantity listed</Label>
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                value={values.quantity_listed}
                onChange={(e) => set('quantity_listed', e.target.value)}
                placeholder="How many are offered"
                className="numeric"
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">Listing id on the channel</Label>
            <Input
              value={values.external_id}
              onChange={(e) => set('external_id', e.target.value)}
              placeholder="Optional — the marketplace's own id"
              className="numeric"
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">Listing link</Label>
            <Input
              value={values.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://…"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label className="text-xs">Listed on</Label>
              <Input
                type="date"
                value={values.listed_on}
                onChange={(e) => set('listed_on', e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Last checked</Label>
              <Input
                type="date"
                value={values.last_checked}
                onChange={(e) => set('last_checked', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">Notes</Label>
            <Input
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Variation, fees, what needs fixing…"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save listing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}