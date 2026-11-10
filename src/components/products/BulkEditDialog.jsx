import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const UNCHANGED = 'unchanged';

const empty = {
  category: '',
  subcategory: '',
  status: '',
  condition: '',
  add: '',
  remove: '',
  price: '',
  cost: '',
  reorder: '',
};

const parseList = (value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** A blank box means "leave this number alone"; anything else is applied as typed. */
const toNumber = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

function ChoiceField({ label, value, options, onChange }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Select value={value || UNCHANGED} onValueChange={(v) => onChange(v === UNCHANGED ? '' : v)}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNCHANGED}>{t('products.leaveUnchanged')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Applies one set of catalog changes to products chosen from the filtered list. */
export default function BulkEditDialog({
  open,
  onOpenChange,
  products = [],
  categories = [],
  subcategories = [],
  tags = [],
  onDone,
}) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const STATUS_OPTIONS = [
    { value: 'active', label: t('products.statusActive') },
    { value: 'draft', label: t('products.statusDraft') },
    { value: 'archived', label: t('products.statusArchived') },
    { value: 'discontinued', label: t('products.statusDiscontinued') },
  ];

  const CONDITION_OPTIONS = [
    { value: 'New', label: t('products.conditionNew') },
    { value: 'Like new', label: t('products.conditionLikeNew') },
    { value: 'Very good', label: t('products.conditionVeryGood') },
    { value: 'Good', label: t('products.conditionGood') },
    { value: 'Acceptable', label: t('products.conditionAcceptable') },
  ];

  useEffect(() => {
    if (open) {
      setForm(empty);
      setError('');
    }
  }, [open]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const adds = parseList(form.add);
  const removes = parseList(form.remove);
  const changes = [];
  if (form.category.trim()) changes.push(t('products.bulkChangeCategory', { value: form.category.trim() }));
  if (form.subcategory.trim()) changes.push(t('products.bulkChangeSubcategory', { value: form.subcategory.trim() }));
  if (form.status) changes.push(t('products.bulkChangeStatus', { value: form.status }));
  if (form.condition) changes.push(t('products.bulkChangeCondition', { value: form.condition }));
  if (adds.length) changes.push(t('products.bulkChangeAddTags', { tags: adds.map((tag) => `#${tag}`).join(' ') }));
  if (removes.length) changes.push(t('products.bulkChangeRemoveTags', { tags: removes.map((tag) => `#${tag}`).join(' ') }));
  if (toNumber(form.price) !== null) changes.push(t('products.bulkChangePrice', { value: toNumber(form.price) }));
  if (toNumber(form.cost) !== null) changes.push(t('products.bulkChangeCost', { value: toNumber(form.cost) }));
  if (toNumber(form.reorder) !== null) changes.push(t('products.bulkChangeReorder', { value: toNumber(form.reorder) }));
  const hasChanges = changes.length > 0;

  const save = async () => {
    if (!hasChanges || !products.length) return;
    setSaving(true);
    setError('');
    try {
      const patch = {};
      if (form.category.trim()) patch.category = form.category.trim();
      if (form.subcategory.trim()) patch.subcategory = form.subcategory.trim();
      if (form.status) patch.status = form.status;
      if (form.condition) patch.condition = form.condition;
      if (toNumber(form.price) !== null) patch.price = toNumber(form.price);
      if (toNumber(form.cost) !== null) patch.cost = toNumber(form.cost);
      if (toNumber(form.reorder) !== null) patch.reorder_point = toNumber(form.reorder);

      const updates = products.map((product) => {
        const next = { id: product.id, ...patch };
        if (adds.length || removes.length) {
          const current = product.tags || [];
          const merged = [...current];
          adds.forEach((tag) => {
            if (!merged.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
              merged.push(tag);
            }
          });
          const dropped = new Set(removes.map((tag) => tag.toLowerCase()));
          next.tags = merged.filter((tag) => !dropped.has(tag.toLowerCase()));
        }
        return next;
      });

      await base44.entities.Product.bulkUpdate(updates);
      onOpenChange(false);
      onDone?.(products.length);
    } catch (err) {
      setError(err?.message || t('products.bulkUpdateFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('products.bulkTitle', { count: products.length })}</DialogTitle>
          <DialogDescription>
            {t('products.bulkDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="bulk-category">{t('products.bulkCategory')}</Label>
              <Input
                id="bulk-category"
                list="bulk-category-options"
                value={form.category}
                onChange={set('category')}
                placeholder={t('products.leaveUnchanged')}
              />
              <datalist id="bulk-category-options">
                {categories.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bulk-subcategory">{t('products.bulkSubcategory')}</Label>
              <Input
                id="bulk-subcategory"
                list="bulk-subcategory-options"
                value={form.subcategory}
                onChange={set('subcategory')}
                placeholder={t('products.leaveUnchanged')}
              />
              <datalist id="bulk-subcategory-options">
                {subcategories.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <ChoiceField
              label={t('products.bulkStatus')}
              value={form.status}
              options={STATUS_OPTIONS}
              onChange={(next) => setForm((current) => ({ ...current, status: next }))}
            />
            <ChoiceField
              label={t('products.bulkCondition')}
              value={form.condition}
              options={CONDITION_OPTIONS}
              onChange={(next) => setForm((current) => ({ ...current, condition: next }))}
            />
            <div className="grid gap-2">
              <Label htmlFor="bulk-add">{t('products.bulkAddTagsLabel')}</Label>
              <Input
                id="bulk-add"
                value={form.add}
                onChange={set('add')}
                placeholder="signed, gift"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bulk-remove">{t('products.bulkRemoveTagsLabel')}</Label>
              <Input
                id="bulk-remove"
                value={form.remove}
                onChange={set('remove')}
                placeholder="clearance"
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border border-border p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('products.bulkNumbers')}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="bulk-price">{t('products.bulkPrice')}</Label>
                <Input
                  id="bulk-price"
                  type="number"
                  inputMode="decimal"
                  value={form.price}
                  onChange={set('price')}
                  placeholder={t('products.leaveUnchanged')}
                  className="font-mono"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bulk-cost">{t('products.bulkCost')}</Label>
                <Input
                  id="bulk-cost"
                  type="number"
                  inputMode="decimal"
                  value={form.cost}
                  onChange={set('cost')}
                  placeholder={t('products.leaveUnchanged')}
                  className="font-mono"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bulk-reorder">{t('products.bulkReorder')}</Label>
                <Input
                  id="bulk-reorder"
                  type="number"
                  inputMode="numeric"
                  value={form.reorder}
                  onChange={set('reorder')}
                  placeholder={t('products.leaveUnchanged')}
                  className="font-mono"
                />
              </div>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t('products.bulkNumbersHint')}
            </p>
          </div>

          {tags.length > 0 && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t('products.bulkSavedTags', { tags: tags.join(', ') })}
            </p>
          )}

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t('products.bulkPreview')}
            </p>
            {hasChanges ? (
              <p className="mt-1 text-xs">
                {t('products.bulkPreviewLine', {
                  count: products.length,
                  plural: products.length === 1 ? '' : 's',
                  changes: changes.join(' · '),
                })}
              </p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('products.bulkPreviewEmpty')}
              </p>
            )}
            <p className="mt-2 line-clamp-3 text-[11px] text-muted-foreground">
              {products.map((product) => product.name).join(', ')}
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('products.cancel')}
          </Button>
          <Button onClick={save} disabled={!hasChanges || saving || !products.length}>
            {saving ? t('products.saving') : t('products.bulkUpdateButton', { count: products.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}