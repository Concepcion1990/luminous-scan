import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { useBusiness } from '@/hooks/useBusiness';
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

const KINDS = [
  { value: 'category', label: 'Category' },
  { value: 'subcategory', label: 'Subcategory' },
  { value: 'tag', label: 'Tag' },
];

export default function CategoryDialog({ open, onOpenChange, entry, rows, onSaved }) {
  const { activeId } = useBusiness();
  const [kind, setKind] = useState('category');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      setError('A name is required.');
      return;
    }
    const clash = rows.some(
      (row) => row.kind === kind && row.id !== entry?.id && row.name.toLowerCase() === value.toLowerCase()
    );
    if (clash) {
      setError(`"${value}" already exists as a ${kind}.`);
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
      setError(err?.message || 'Could not save this entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit' : 'New'} classification</DialogTitle>
          <DialogDescription>
            Categories, subcategories and tags are shared by every product in this business.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Kind</Label>
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
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={kind === 'tag' ? 'signed' : kind === 'subcategory' ? 'Poetry' : 'Books'}
            />
          </div>

          {kind === 'subcategory' && (
            <div className="grid gap-2">
              <Label>Parent category</Label>
              <Select value={parentId || 'none'} onValueChange={(v) => setParentId(v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
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
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : entry ? 'Save changes' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}