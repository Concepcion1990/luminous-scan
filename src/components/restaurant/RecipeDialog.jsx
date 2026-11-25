import { useEffect, useRef, useState } from 'react';
import { FileUp, ImagePlus, Plus, Trash2 } from 'lucide-react';
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
import { parseRecipeUpload, parseUnitConversions } from '@/lib/recipes';
import { t } from '@/lib/i18n';

const EMPTY_LINE = { kind: 'product', ref: '', quantity: 1, yield_pct: 100, unit: '' };

function lineFromStored(line) {
  if (line.kind === 'recipe') {
    return { kind: 'recipe', ref: line.recipe_id || '', quantity: line.quantity ?? 1, yield_pct: 100, unit: '' };
  }
  return {
    kind: 'product',
    ref: line.product_id || '',
    quantity: line.quantity ?? 1,
    yield_pct: line.yield_pct ?? 100,
    unit: line.unit || '',
  };
}

/**
 * The recipe editor (release 359, Nov 23, 2026). A recipe is
 * built by typing its lines, or brought in through the upload
 * door below (the app's import pattern: match what can be
 * matched, name what cannot). Lines are existing inventory
 * products — or another recipe, used whole as an ingredient.
 * The dish link is optional: a recipe can exist before its
 * dish is sold anywhere; only an ACTIVE recipe linked to a
 * product depletes stock when that product is sold.
 */
