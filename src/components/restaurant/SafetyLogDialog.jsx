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
import { SAFETY_LOG_KINDS, safetyLogInRange } from '@/lib/foodSafety';
import { t } from '@/lib/i18n';

/**
 * One cooling, reheating or sanitizer check (plan release
 * 370, Nov 26, 2026) — the temperature log's sibling: what
 * was checked, the reading, in or out of its range, and —
 * the family's rule — an out-of-range reading cannot be
 * saved without the note saying what was done about it. The
 * server judges the range and holds the same rule, so the
 * entry stands complete or not at all. Open to any member:
 * it is a daily log, like the temperature log.
 */
export default function SafetyLogDialog({ open, onOpenChange, locations, onSaved }) {
  const { activeId } = useBusiness();
  const [kind, setKind] = useState('cooling');
  const [subject, setSubject] = useState('');
  const [locationId, setLocationId] = useState('');
  const [reading, setReading] = useState('');
  const [unit, setUnit] = useState('F');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setKind('cooling');
    setSubject('');
    setLocationId('');
    setReading('');
    setUnit('F');
    setCorrectiveAction('');
    setError('');
  }, [open ]);

  const hasReading = reading !== '' && Number.isFinite(Number(reading));
  const effectiveUnit = kind === 'sanitizer' ? 'ppm' : unit;
  const inRange = hasReading ? safetyLogInRange(kind, Number(reading), effectiveUnit) : null;

  const save = async () => {
    setError('');
    if (!subject.trim()) {
      setError(t('foodSafety.logs.needItem'));
      return;
    }
    if (!hasReading) {
      setError(t('foodSafety.logs.needReading'));
      return;
    }
    if (inRange === false && !correctiveAction.trim()) {
      setError(t('foodSafety.correctiveRequired'));
      return;
    }
    const zone = locations.find((l) => l.id === locationId);
    setSaving(true);
    try {
      await base44.entities.SafetyLog.create(
        withBusiness(
          {
            kind,
            subject_name: subject.trim(),
            location_id: zone?.id || '',
            location_name: zone?.name || '',
            reading: Number(reading),
            unit: effectiveUnit,
            in_range: inRange,
            corrective_action: correctiveAction.trim(),
          },
          activeId
        )
      );
      onOpenChange(false);
      onSaved(t('foodSafety.logs.saved', { name: subject.trim() }));
    } catch (e) {
      setError(e.message || t('foodSafety.logs.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('foodSafety.logs.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('foodSafety.logs.dialogIntro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('foodSafety.logs.kindLabel')}</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SAFETY_LOG_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>{t(`foodSafety.logs.kind.${k}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('foodSafety.logs.itemLabel')}</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('foodSafety.logs.itemPlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('foodSafety.logs.readingLabel')}</Label>
              <Input type="number" step="any" value={reading} onChange={(e) => setReading(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('ops.tempLogs.scaleLabel')}</Label>
              {kind === 'sanitizer' ? (
                <p className="flex h-9 items-center text-sm">{t('foodSafety.logs.unitPpm')}</p>
              ) : (
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="F">{t('ops.tempLogs.scaleF')}</SelectItem>
                    <SelectItem value="C">{t('ops.tempLogs.scaleC')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t(`foodSafety.logs.range.${kind}`)}</p>
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
          <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('foodSafety.logs.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
