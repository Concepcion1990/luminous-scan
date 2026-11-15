import { useState } from 'react';
import { base44 } from '@/api/client';
import { withBusiness } from '@/lib/scoped';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The one door through which a new category/subcategory is born
 * from the product form (owner ruling, Nov 14, 2026): the picker
 * list's "Add new …" row opens this inline form — name, tap,
 * created and selected — mirroring AddLocationInline. Typing a
 * name into the picker itself never creates anything.
 *
 * Uses the Categories page's own create machinery (the Category
 * entity create, withBusiness) and its strings for the name
 * requirement and save failure. A name that already exists is not
 * an error here: it is simply selected, exactly as if it had been
 * tapped in the list.
 */
export default function AddVocabularyInline({
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
    <div className="grid gap-2 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs font-medium">{title}</p>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('categories.nameLabel')}
          aria-label={t('categories.nameLabel')}
        />
        <Button type="button" onClick={add} disabled={busy} className="shrink-0">
          {t('categories.addButton')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} className="shrink-0">
          {t('productForm.cancel')}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
