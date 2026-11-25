import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { t } from '@/lib/i18n';
import { fixTimeEntry } from '@/lib/workforce';

/**
 * The time-entry correction door (the clock build, Nov 21,
 * 2026) — opened from the Staff page, on the person's record.
 * The owner, or a manager holding the clock board tick, sets or
 * changes the clock-in, the clock-out, and the break out/in
 * times. Times are read and written in the BUSINESS's timezone
 * — the same frame the schedule is written in — so what the
 * owner types is what the record says, whatever device they
 * hold. An empty clock-out leaves (or makes) the entry open.
 * The server re-checks the tick and the values on every save.
 */

/** An ISO instant as a business-local "YYYY-MM-DDTHH:MM" input value. */
function toWallInput(iso, timeZone) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = {};
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
    return `${parts.year}-${parts.month}-${parts.day}T${String(Number(parts.hour) % 24).padStart(2, '0')}:${parts.minute}`;
  } catch {
    return '';
  }
}

const inputCls =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const labelCls = 'text-xs font-medium text-muted-foreground';

export default function TimeEntryFixDialog({ open, onOpenChange, businessId, entry, personName, timeZone, onSaved }) {
  const { toast } = useToast();
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [breaks, setBreaks] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !entry) return;
    setClockIn(toWallInput(entry.clock_in_at, timeZone));
    setClockOut(toWallInput(entry.clock_out_at, timeZone));
    setBreaks(
      (entry.breaks || []).map((brk) => ({
        id: brk.id,
        break_type: brk.break_type,
        out_at: toWallInput(brk.out_at, timeZone),
        in_at: toWallInput(brk.in_at, timeZone),
      })),
    );
  }, [open, entry, timeZone]);

  if (!entry) return null;

  const setBreakField = (id, field, value) =>
    setBreaks((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));

  const save = async () => {
    setBusy(true);
    try {
      await fixTimeEntry(businessId, entry.id, {
        clock_in_at: clockIn,
        clock_out_at: clockOut,
        breaks: breaks.map((brk) => ({ id: brk.id, out_at: brk.out_at, in_at: brk.in_at })),
      });
      toast({ title: t('staff.timeFix.saved') });
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      toast({ title: error?.message || t('staff.timeFix.failed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('staff.timeFix.title')}</DialogTitle>
          <DialogDescription>
            {t('staff.timeFix.desc', { name: personName || '' })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <label className={labelCls} htmlFor="fix-clock-in">{t('workforce.clockIn')}</label>
            <input
              id="fix-clock-in"
              type="datetime-local"
              className={inputCls}
              value={clockIn}
              onChange={(event) => setClockIn(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <label className={labelCls} htmlFor="fix-clock-out">{t('workforce.clockOut')}</label>
            <input
              id="fix-clock-out"
              type="datetime-local"
              className={inputCls}
              value={clockOut}
              onChange={(event) => setClockOut(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">{t('staff.timeFix.clockOutHint')}</p>
          </div>
          {breaks.map((brk, index) => (
            <div key={brk.id} className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium">{t('staff.timeFix.breakTitle', { count: index + 1 })}</p>
              <div className="grid gap-1.5">
                <label className={labelCls} htmlFor={`fix-break-out-${brk.id}`}>{t('staff.timeFix.breakOut')}</label>
                <input
                  id={`fix-break-out-${brk.id}`}
                  type="datetime-local"
                  className={inputCls}
                  value={brk.out_at}
                  onChange={(event) => setBreakField(brk.id, 'out_at', event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <label className={labelCls} htmlFor={`fix-break-in-${brk.id}`}>{t('staff.timeFix.breakIn')}</label>
                <input
                  id={`fix-break-in-${brk.id}`}
                  type="datetime-local"
                  className={inputCls}
                  value={brk.in_at}
                  onChange={(event) => setBreakField(brk.id, 'in_at', event.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('staff.timeFix.cancel')}
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('staff.timeFix.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
