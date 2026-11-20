import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { base44 } from '@/api/client';
import { withBusiness } from '@/lib/scoped';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The one door through which a new category/subcategory is born
 * from the product form (owner ruling, Nov 14, 2026): the picker
 * list's "Add new …" row opens this little WINDOW — a real modal
 * overlay with one unmistakable full-width name field, prefilled
 * with whatever was typed in the picker. Save creates the entry and
 * selects it; Cancel creates nothing. Typing a name into the picker
 * itself never creates anything.
 *
 * This replaced an inline panel that rendered UNDER the category
 * box: squeezed into the form's right-hand column, its name input
 * was a narrow sliver and the form grid reflowed around it — the
 * owner could not tell where to type and the layout "freaked out"
 * on her. The window is a fixed overlay, so the form behind it
 * does not move AT ALL.
 *
 * Since Nov 20, 2026 the window is a real Radix Dialog, nested
 * over whatever dialog hosts the picker. The hand-rolled overlay
 * it used before rendered OUTSIDE the host dialog's layer: the
 * host's modal machinery switched pointer events off for
 * everything outside its own content and its focus trap kept
 * pulling focus back to the picker, so on the owner's phone the
 * window painted but its Cancel/Add took no taps at all and the
 * page behind it still scrolled — a freeze she could only escape
 * by reloading. As a nested Radix dialog the window sits on the
 * layer stack properly: the host's focus scope pauses, this
 * window holds focus and answers taps, and the scroll lock stays
 * on. It renders above even the hand-rolled overlays (z-[80] over
 * their z-[70]) so the Categories edit window's Add door — which
 * has no Radix host — behaves the same way.
 *
 * Uses the Categories page's own create machinery (the Category
 * entity create, withBusiness) and its strings for the name
 * requirement and save failure. A name that already exists is not
 * an error here: it is simply selected, exactly as if it had been
 * tapped in the list.
 */
export default function AddVocabularyDialog({
  businessId,
  kind,
  initialName = '',
  existingNames = [],
  title,
  onCreated,
  onCancel,
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('categories.nameRequired'));
      return;
    }
    const existing = existingNames.find((n) => n.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onCreated?.(existing);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await base44.entities.Category.create(
        withBusiness({ name: trimmed, kind, parent_id: '', parent_name: '' }, businessId),
      );
      onCreated?.(created?.name || trimmed);
    } catch (err) {
      setError(err?.message || t('categories.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onCancel?.();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-[50%] top-[50%] z-[80] w-[calc(100vw-2rem)] max-w-sm translate-x-[-50%] translate-y-[-50%] space-y-3 rounded-xl bg-card p-4 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder={t('categories.nameLabel')}
            aria-label={t('categories.nameLabel')}
            className="w-full"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
              {t('productForm.cancel')}
            </Button>
            <Button type="button" className="flex-1" onClick={add} disabled={busy}>
              {t('categories.addButton')}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
