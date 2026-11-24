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

/**
 * Record staff meals (release 361, Nov 23, 2026). Saving
 * writes the meal row; the server takes the dish off the
 * shelf with a staff-meal movement and depletes its active
 * recipe, the same as a sale — so a meal is never free stock
 * walking out uncounted. Open to any trusted member.
 */
export default function StaffMealDialog({ open, onOpenChange, products, locations, onSaved }) {
  const { activeId } = useBusiness();
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setProductId('');
    setQuantity(1);
    setLocationId('');
    setNote('');
    setError('');
  }, [open ]);

  const save = async () => {
    setError('');
    const product = products.find((p) => p.id === productId);
    if (!product) {
      setError(t('staffMeals.needProduct'));
      return;
    }
    if (!(Number(quantity) > 0)) {
      setError(t('staffMeals.needQuantity'));
      return;
    }
    const zone = locations.find((l) => l.id === locationId);
    setSaving(true);
    try {
      await base44.entities.StaffMeal.create(
        withBusiness(
          {
            product_id: product.id,
            product_name: product.name,
            quantity: Number(quantity),
            location_id: zone?.id || '',
            location_name: zone?.name || '',
            note: note.trim(),
          },
          activeId
        )
      );
      onOpenChange(false);
      onSaved(t('staffMeals.saved', { name: product.name, count: Number(quantity) }));
    } catch (e) {
      setError(e.message || t('staffMeals.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('staffMeals.newTitle')}</DialogTitle>
          <DialogDescription>{t('staffMeals.dialogIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('staffMeals.productLabel')}</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder={t('staffMeals.productPick')} /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('staffMeals.quantityLabel')}</Label>
              <Input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('staffMeals.locationLabel')}</Label>
              <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('staffMeals.locationNone')}</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{t('staffMeals.noteLabel')}</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
          {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('recipes.cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('staffMeals.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
