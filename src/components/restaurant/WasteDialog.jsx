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
import { WASTE_REASONS } from '@/lib/restaurantOps';
import { t } from '@/lib/i18n';

/**
 * One waste log entry (release 361, Nov 23, 2026). Logging
 * waste is a daily habit, so the door is open to any trusted
 * member — no tick. Saving writes the entry; the server
 * takes the stock out as a write-off tied to this entry and
 * snapshots the unit cost for the money holders.
 */
export default function WasteDialog({ open, onOpenChange, products, locations, onSaved }) {
  const { activeId } = useBusiness();
  const [productId, setProductId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('spoilage');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setProductId('');
    setLocationId('');
    setQuantity(1);
    setReason('spoilage');
    setNote('');
    setError('');
  }, [open ]);

  const save = async () => {
    setError('');
    const product = products.find((p) => p.id === productId);
    if (!product) {
      setError(t('ops.waste.needProduct'));
      return;
    }
    if (!(Number(quantity) > 0)) {
      setError(t('ops.waste.needQuantity'));
      return;
    }
    const zone = locations.find((l) => l.id === locationId);
    setSaving(true);
    try {
      await base44.entities.WasteEntry.create(
        withBusiness(
          {
            product_id: product.id,
            product_name: product.name,
            sku: product.sku || '',
            location_id: zone?.id || '',
            location_name: zone?.name || '',
            quantity: Number(quantity),
            reason,
            note: note.trim(),
          },
          activeId
        )
      );
      onOpenChange(false);
      onSaved(t('ops.waste.saved', { name: product.name }));
    } catch (e) {
      setError(e.message || t('ops.waste.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('ops.waste.newTitle')}</DialogTitle>
          <DialogDescription>{t('ops.waste.dialogIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('ops.waste.productLabel')}</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder={t('ops.waste.productPick')} /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('ops.waste.quantityLabel')}</Label>
              <Input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.waste.reasonLabel')}</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WASTE_REASONS.map((code) => (
                    <SelectItem key={code} value={code}>{t(`ops.waste.reason.${code}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.waste.locationLabel')}</Label>
              <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('ops.waste.locationNone')}</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('ops.waste.noteLabel')}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('recipes.cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('ops.waste.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
