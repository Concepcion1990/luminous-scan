import { useState } from 'react';
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
 * on her. The window is a fixed overlay (the same pattern as the
 * in-form scanner), so the form behind it does not move AT ALL.
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm space-y-3 rounded-xl bg-card p-4 shadow-lg"
      >
        <p className="text-sm font-semibold">{title}</p>
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
      </div>
    </div>
  );
}
