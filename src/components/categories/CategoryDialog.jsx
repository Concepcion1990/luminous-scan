import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { useBusiness } from '@/hooks/useBusiness';
import { t } from '@/lib/i18n';

import { withBusiness } from '@/lib/scoped';
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

export default function CategoryDialog({ open, onOpenChange, entry, rows, onSaved }) {
  const { activeId } = useBusiness();
  const [kind, setKind] = useState('category');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const KINDS = [
    { value: 'category', label: t('categories.kindCategory') },
    { value: 'subcategory', label: t('categories.kindSubcategory') },
    { value: 'tag', label: t('categories.kindTag') },
  ];

  const categories = rows.filter((row) => row.kind === 'category');

  useEffect(() => {
    if (!open) return;
    setError('');
    setKind(entry?.kind || 'category');
    setName(entry?.name || '');
    setParentId(entry?.parent_id || '');
  }, [open, entry]);

  const save = async () => {
    const value = name.trim();
    if (!value) {
      setError(t('categories.nameRequired'));
      return;
    }
    const clash = rows.some(
      (row) => row.kind === kind && row.id !== entry?.id && row.name.toLowerCase() === value.toLowerCase()
    );
    if (clash) {
      setError(t('categories.alreadyExists', { name: value, kind }));
      return;
    }

    setSaving(true);
    setError('');
    const payload = {
      name: value,
      kind,
      parent_id: kind === 'subcategory' ? parentId : '',
      parent_name: kind === 'subcategory' ? categories.find((c) => c.id === parentId)?.name || '' : '',
    };

    try {
      if (entry) await base44.entities.Category.update(entry.id, payload);
      else await base44.entities.Category.create(withBusiness(payload, activeId));
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || t('categories.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{entry ? t('categories.editTitle') : t('categories.newTitle')}</DialogTitle>
          <DialogDescription>
            {t('categories.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t('categories.kindLabel')}</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="category-name">{t('categories.nameLabel')}</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={kind === 'tag' ? 'signed' : kind === 'subcategory' ? 'Poetry' : 'Books'}
            />
          </div>

          {kind === 'subcategory' && (
            <div className="grid gap-2">
              <Label>{t('categories.parentLabel')}</Label>
              <Select value={parentId || 'none'} onValueChange={(v) => setParentId(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('categories.notSet')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('categories.notSet')}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('categories.cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t('categories.saving') : entry ? t('categories.saveChanges') : t('categories.addButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}