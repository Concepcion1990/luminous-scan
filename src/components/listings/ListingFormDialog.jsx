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
import { t } from '@/lib/i18n';

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
        name: listing.product_name || t('listings.productFallback'),
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
      setError(t('listings.chooseProductError'));
      return;
    }
    const price = values.price === '' ? null : Number(values.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      setError(t('listings.priceError'));
      return;
    }
    const listed = values.quantity_listed === '' ? null : Number(values.quantity_listed);
    if (listed !== null && (!Number.isFinite(listed) || listed < 0)) {
      setError(t('listings.quantityError'));
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
      onSaved(
        listing
          ? t('listings.updated', { name: product.name })
          : t('listings.added', { name: product.name })
      );
    } catch (e) {
      setError(e.message || t('listings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{listing ? t('listings.editTitle') : t('listings.newTitle')}</DialogTitle>
          <DialogDescription>{t('listings.formDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">{t('listings.product')}</Label>
            <Select
              value={values.product_id || 'none'}
              onValueChange={(v) => set('product_id', v === 'none' ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('listings.chooseProduct')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('listings.chooseProduct')}</SelectItem>
                {options.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.sku ? `${p.name} · ${p.sku}` : p.name}
                    {p.gone ? t('listings.noLongerInCatalog') : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t('listings.channel')}</Label>
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
              <Label className="text-xs">{t('listings.status')}</Label>
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
              <Label className="text-xs">{t('listings.listedPrice')}</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={values.price}
                onChange={(e) => set('price', e.target.value)}
                placeholder={t('listings.listedPricePlaceholder')}
                className="numeric"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('listings.quantityListed')}</Label>
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                value={values.quantity_listed}
                onChange={(e) => set('quantity_listed', e.target.value)}
                placeholder={t('listings.quantityListedPlaceholder')}
                className="numeric"
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('listings.listingId')}</Label>
            <Input
              value={values.external_id}
              onChange={(e) => set('external_id', e.target.value)}
              placeholder={t('listings.listingIdPlaceholder')}
              className="numeric"
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('listings.listingLink')}</Label>
            <Input
              value={values.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder={t('listings.listingLinkPlaceholder')}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label className="text-xs">{t('listings.listedOn')}</Label>
              <Input
                type="date"
                value={values.listed_on}
                onChange={(e) => set('listed_on', e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{t('listings.lastChecked')}</Label>
              <Input
                type="date"
                value={values.last_checked}
                onChange={(e) => set('last_checked', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{t('listings.notes')}</Label>
            <Input
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder={t('listings.notesPlaceholder')}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('listings.cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t('listings.saving') : t('listings.saveListing')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}