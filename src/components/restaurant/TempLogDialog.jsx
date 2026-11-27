import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { useBusiness } from '@/hooks/useBusiness';
import { withBusiness } from '@/lib/scoped';
import { tempInRange, tempPresetFor } from '@/lib/restaurantOps';
import { t } from '@/lib/i18n';

/**
 * One temperature reading (release 361, Nov 23, 2026). The
 * unit name picks the expected range — fridge, freezer or
 * hot holding — and the reading is marked in or out of range
 * as it is saved. The food-safety file, completed (plan
 * release 370): an out-of-range reading REQUIRES the note
 * saying what was done about it before the entry can stand —
 * the dialog holds the rule here and the server holds it
 * again at save. Open to any trusted member: it is a daily
 * habit.
 */
export default function TempLogDialog({ open, onOpenChange, locations, onSaved }) {
  const { activeId } = useBusiness();
  const [unitName, setUnitName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [temperature, setTemperature] = useState('');
  const [scale, setScale] = useState('F');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setUnitName('');
    setLocationId('');
    setTemperature('');
    setScale('F');
    setCorrectiveAction('');
    setError('');
  }, [open ]);

  const preset = tempPresetFor(unitName);
  const hasReading = temperature !== '' && Number.isFinite(Number(temperature));
  const inRange = hasReading ? tempInRange(Number(temperature), scale, preset) : null;

  const save = async () => {
    setError('');
    if (!unitName.trim()) {
      setError(t('ops.tempLogs.needUnit'));
      return;
    }
    if (!hasReading) {
      setError(t('ops.tempLogs.needTemperature'));
      return;
    }
    if (inRange === false && !correctiveAction.trim()) {
      setError(t('foodSafety.correctiveRequired'));
      return;
    }
    const zone = locations.find((l) => l.id === locationId);
    setSaving(true);
    try {
      await base44.entities.TempLog.create(
        withBusiness(
          {
            unit_name: unitName.trim(),
            location_id: zone?.id || '',
            location_name: zone?.name || '',
            temperature: Number(temperature),
            scale,
            in_range: inRange,
            corrective_action: correctiveAction.trim(),
          },
          activeId
        )
      );
      onOpenChange(false);
      onSaved(t('ops.tempLogs.saved', { name: unitName.trim() }));
    } catch (e) {
      setError(e.message || t('ops.tempLogs.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('ops.tempLogs.newTitle')}</DialogTitle>
          <DialogDescription>{t('ops.tempLogs.dialogIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('ops.tempLogs.unitLabel')}</Label>
              <Input value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder={t('ops.tempLogs.unitPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.tempLogs.locationLabel')}</Label>
              <Select value={locationId || 'none'} onValueChange={(v) => setLocationId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('ops.tempLogs.locationNone')}</SelectItem>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.tempLogs.temperatureLabel')}</Label>
              <Input type="number" step="any" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.tempLogs.scaleLabel')}</Label>
              <Select value={scale} onValueChange={setScale}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="F">{t('ops.tempLogs.scaleF')}</SelectItem>
                  <SelectItem value="C">{t('ops.tempLogs.scaleC')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {inRange != null ? (
            <p className={`rounded-lg border px-3 py-2 text-sm ${inRange ? 'border-ok/30 bg-ok/10' : 'border-destructive/40 bg-destructive/10'}`}>
              {inRange ? t('ops.tempLogs.inRangeNote') : t('ops.tempLogs.outOfRangeNote')}
            </p>
          ) : null}
          {inRange === false ? (
            <div className="space-y-1.5">
              <Label>{t('ops.tempLogs.correctiveLabel')}</Label>
              <Textarea value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} rows={2} />
            </div>
          ) : null}
          {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('recipes.cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('ops.tempLogs.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