export default function RecipeDialog({ open, onOpenChange, recipe, recipes, products, locations, onSaved }) {
  const { activeId } = useBusiness();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [productId, setProductId] = useState('');
  const [status, setStatus] = useState('draft');
  const [yieldQty, setYieldQty] = useState(1);
  const [qFactor, setQFactor] = useState(0);
  const [locationId, setLocationId] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef(null);
  const recipeFileRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setName(recipe?.name || '');
    setDescription(recipe?.description || '');
    setProductId(recipe?.product_id || '');
    setStatus(recipe?.status === 'active' ? 'active' : 'draft');
    setYieldQty(recipe?.yield_qty ?? 1);
    setQFactor(recipe?.q_factor_pct ?? 0);
    setLocationId(recipe?.location_id || '');
    setPhotoUrl(recipe?.photo_url || '');
    setLines(
      recipe?.lines?.length ? recipe.lines.map(lineFromStored) : [{ ...EMPTY_LINE }]
    );
    setError('');
    setNote('');
  }, [open, recipe]);

  const setLine = (index, patch) =>
    setLines((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const addPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      setError(t('recipes.photoNotImage'));
      return;
    }
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadPublicFile({ file });
      if (file_url) setPhotoUrl(file_url);
    } catch {
      setError(t('recipes.photoFailed'));
    } finally {
      setUploading(false);
    }
  };

  const addRecipeFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // The universal upload rule (owner ruling, Nov 23, 2026): this
    // door takes files up to 25 MB — and says so plainly past it,
    // before a byte is read (the importer's own wording).
    if (file.size > 25 * 1024 * 1024) {
      setError(t('import.fileTooLarge'));
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseRecipeUpload(text, products);
      if (parsed.lines.length) {
        setLines((rows) => {
          const kept = rows.filter((row) => row.ref);
          return [...kept, ...parsed.lines.map((line) => ({
            kind: 'product',
            ref: line.product_id,
            quantity: line.quantity,
            yield_pct: line.yield_pct,
            unit: line.unit || '',
          }))];
        });
      }
      const parts = [];
      if (parsed.lines.length) parts.push(t('recipes.uploadMatched', { count: parsed.lines.length }));
      if (parsed.unmatched.length) {
        parts.push(t('recipes.uploadUnmatched', { rows: parsed.unmatched.join(' · ') }));
      }
      if (!parts.length) parts.push(t('recipes.uploadEmpty'));
      setNote(parts.join(' '));
    } catch {
      setError(t('recipes.uploadFailed'));
    }
  };

  const save = async () => {
    setError('');
    if (!name.trim()) {
      setError(t('recipes.needName'));
      return;
    }
    if (!(Number(yieldQty) > 0)) {
      setError(t('recipes.needYield'));
      return;
    }
    const clean = [];
    for (const line of lines) {
      if (!line.ref) continue;
      if (!(Number(line.quantity) > 0)) {
        setError(t('recipes.needQuantity'));
        return;
      }
      if (line.kind === 'recipe') {
        const sub = recipes.find((r) => r.id === line.ref);
        if (!sub) continue;
        if (recipe && sub.id === recipe.id) {
          setError(t('recipes.selfIngredient'));
          return;
        }
        clean.push({ kind: 'recipe', recipe_id: sub.id, recipe_name: sub.name, quantity: Number(line.quantity) });
      } else {
        const product = products.find((p) => p.id === line.ref);
        if (!product) continue;
        if (productId && product.id === productId) {
          setError(t('recipes.ownDishIngredient'));
          return;
        }
        clean.push({
          kind: 'product',
          product_id: product.id,
          product_name: product.name,
          sku: product.sku || '',
          unit: line.unit || product.unit || 'each',
          quantity: Number(line.quantity),
          yield_pct: Math.min(Math.max(Number(line.yield_pct) || 100, 1), 100),
        });
      }
    }
    if (!clean.length) {
      setError(t('recipes.needLine'));
      return;
    }
    const dish = products.find((p) => p.id === productId);
    const zone = locations.find((l) => l.id === locationId);
    setSaving(true);
    try {
      const values = withBusiness(
        {
          name: name.trim(),
          description: description.trim(),
          product_id: dish?.id || '',
          product_name: dish?.name || '',
          status,
          yield_qty: Number(yieldQty),
          q_factor_pct: Math.min(Math.max(Number(qFactor) || 0, 0), 100),
          photo_url: photoUrl,
          location_id: zone?.id || '',
          location_name: zone?.name || '',
          lines: clean,
        },
        activeId
      );
      if (recipe) await base44.entities.Recipe.update(recipe.id, values);
      else await base44.entities.Recipe.create(values);
      onOpenChange(false);
      onSaved(recipe ? t('recipes.saved', { name: name.trim() }) : t('recipes.created', { name: name.trim() }));
    } catch (e) {
      setError(e.message || t('recipes.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const otherRecipes = recipes.filter((r) => r.id !== recipe?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{recipe ? t('recipes.editTitle') : t('recipes.newTitle')}</DialogTitle>
          <DialogDescription>{t('recipes.dialogIntro')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('recipes.nameLabel')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('recipes.namePlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('recipes.dishLabel')}</Label>
              <Select value={productId || 'none'} onValueChange={(v) => setProductId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('recipes.dishNone')}</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('recipes.descriptionLabel')}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>{t('recipes.statusLabel')}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">{t('recipes.statusDraft')}</SelectItem>
                  <SelectItem value="active">{t('recipes.statusActive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('recipes.yieldLabel')}</Label>
              <Input type="number" min="0" step="any" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('recipes.qLabel')}</Label>
              <Input type="number" min="0" max="100" step="any" value={qFactor} onChange={(e) => setQFactor(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('recipes.zoneLabel')}</Label>
              <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('recipes.zoneNone')}</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('recipes.statusHint')}</p>

          <div className="flex items-center gap-3">
            {photoUrl ? <img src={photoUrl} alt="" className="h-12 w-12 rounded object-cover" /> : null}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={addPhoto} />
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <ImagePlus className="mr-1.5 h-4 w-4" /> {photoUrl ? t('recipes.photoChange') : t('recipes.photoAdd')}
            </Button>
            {photoUrl ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setPhotoUrl('')}>
                {t('recipes.photoRemove')}
              </Button>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>{t('recipes.linesLabel')}</Label>
              <div className="flex gap-2">
                <input ref={recipeFileRef} type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={addRecipeFile} />
                <Button type="button" variant="outline" size="sm" onClick={() => recipeFileRef.current?.click()}>
                  <FileUp className="mr-1.5 h-4 w-4" /> {t('recipes.uploadButton')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((rows) => [...rows, { ...EMPTY_LINE }])}>
                  <Plus className="mr-1.5 h-4 w-4" /> {t('recipes.addLine')}
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('recipes.uploadHint')}</p>
            {note ? <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">{note}</p> : null}
            {lines.map((line, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1 space-y-1">
                  <Select
                    value={line.ref ? `${line.kind}:${line.ref}` : ''}
                    onValueChange={(v) => {
                      const [kind, ref] = v.split(':');
                      setLine(index, { kind, ref });
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder={t('recipes.linePick')} /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={`p-${p.id}`} value={`product:${p.id}`}>
                          {p.name}{p.unit ? ` (${p.unit})` : ''}
                        </SelectItem>
                      ))}
                      {otherRecipes.map((r) => (
                        <SelectItem key={`r-${r.id}`} value={`recipe:${r.id}`}>
                          {t('recipes.lineRecipePrefix', { name: r.name })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-[11px]">{t('recipes.lineQty')}</Label>
                  <Input type="number" min="0" step="any" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} />
                </div>
                {line.kind === 'product' ? (
                  <div className="w-24 space-y-1">
                    <Label className="text-[11px]">{t('recipes.lineYield')}</Label>
                    <Input type="number" min="1" max="100" step="any" value={line.yield_pct} onChange={(e) => setLine(index, { yield_pct: e.target.value })} />
                  </div>
                ) : null}
                {line.kind === 'product' && line.ref ? (() => {
                  const lineProduct = products.find((p) => p.id === line.ref);
                  if (!lineProduct) return null;
                  const stockUnit = lineProduct.unit || 'each';
                  const units = [stockUnit, ...parseUnitConversions(lineProduct).map((c) => c.unit).filter((u) => u && u !== stockUnit)];
                  if (units.length < 2) return null;
                  return (
                    <div className="w-24 space-y-1">
                      <Label className="text-[11px]">{t('recipes.lineUnit')}</Label>
                      <Select value={line.unit || stockUnit} onValueChange={(v) => setLine(index, { unit: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {units.map((unit) => (
                            <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })() : null}
                <Button type="button" variant="ghost" size="icon" onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">{t('recipes.yieldHint')}</p>
          </div>

          {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('recipes.cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('recipes.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
