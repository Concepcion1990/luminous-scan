import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
import { ALLERGENS, parseAllergens } from '@/lib/restaurantOps';
import { parseUnitConversions } from '@/lib/recipes';
import { t } from '@/lib/i18n';

/**
 * A product's kitchen facts (release 361, Nov 23, 2026): its
 * allergens, the units a recipe line may be written in (each
 * conversion says how many of that unit make ONE stock
 * unit), and its shelf life in days — the expiry page's
 * starting date when a batch is received. One editor, used
 * from the Allergens page and the Restaurant hub; rides the
 * restaurant.build tick, which the pages check before
 * offering it.
 */
export default function ProductKitchenDialog({ open, onOpenChange, product, onSaved }) {
  const [allergens, setAllergens] = useState([]);
  const [conversions, setConversions] = useState([]);
  const [shelfLife, setShelfLife] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !product) return;
    setAllergens(parseAllergens(product));
    setConversions(parseUnitConversions(product).map((c) => ({ unit: c.unit || '', per: c.per ?? '' })));
    setShelfLife(product.shelf_life_days ?? '');
    setError('');
  }, [open, product]);

  if (!product) return null;

  const toggleAllergen = (key) =>
    setAllergens((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  const setConversion = (index, patch) =>
    setConversions((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    setError('');
    const clean = [];
    for (const row of conversions) {
      if (!row.unit.trim()) continue;
      if (!(Number(row.per) > 0)) {
        setError(t('units.needPer'));
        return;
      }
      if (row.unit.trim() === product.unit) {
        setError(t('units.stockUnitRow'));
        return;
      }
      clean.push({ unit: row.unit.trim(), per: Number(row.per) });
    }
    setSaving(true);
    try {
      await base44.entities.Product.update(product.id, {
        allergens,
        unit_conversions: clean,
        shelf_life_days: shelfLife === '' ? null : Number(shelfLife),
      });
      onOpenChange(false);
      onSaved(t('allergens.saved', { name: product.name }));
    } catch (e) {
      setError(e.message || t('allergens.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('allergens.editTitle', { name: product.name })}</DialogTitle>
          <DialogDescription>{t('allergens.dialogIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>{t('allergens.allergensLabel')}</Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {ALLERGENS.map((key) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={allergens.includes(key)}
                    onChange={() => toggleAllergen(key)}
                    className="h-4 w-4"
                  />
                  {t(`allergens.${key}`)}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>{t('units.title')}</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setConversions((rows) => [...rows, { unit: '', per: '' }])}>
                <Plus className="mr-1.5 h-4 w-4" /> {t('units.addButton')}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('units.hint', { unit: product.unit || 'each' })}
            </p>
            {conversions.map((row, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="w-28">
                  <Label className="text-[11px]">{t('units.unitLabel')}</Label>
                  <Input value={row.unit} onChange={(e) => setConversion(index, { unit: e.target.value })} placeholder={t('units.unitPlaceholder')} />
                </div>
                <div className="w-32">
                  <Label className="text-[11px]">{t('units.perLabel', { unit: product.unit || 'each' })}</Label>
                  <Input type="number" min="0" step="any" value={row.per} onChange={(e) => setConversion(index, { per: e.target.value })} />
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => setConversions((rows) => rows.filter((_, i) => i !== index))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>{t('batch.shelfLifeLabel')}</Label>
            <Input type="number" min="0" step="1" value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">{t('batch.shelfLifeHint')}</p>
          </div>

          {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('recipes.cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('allergens.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
