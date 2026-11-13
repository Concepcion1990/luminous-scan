import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { useBusiness } from '@/hooks/useBusiness';
import { t } from '@/lib/i18n';

import { withBusiness } from '@/lib/scoped';
import { createLocation } from '@/lib/entitlements';
import { parentCandidates } from '@/lib/locations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
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

const NONE = 'none';

export default function LocationFormDialog({
  open,
  onOpenChange,
  location,
  locations = [],
  initialParentId = '',
  onSaved,
}) {
  const { activeId } = useBusiness();
  const [form, setForm] = useState({ name: '', code: '', kind: 'store', address: '', parent_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const KIND_LABELS = {
    store: t('locations.kindStore'),
    warehouse: t('locations.kindWarehouse'),
    van: t('locations.kindVan'),
    shelf: t('locations.kindShelf'),
    bin: t('locations.kindBin'),
    other: t('locations.kindOther'),
  };

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm({
      name: location?.name || '',
      code: location?.code || '',
      kind: location?.kind || (initialParentId ? 'shelf' : 'store'),
      address: location?.address || '',
      parent_id: location?.parent_id || initialParentId || '',
    });
  }, [open, location, initialParentId]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }));

  const parents = parentCandidates(locations, location?.id || '');

  const save = async () => {
    if (!form.name.trim()) {
      setError(t('locations.nameRequired'));
      return;
    }
    setSaving(true);
    setError('');
    const name = form.name.trim();
    const parent = locations.find((l) => l.id === form.parent_id);
    const payload = {
      name,
      code: form.code.trim().toUpperCase(),
      kind: form.kind,
      address: form.address,
      parent_id: parent?.id || '',
      parent_name: parent?.name || '',
    };
    try {
      if (location) {
        await base44.entities.Location.update(location.id, payload);
        // Children carry a copy of their parent's name for display.
        if (location.name !== name) {
          await base44.entities.Location.updateMany(
            { parent_id: location.id },
            { $set: { parent_name: name } }
          );
        }
      } else {
        await createLocation(activeId, withBusiness(payload, activeId));
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || t('locations.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{location ? t('locations.editTitle') : t('locations.newTitle')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="loc-name">{t('locations.nameLabel')}</Label>
            <Input id="loc-name" value={form.name} onChange={set('name')} placeholder="Shelf A" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="loc-code">{t('locations.codeLabel')}</Label>
              <Input id="loc-code" value={form.code} onChange={set('code')} placeholder="SH-A" className="font-mono" />
            </div>
            <div className="grid gap-2">
              <Label>{t('locations.typeLabel')}</Label>
              <Select value={form.kind} onValueChange={set('kind')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(KIND_LABELS).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>{t('locations.parentLabel')}</Label>
            <Select
              value={form.parent_id || NONE}
              onValueChange={(v) => set('parent_id')(v === NONE ? '' : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('locations.topLevelPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('locations.topLevelOption')}</SelectItem>
                {parents.map(({ location: option, depth }) => (
                  <SelectItem key={option.id} value={option.id}>
                    {`${'— '.repeat(depth)}${option.name}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t('locations.nestHint')}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="loc-address">{t('locations.addressLabel')}</Label>
            <Input id="loc-address" value={form.address} onChange={set('address')} placeholder={t('locations.optionalPlaceholder')} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('locations.cancel')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t('locations.saving') : t('locations.saveButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}