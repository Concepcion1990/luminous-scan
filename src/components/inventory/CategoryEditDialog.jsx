import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { base44 } from '@/api/client';
import { judgeVocabularyValue } from '@/lib/vocabulary';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import VocabularyCombobox from '@/components/products/VocabularyCombobox';
import AddVocabularyDialog from '@/components/products/AddVocabularyDialog';

/**
 * The category edit door on Inventory by category (owner ask,
 * Nov 14, 2026): somebody forgot to file a product — they fix it
 * HERE, on the page where they noticed, instead of leaving for
 * Products. A small overlay window (the form behind it never
 * moves) holding the SAME VocabularyCombobox the product form
 * uses, Add-new window included, and the same save judge: typed
 * text that matches nothing is refused in plain words, never
 * silently born. Saving writes the product's category through the
 * entity client — which announces on the freshness bus centrally —
 * and the caller reloads so the row re-files under its new group
 * immediately. Clearing the field files the product under
 * Uncategorized.
 *
 * Since Nov 20, 2026 (release 328) the window is a real Radix
 * Dialog on the Add window's construction, not a hand-rolled
 * fixed overlay. The hand-rolled window painted and its buttons
 * answered, but it had no focus trap and no scroll lock — focus
 * stayed on the door that opened it and the page behind it still
 * scrolled — and its Add-new door misbehaved under real taps.
 * As a real dialog the window holds focus, locks the page
 * behind it, and the Add window nests over it exactly as it
 * does over Bulk edit. Same props API, same strings, same save
 * path; Escape and the backdrop now also cancel (discarding
 * nothing, like Cancel), and the window cannot be dismissed
 * while a save is running.
 */
export default function CategoryEditDialog({ product, businessId, vocabulary, onSaved, onCancel }) {
  const [value, setValue] = useState(product.category || '');
  const [addedNames, setAddedNames] = useState([]);
  const [addNewOpen, setAddNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const verdict = judgeVocabularyValue({
      typedRaw: value,
      initial: product.category || '',
      options: vocabulary.categories,
      sanctioned: addedNames,
      loaded: vocabulary.loaded,
    });
    if (!verdict.ok) {
      setError(t('productForm.categoryNotFound'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await base44.entities.Product.update(product.id, { category: verdict.value });
      onSaved?.();
    } catch {
      setError(t('inventory.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next && !busy) onCancel?.();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-[50%] top-[50%] z-[70] w-[calc(100vw-2rem)] max-w-sm translate-x-[-50%] translate-y-[-50%] space-y-3 rounded-xl bg-card p-4 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div>
            <DialogPrimitive.Title className="text-sm font-semibold">
              {product.category ? t('inventory.changeCategory') : t('inventory.setCategory')}
            </DialogPrimitive.Title>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{product.name}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="category-edit">{t('productForm.categoryLabel')}</Label>
            <VocabularyCombobox
              id="category-edit"
              value={value}
              onChange={(next) => {
                setValue(next);
                setError('');
              }}
              options={vocabulary.categories}
              label={t('productForm.categoryLabel')}
              addNewLabel={t('productForm.addNewCategory')}
              onAddNewRequest={() => setAddNewOpen(true)}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
              {t('productForm.cancel')}
            </Button>
            <Button type="button" className="flex-1" onClick={save} disabled={busy}>
              {t('productForm.saveChanges')}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      {addNewOpen && (
        <AddVocabularyDialog
          businessId={businessId}
          kind="category"
          initialName={value}
          existingNames={vocabulary.categories}
          title={t('productForm.addNewCategory')}
          onCreated={(name) => {
            setValue(name);
            setAddedNames((prev) => [...prev, name]);
            setAddNewOpen(false);
          }}
          onCancel={() => setAddNewOpen(false)}
        />
      )}
    </DialogPrimitive.Root>
  );
}
