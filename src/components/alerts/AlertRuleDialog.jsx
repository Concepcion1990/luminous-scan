import { useEffect, useState } from 'react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import LocationScopePicker from '@/components/alerts/LocationScopePicker';
import { ALERT_KINDS, ALERT_KIND_BY_ID } from '@/lib/alerts';
import { orderedLocations } from '@/lib/locations';
import { t } from '@/lib/i18n';

const blank = {
  name: '',
  kind: 'low_stock',
  threshold: 0,
  location_id: '',
  location_ids: [],
  category: '',
  active: true,
};

export default function AlertRuleDialog({ open, rule, locations, categories, onClose, onSave }) {
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      rule
        ? {
            ...blank,
            ...rule,
            location_ids: rule.location_ids?.length
              ? rule.location_ids
              : rule.location_id
                ? [rule.location_id]
                : [],
          }
        : blank
    );
    setError('');
    setSaving(false);
  }, [open, rule]);

  const kind = ALERT_KIND_BY_ID[form.kind] || ALERT_KINDS[0];
  const places = orderedLocations(locations);
  const patch = (values) => setForm((current) => ({ ...current, ...values }));

  const pickKind = (id) => {
    const next = ALERT_KIND_BY_ID[id] || ALERT_KINDS[0];
    patch({ kind: id, threshold: next.defaultThreshold });
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setError(t('alerts.nameRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        name: form.name.trim(),
        kind: form.kind,
        threshold: Number(form.threshold) || 0,
        location_id: '',
        location_name: '',
        location_ids: form.location_ids || [],
        location_names: (form.location_ids || [])
          .map((id) => places.find(({ location }) => location.id === id)?.location.name)
          .filter(Boolean),
        category: form.category || '',
        active: form.active !== false,
      });
    } catch (err) {
      setError(err?.message || t('alerts.dialogSaveFailed'));
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? t('alerts.editAlert') : t('alerts.newAlert')}</DialogTitle>
          <DialogDescription>
            {t('alerts.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="alert-name">{t('alerts.nameLabel')}</Label>
            <Input
              id="alert-name"
              value={form.name}
              onChange={(event) => patch({ name: event.target.value })}
              placeholder={t('alerts.namePlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('alerts.whatToWatch')}</Label>
            <Select value={form.kind} onValueChange={pickKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALERT_KINDS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{kind.hint}</p>
          </div>

          {kind.thresholdLabel && (
            <div className="space-y-1.5">
              <Label htmlFor="alert-threshold">
                {kind.thresholdLabel} {kind.unit && <span className="text-muted-foreground">({kind.unit})</span>}
              </Label>
              <Input
                id="alert-threshold"
                type="number"
                inputMode="numeric"
                min="0"
                value={form.threshold ?? 0}
                onChange={(event) => patch({ threshold: event.target.value })}
              />
            </div>
          )}

          <LocationScopePicker
            locations={locations}
            value={form.location_ids || []}
            onChange={(next) => patch({ location_ids: next })}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('alerts.categoryLabel')}</Label>
              <Select
                value={form.category || 'all'}
                onValueChange={(next) => patch({ category: next === 'all' ? '' : next })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('alerts.allCategories')}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active !== false}
              onChange={(event) => patch({ active: event.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            {t('alerts.watchThisAlert')}
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('alerts.cancel')}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? t('alerts.saving') : rule ? t('alerts.saveAlert') : t('alerts.createAlert')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}