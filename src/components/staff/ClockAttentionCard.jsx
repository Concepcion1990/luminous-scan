import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlarmClock, Loader2, PhoneCall, X } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { getLocale, t } from '@/lib/i18n';
import {
  closeCallInWindow,
  getWorkforceContext,
  listCallInWindows,
  listEntries,
  listPeople,
  openCallInWindow,
} from '@/lib/workforce';
import TimeEntryFixDialog from './TimeEntryFixDialog';

/**
 * Call-ins & missed clock-outs (the clock build, Nov 21, 2026)
 * — the Staff page's clock card. It renders ONLY for a clock
 * admin: the owner, or a manager holding the staff.clock tick
 * (the workforce context's clock_admin boolean; the server
 * re-checks every write). From here they:
 *
 *   - open a call-in window for a person (their door to sign in
 *     and clock in with no shift scheduled), and close one early;
 *   - see each missed clock-out flagged on the person's record
 *     (scheduled start – end, never clocked out) and correct the
 *     entry's times through the fix dialog.
 *
 * It renders nothing for anyone else, and nothing at all when
 * there is nobody to call in and nothing missed — the doors
 * appear with the need. The person picker follows the schedule
 * hierarchy: a manager's list holds staff only.
 */
export default function ClockAttentionCard() {
  const { activeId, record } = useBusiness();
  const { toast } = useToast();
  const [ctx, setCtx] = useState(null);
  const [people, setPeople] = useState([]);
  const [entries, setEntries] = useState([]);
  const [windows, setWindows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [pick, setPick] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [fixEntry, setFixEntry] = useState(null);

  const load = useCallback(async () => {
    if (!activeId) return;
    try {
      const context = await getWorkforceContext(activeId);
      setCtx(context);
      if (!context.clock_admin) {
        setLoaded(true);
        return;
      }
      const [peopleData, entriesData, windowsData] = await Promise.all([
        listPeople(activeId),
        listEntries(activeId),
        listCallInWindows(activeId),
      ]);
      setPeople(peopleData.people ?? []);
      setEntries(entriesData.entries ?? []);
      setWindows(windowsData.windows ?? []);
    } catch {
      // A failed load hides the card rather than breaking the page.
      setCtx(null);
    } finally {
      setLoaded(true);
    }
  }, [activeId]);

  useEffect(() => {
    load();
  }, [load]);

  const peopleById = useMemo(() => {
    const map = {};
    for (const person of people) map[person.id] = person;
    return map;
  }, [people]);

  const missed = useMemo(
    () =>
      entries.filter((entry) => {
        if (!entry.missed_clock_out) return false;
        // The hierarchy, mirrored from the server: a manager's
        // fix door covers staff only — a manager's own missed
        // entry is the owner's to correct, so it never renders
        // here for a manager (no dangling doors).
        if (ctx?.level === 'manager' && peopleById[entry.staff_member_id]?.level !== 'staff') {
          return false;
        }
        return true;
      }),
    [entries, ctx, peopleById],
  );
  const openWindowByPerson = useMemo(() => {
    const map = {};
    for (const win of windows) map[win.staff_member_id] = win;
    return map;
  }, [windows]);

  const candidates = useMemo(() => {
    if (!ctx) return [];
    return people.filter((person) => {
      if (person.status !== 'active') return false;
      if (openWindowByPerson[person.id]) return false;
      if (person.id === ctx.my_staff_id) return false;
      // The hierarchy: a manager calls in staff; the owner anyone.
      if (ctx.level === 'manager' && person.level !== 'staff') return false;
      return true;
    });
  }, [people, ctx, openWindowByPerson]);

  if (!loaded || !ctx?.clock_admin) return null;
  if (!missed.length && !windows.length && !candidates.length) return null;

  const formatWhen = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(getLocale(), {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };
  const formatTime = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit' }).format(date);
  };

  const openWindow = async () => {
    if (!pick) return;
    setBusyKey(`open:${pick}`);
    try {
      await openCallInWindow(activeId, pick);
      toast({ title: t('staff.callIn.openedToast', { name: peopleById[pick]?.full_name || '' }) });
      setPick('');
      await load();
    } catch (error) {
      toast({ title: error?.message || t('staff.callIn.failed'), variant: 'destructive' });
    } finally {
      setBusyKey(null);
    }
  };

  const closeWindow = async (staffId) => {
    setBusyKey(`close:${staffId}`);
    try {
      await closeCallInWindow(activeId, staffId);
      toast({ title: t('staff.callIn.closedToast', { name: peopleById[staffId]?.full_name || '' }) });
      await load();
    } catch (error) {
      toast({ title: error?.message || t('staff.callIn.failed'), variant: 'destructive' });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <PhoneCall className="h-4 w-4" /> {t('staff.callIn.title')}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('staff.callIn.desc')}</p>
      </div>

      {missed.length > 0 && (
        <ul className="space-y-2">
          {missed.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/30 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <AlarmClock className="h-4 w-4 shrink-0 text-red-600 dark:text-red-300" />
                  {peopleById[entry.staff_member_id]?.full_name || ''}
                </p>
                <p className="mt-0.5 text-xs text-red-800 dark:text-red-200">
                  {t('workforce.entries.missedDetail', {
                    start: formatTime(entry.missed_clock_out.shift_start),
                    end: formatTime(entry.missed_clock_out.shift_end),
                  })}
                  {' · '}
                  {t('staff.callIn.clockedInAt', { when: formatWhen(entry.clock_in_at) })}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setFixEntry(entry)}>
                {t('staff.timeFix.open')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {windows.length > 0 && (
        <ul className="space-y-2">
          {windows.map((win) => (
            <li
              key={win.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{peopleById[win.staff_member_id]?.full_name || ''}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('staff.callIn.openState', {
                    when: formatWhen(win.opened_at),
                    name: win.opened_by_name || '',
                  })}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busyKey === `close:${win.staff_member_id}`}
                onClick={() => closeWindow(win.staff_member_id)}
              >
                {busyKey === `close:${win.staff_member_id}` ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="mr-1.5 h-3.5 w-3.5" />
                )}
                {t('staff.callIn.close')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="call-in-person">
              {t('staff.callIn.pickLabel')}
            </label>
            <select
              id="call-in-person"
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={pick}
              onChange={(event) => setPick(event.target.value)}
            >
              <option value="">{t('staff.callIn.pickPlaceholder')}</option>
              {candidates.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={openWindow} disabled={!pick || busyKey === `open:${pick}`}>
            {busyKey === `open:${pick}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('staff.callIn.open')}
          </Button>
        </div>
      )}

      <TimeEntryFixDialog
        open={Boolean(fixEntry)}
        onOpenChange={(next) => {
          if (!next) setFixEntry(null);
        }}
        businessId={activeId}
        entry={fixEntry}
        personName={fixEntry ? peopleById[fixEntry.staff_member_id]?.full_name || '' : ''}
        timeZone={record?.timezone || ''}
        onSaved={load}
      />
    </section>
  );
}
