import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Button } from '@/components/ui/button';
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

/**
 * Put one item on the 86 board (release 361, Nov 23, 2026):
 * it is out, for now, at one location or everywhere. Open to
 * any trusted member — the board only helps if anyone on the
 * line can post to it.
 */
export default function EightySixDialog({ open, onOpenChange, products, locations, onSaved }) {
  const { activeId } = useBusiness();
  const [productId, setProductId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setProductId('');
    setLocationId('');
    setNote('');
    setError('');
  }, [open ]);

  const save = async () => {
    setError('');
    const product = products.find((p) => p.id === productId);
    if (!product) {
      setError(t('ops.eightySix.needProduct'));
      return;
    }
    const zone = locations.find((l) => l.id === locationId);
    setSaving(true);
    try {
      await base44.entities.EightySixItem.create(
        withBusiness(
          {
            product_id: product.id,
            product_name: product.name,
            location_id: zone?.id || '',
            location_name: zone?.name || '',
            note: note.trim(),
            active: true,
          },
          activeId
        )
      );
      onOpenChange(false);
      onSaved(t('ops.eightySix.saved', { name: product.name }));
    } catch (e) {
      setError(e.message || t('ops.eightySix.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('ops.eightySix.newTitle')}</DialogTitle>
          <DialogDescription>{t('ops.eightySix.dialogIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('ops.eightySix.productLabel')}</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder={t('ops.eightySix.productPick')} /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('ops.eightySix.locationLabel')}</Label>
            <Select value={locationId || 'all'} onValueChange={(v) => setLocationId(v === 'all' ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('ops.eightySix.locationAll')}</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('ops.eightySix.noteLabel')}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('recipes.cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('ops.eightySix.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
