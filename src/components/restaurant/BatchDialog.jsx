import { useEffect, useState } from 'react';
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
import { t } from '@/lib/i18n';

/**
 * Run a batch (release 361, Nov 23, 2026): make a recipe a
 * number of times, and the server produces the recipe's
 * linked prep product at the chosen location and takes the
 * full recipe off the shelf, exactly like a sale does. Only
 * recipes linked to a product can run — there has to be
 * something to produce. Rides the restaurant.build tick.
 */
export default function BatchDialog({ open, onOpenChange, recipes, locations, onSaved }) {
  const { activeId } = useBusiness();
  const [recipeId, setRecipeId] = useState('');
  const [makes, setMakes] = useState(1);
  const [locationId, setLocationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const runnable = (recipes || []).filter((r) => r.product_id);

  useEffect(() => {
    if (!open) return;
    setRecipeId('');
    setMakes(1);
    setLocationId('');
    setError('');
  }, [open ]);

  const save = async () => {
    setError('');
    const recipe = runnable.find((r) => r.id === recipeId);
    if (!recipe) {
      setError(t('batch.runNeedRecipe'));
      return;
    }
    if (!(Number(makes) > 0)) {
      setError(t('batch.runNeedMakes'));
      return;
    }
    const zone = locations.find((l) => l.id === locationId);
    setSaving(true);
    try {
      await base44.entities.BatchRun.create(
        withBusiness(
          {
            recipe_id: recipe.id,
            recipe_name: recipe.name,
            product_id: recipe.product_id,
            product_name: recipe.product_name || '',
            makes: Number(makes),
            location_id: zone?.id || '',
            location_name: zone?.name || '',
          },
          activeId
        )
      );
      onOpenChange(false);
      onSaved(t('batch.runSaved', { name: recipe.name, count: Number(makes) }));
    } catch (e) {
      setError(e.message || t('batch.runSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('batch.runTitle')}</DialogTitle>
          <DialogDescription>{t('batch.runIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {runnable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('batch.runNoneReady')}</p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>{t('batch.runRecipeLabel')}</Label>
                <Select value={recipeId} onValueChange={setRecipeId}>
                  <SelectTrigger><SelectValue placeholder={t('batch.runRecipePick')} /></SelectTrigger>
                  <SelectContent>
                    {runnable.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t('batch.runMakesLabel')}</Label>
                  <Input type="number" min="0" step="any" value={makes} onChange={(e) => setMakes(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('batch.runLocationLabel')}</Label>
                  <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('batch.runLocationNone')}</SelectItem>
                      {locations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
          {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('recipes.cancel')}</Button>
          <Button onClick={save} disabled={saving || runnable.length === 0}>{saving ? t('recipes.saving') : t('batch.runSave')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
