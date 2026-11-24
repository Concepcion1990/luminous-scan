import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
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
import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';
import { t } from '@/lib/i18n';

function plusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Receive stock as a dated batch (release 361, Nov 23,
 * 2026): a quantity of one product at one location, with
 * the use-by date the expiry page and the FEFO order run
 * on. When the product carries a shelf life, the date starts
 * filled in from it. Building batches rides the
 * restaurant.build tick — the page only offers this door to
 * its holders.
 */
export default function BatchStockDialog({ open, onOpenChange, products, locations, onSaved }) {
  const { activeId } = useBusiness();
  const [productId, setProductId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [expiresOn, setExpiresOn] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setProductId('');
    setLocationId('');
    setQuantity(1);
    setExpiresOn('');
    setNote('');
    setError('');
  }, [open ]);

  const pickProduct = (id) => {
    setProductId(id);
    const product = products.find((p) => p.id === id);
    if (product && Number(product.shelf_life_days) > 0) {
      setExpiresOn(plusDays(Number(product.shelf_life_days)));
    }
  };

  const save = async () => {
    setError('');
    const product = products.find((p) => p.id === productId);
    if (!product) {
      setError(t('batch.needProduct'));
      return;
    }
    if (!(Number(quantity) > 0)) {
      setError(t('batch.needQuantity'));
      return;
    }
    const zone = locations.find((l) => l.id === locationId);
    setSaving(true);
    try {
      await base44.entities.StockBatch.create(
        withBusiness(
          {
            product_id: product.id,
            product_name: product.name,
            sku: product.sku || '',
            location_id: zone?.id || '',
            location_name: zone?.name || '',
            quantity: Number(quantity),
            expires_on: expiresOn || null,
            note: note.trim(),
          },
          activeId
        )
      );
      onOpenChange(false);
      onSaved(t('batch.saved', { name: product.name }));
    } catch (e) {
      setError(e.message || t('batch.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('batch.newTitle')}</DialogTitle>
          <DialogDescription>{t('batch.dialogIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('batch.productLabel')}</Label>
            <Select value={productId} onValueChange={pickProduct}>
              <SelectTrigger><SelectValue placeholder={t('batch.productPick')} /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('batch.quantityLabel')}</Label>
              <Input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('batch.locationLabel')}</Label>
              <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('batch.locationNone')}</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('batch.expiresLabel')}</Label>
              <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('batch.noteLabel')}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('recipes.cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('batch.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
