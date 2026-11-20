import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Trash2 } from 'lucide-react';
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
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';
import { recordMovement } from '@/lib/inventory';
import { judgeVocabularyValue } from '@/lib/vocabulary';
import AddVocabularyDialog from './AddVocabularyDialog';
import VocabularyCombobox from './VocabularyCombobox';

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
  quantity: '',
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
  businessId = '',
  products = [],
  categories = [],
  subcategories = [],
  tags = [],
  locations = [],
  levels = [],
  planKey = '',
  canDelete = false,
  onDone,
}) {
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Bulk delete (owner ruling, Nov 15, 2026): a red danger zone at
  // the very bottom of this dialog, boss-only like the row menu's
  // Delete (the caller passes canDelete from isBoss). It never
  // deletes on one tap — a confirmation window names the exact
  // count and asks once more before anything goes.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Category/subcategory pickers (owner ruling, Nov 15, 2026): the
  // same app-rendered combobox + Add-new window as the product form.
  // The native <datalist> these fields used before never surfaces
  // inside a modal on Android Chrome, so there was no way to add
  // 'Books' from bulk edit at all. Names born through the Add window
  // are sanctioned for the save guard immediately.
  const [addNewField, setAddNewField] = useState(null);
  // Bulk quantity (owner ruling, Nov 15, 2026): set every selected
  // product to one on-hand number at one location. The picker is
  // preselected — the remembered location wins, else the first
  // location — so it never opens empty where an answer exists.
  const [quantityLocationId, setQuantityLocationId] = useState('');
  const [addedNames, setAddedNames] = useState({ category: [], subcategory: [] });
  const categoryOptions = [...categories, ...addedNames.category.filter((n) => !categories.includes(n))];
  const subcategoryOptions = [
    ...subcategories,
    ...addedNames.subcategory.filter((n) => !subcategories.includes(n)),
  ];

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
      setConfirmDelete(false);
      setDeleting(false);
      setAddNewField(null);
      setAddedNames({ category: [], subcategory: [] });
      let remembered = null;
      try {
        remembered = localStorage.getItem('stockroom.location');
      } catch {
        remembered = null;
      }
      setQuantityLocationId(
        locations.find((l) => l.id === remembered)?.id || locations[0]?.id || '',
      );
    }
  }, [open]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setValue = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));

  // A category/subcategory born through the picker's "Add new" row:
  // select it, sanction it for the save guard, close the window.
  const handleVocabularyCreated = (field, name) => {
    setValue(field)(name);
    setAddedNames((prev) => ({ ...prev, [field]: [...prev[field], name] }));
    setAddNewField(null);
  };

  const adds = parseList(form.add);
  const removes = parseList(form.remove);

  // Quantity target: blank leaves stock alone; anything typed must
  // be a whole number within the app's quantity cap (200,000 — the
  // same cap the stock door enforces). SET semantics: every
  // selected product ends at this number, at the chosen location.
  const quantityRaw = form.quantity.trim();
  const quantityTarget = /^\d+$/.test(quantityRaw) ? Number(quantityRaw) : null;
  const quantityInvalid = quantityRaw !== '' && quantityTarget === null;
  const quantityTooBig = quantityTarget !== null && quantityTarget > 200000;
  const quantityLocation = locations.find((l) => l.id === quantityLocationId) || null;
  const quantityEligible = products.filter((p) => (p.status || 'active') !== 'archived').length;
  const quantityApplies =
    quantityTarget !== null && !quantityTooBig && Boolean(quantityLocation) && quantityEligible > 0;

  const changes = [];
  if (quantityApplies) {
    changes.push(
      t('products.bulkChangeQuantity', {
        count: quantityEligible,
        plural: quantityEligible === 1 ? '' : 's',
        quantity: quantityTarget,
        location: quantityLocation.name,
      }),
    );
  }
  if (form.category.trim()) changes.push(t('products.bulkChangeCategory', { value: form.category.trim() }));
  if (form.subcategory.trim()) changes.push(t('products.bulkChangeSubcategory', { value: form.subcategory.trim() }));
  if (form.status) changes.push(t('products.bulkChangeStatus', { value: form.status }));
  if (form.condition) changes.push(t('products.bulkChangeCondition', { value: form.condition }));
  if (adds.length) changes.push(t('products.bulkChangeAddTags', { tags: adds.map((tag) => `#${tag}`).join(' ') }));
  if (removes.length) changes.push(t('products.bulkChangeRemoveTags', { tags: removes.map((tag) => `#${tag}`).join(' ') }));
  if (toNumber(form.price) !== null) changes.push(t('products.bulkChangePrice', { value: toNumber(form.price) }));
  if (toNumber(form.cost) !== null) changes.push(t('products.bulkChangeCost', { value: toNumber(form.cost) }));
  if (toNumber(form.reorder) !== null) changes.push(t('products.bulkChangeReorder', { value: toNumber(form.reorder) }));
  // A typed quantity counts as a change even before it validates,
  // so Save stays reachable and its refusal can name the problem.
  const hasChanges = changes.length > 0 || quantityRaw !== '';

  const save = async () => {
    if (!hasChanges || !products.length) return;
    // No silent category births — the same guard as the product
    // form (owner ruling, Nov 14, 2026, applied here Nov 15): a
    // typed-but-unlisted category or subcategory stops the save
    // with the plain message; the Add row/window is the only birth
    // door. Blank stays "leave unchanged" and is never judged.
    const categoryVerdict = judgeVocabularyValue({
      typedRaw: form.category,
      initial: '',
      options: categoryOptions,
      sanctioned: addedNames.category,
      loaded: true,
    });
    if (!categoryVerdict.ok) {
      setError(t('productForm.categoryNotFound'));
      return;
    }
    const subcategoryVerdict = judgeVocabularyValue({
      typedRaw: form.subcategory,
      initial: '',
      options: subcategoryOptions,
      sanctioned: addedNames.subcategory,
      loaded: true,
    });
    if (!subcategoryVerdict.ok) {
      setError(t('productForm.subcategoryNotFound'));
      return;
    }
    // Quantity validation (owner ruling, Nov 15, 2026): a typed
    // quantity must be a whole number within the cap, and it needs
    // its location — the refusal names the problem, never a shrug.
    if (quantityInvalid) {
      setError(t('productForm.quantityInvalid'));
      return;
    }
    if (quantityTooBig) {
      setError(t('products.bulkQuantityTooBig'));
      return;
    }
    if (quantityTarget !== null && !quantityLocation) {
      setError(t('products.bulkQuantityNoLocations'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const patch = {};
      if (categoryVerdict.value) patch.category = categoryVerdict.value;
      if (subcategoryVerdict.value) patch.subcategory = subcategoryVerdict.value;
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

      const hasCatalogChanges =
        Object.keys(patch).length > 0 || adds.length > 0 || removes.length > 0;
      if (hasCatalogChanges) {
        await base44.entities.Product.bulkUpdate(updates);
      }

      // Bulk quantity, with the Edit form's discipline (owner
      // ruling, Nov 15, 2026): NEVER a silent overwrite. Each
      // product whose count at the chosen location actually changes
      // records ONE ledger movement — 'receive' of the difference
      // up, 'correction' landing exactly on the target down —
      // noting the bulk edit. Products already at the target record
      // nothing. Archived products are skipped (their stock is
      // frozen) and counted for the result banner.
      let quantitySummary = null;
      if (quantityTarget !== null && quantityLocation) {
        let set = 0;
        let movements = 0;
        let skipped = 0;
        for (const product of products) {
          if ((product.status || 'active') === 'archived') {
            skipped += 1;
            continue;
          }
          const current =
            levels.find(
              (l) => l.product_id === product.id && l.location_id === quantityLocation.id,
            )?.quantity ?? 0;
          if (current === quantityTarget) {
            set += 1;
            continue;
          }
          if (quantityTarget > current) {
            await recordMovement({
              product,
              location: quantityLocation,
              type: 'receive',
              quantity: quantityTarget - current,
              note: t('products.bulkQuantityNote'),
              businessId,
            });
          } else {
            await recordMovement({
              product,
              location: quantityLocation,
              type: 'correction',
              quantity: quantityTarget,
              note: t('products.bulkQuantityNote'),
              businessId,
            });
          }
          movements += 1;
          set += 1;
        }
        quantitySummary = {
          set,
          movements,
          skipped,
          quantity: quantityTarget,
          location: quantityLocation.name,
        };
      }

      onOpenChange(false);
      onDone?.({ count: products.length, quantity: quantitySummary });
    } catch (err) {
      setError(err?.message || t('products.bulkUpdateFailed'));
    } finally {
      setSaving(false);
    }
  };

  // Bulk delete, through the single delete's exact semantics: every
  // selected product — copies and archived products included, since
  // deleting is how an archived product leaves and a true delete is
  // the only way the plan count goes down — goes through the entity
  // delete (the server enforces access and the products.edit
  // permission), then its stock levels are cleared the same way the
  // row delete clears them. A product counts as deleted when its
  // row is gone; the level cleanup is belt-and-braces over the
  // database cascade. Failures are named in the result, never
  // hidden behind an all-clear.
  const deleteSelected = async () => {
    if (!canDelete || !products.length || deleting) return;
    setDeleting(true);
    let deleted = 0;
    const failed = [];
    for (const product of products) {
      try {
        await base44.entities.Product.delete(product.id);
        deleted += 1;
        const own = levels.filter((l) => l.product_id === product.id);
        if (own.length) {
          try {
            await base44.entities.StockLevel.deleteMany({ product_id: product.id });
          } catch {
            /* the product row is gone; its levels cascade with it */
          }
        }
      } catch {
        failed.push(product.name);
      }
    }
    setDeleting(false);
    setConfirmDelete(false);
    onOpenChange(false);
    onDone?.({ deleted: { count: deleted, failed } });
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
              <VocabularyCombobox
                id="bulk-category"
                value={form.category}
                onChange={setValue('category')}
                options={categoryOptions}
                placeholder={t('products.leaveUnchanged')}
                label={t('products.bulkCategory')}
                addNewLabel={t('productForm.addNewCategory')}
                onAddNewRequest={() => setAddNewField('category')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bulk-subcategory">{t('products.bulkSubcategory')}</Label>
              <VocabularyCombobox
                id="bulk-subcategory"
                value={form.subcategory}
                onChange={setValue('subcategory')}
                options={subcategoryOptions}
                placeholder={t('products.leaveUnchanged')}
                label={t('products.bulkSubcategory')}
                addNewLabel={t('productForm.addNewSubcategory')}
                onAddNewRequest={() => setAddNewField('subcategory')}
              />
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
                placeholder={t('products.bulkTagsPlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="bulk-remove">{t('products.bulkRemoveTagsLabel')}</Label>
              <Input
                id="bulk-remove"
                value={form.remove}
                onChange={set('remove')}
                placeholder={planKey === 'business' ? t('products.bulkTagExampleBusiness') : t('products.bulkTagExampleEssentials')}
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
            <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="bulk-quantity">{t('products.bulkQuantityLabel')}</Label>
                <Input
                  id="bulk-quantity"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="200000"
                  value={form.quantity}
                  onChange={set('quantity')}
                  placeholder={t('products.leaveUnchanged')}
                  className="font-mono"
                  disabled={locations.length === 0}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bulk-quantity-location">{t('products.bulkQuantityLocation')}</Label>
                <Select
                  value={quantityLocationId}
                  onValueChange={setQuantityLocationId}
                  disabled={locations.length === 0}
                >
                  <SelectTrigger id="bulk-quantity-location" aria-label={t('products.bulkQuantityLocation')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {locations.length === 0 ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t('products.bulkQuantityNoLocations')}{' '}
                <Link to="/locations" className="font-medium text-primary underline">
                  {t('products.bulkQuantityAddLocation')}
                </Link>
              </p>
            ) : (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t('products.bulkQuantityHint')}
              </p>
            )}
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

        {/* Danger zone — the very bottom of the dialog (owner
            ruling, Nov 15, 2026): below even the footer, in red,
            with the warning in plain words and a button that names
            the live selection. Boss-only, like the row menu's
            Delete; it opens the confirmation window, never a
            delete. */}
        {canDelete && products.length > 0 && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3">
            <p className="text-sm font-semibold text-destructive">
              {t('products.bulkDeleteTitle')}
            </p>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {t('products.bulkDeleteWarning')}
            </p>
            <Button
              variant="destructive"
              className="mt-3 w-full sm:w-auto"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || deleting}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {t('products.bulkDeleteButton', {
                count: products.length,
                plural: products.length === 1 ? '' : 's',
              })}
            </Button>
          </div>
        )}
      </DialogContent>

      {/* Bulk-delete confirmation — a real Radix Dialog nested
          over this one, the same construction as the Add-new
          window below (Nov 20, 2026). It used to be a hand-rolled
          fixed overlay mounted here, OUTSIDE the host dialog's
          content layer: the host's modal machinery switched
          pointer events off for everything outside its own
          content and kept focus for itself, so on the owner's
          phone the window painted but its Cancel/Yes took no taps
          at all and the dialog behind it still scrolled — the
          same dead-button freeze as the Add window, reproduced
          tap-by-tap in the harness before this fix. As a nested
          dialog the window holds focus, answers taps, and keeps
          the scroll lock. It names the exact count, says plainly
          that this cannot be undone, and its only road forward is
          the red Yes button; Cancel (or Escape, or the backdrop)
          deletes nothing — and while a delete is running the
          window cannot be dismissed at all. */}
      {confirmDelete && (
        <DialogPrimitive.Root
          open
          onOpenChange={(next) => {
            if (!next && !deleting) setConfirmDelete(false);
          }}
        >
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content
              className="fixed left-[50%] top-[50%] z-[80] w-[calc(100vw-2rem)] max-w-sm translate-x-[-50%] translate-y-[-50%] space-y-3 rounded-xl bg-card p-4 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            >
              <DialogPrimitive.Title className="text-sm font-semibold text-destructive">
                {t('products.bulkDeleteConfirmTitle', {
                  count: products.length,
                  plural: products.length === 1 ? '' : 's',
                })}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs leading-snug text-muted-foreground">
                {t('products.bulkDeleteConfirmBody', {
                  count: products.length,
                  plural: products.length === 1 ? '' : 's',
                })}
              </DialogPrimitive.Description>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                >
                  {t('products.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={deleteSelected}
                  disabled={deleting}
                >
                  {deleting
                    ? t('products.bulkDeleting')
                    : t('products.bulkDeleteConfirmButton', {
                        count: products.length,
                        plural: products.length === 1 ? '' : 's',
                      })}
                </Button>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}

      {/* Add-new vocabulary window — the same nested Radix dialog
          as the product form: the bulk dialog behind it does not
          move, the name field arrives prefilled with the picker's
          typed text, Save creates the entry and selects it, Cancel
          creates nothing. */}
      {addNewField && (
        <AddVocabularyDialog
          businessId={businessId}
          kind={addNewField}
          initialName={addNewField === 'category' ? form.category : form.subcategory}
          existingNames={addNewField === 'category' ? categoryOptions : subcategoryOptions}
          title={t(
            addNewField === 'category' ? 'productForm.addNewCategory' : 'productForm.addNewSubcategory',
          )}
          onCreated={(name) => handleVocabularyCreated(addNewField, name)}
          onCancel={() => setAddNewField(null)}
        />
      )}
    </Dialog>
  );
}