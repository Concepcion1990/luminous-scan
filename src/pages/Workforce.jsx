/**
 * Workforce — scheduling, the time clock, time off, tasks and the
 * team inbox (Workforce phase + inbox follow-up: notifications for
 * everything a team member waits on, plus private 1:1 messages with
 * owner oversight).
 *
 * Everyone on the team gets this page; what they can DO on it is
 * decided on the server (owner > manager > staff): staff clock
 * themselves in and out, the owner sets the manager's schedule and
 * decides the manager's time off, the manager does both for staff.
 * Clock wording is the owner's: CLOCK IN / CLOCK OUT for the day,
 * CHECK OUT / CHECK IN for breaks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BellRing, CalendarClock, Check, Clock3, Gift, ListTodo, MessageCircle, Mic, Palmtree, Send, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useBusiness } from '@/hooks/useBusiness';
import { useAuth } from '@/lib/AuthContext';
import useEntitlements from '@/hooks/useEntitlements';
import { getLocale, t } from '@/lib/i18n';
import {
  buildRewardSlipText,
  createReward,
  listRewards,
  redeemReward,
  rewardStatusLabel,
  rewardValueText,
  voidReward,
} from '@/lib/rewards';
import { toLocalDate } from '@/lib/dates';
import ProfileAvatar from '@/components/business/ProfileAvatar';
import { buildVoiceWav, createPcmCapture } from '@/lib/voiceCapture';
import {
  breakIn,
  breakOut,
  breakTypeLabel,
  clockIn,
  clockOut,
  createTask,
  decideTimeOff,
  getClockStatus,
  getMessageThread,
  getMessageUnread,
  getWorkforceContext,
  getWorkforceSettings,
  listEntries,
  listMessageThreads,
  listNotifications,
  listPeople,
  listSchedules,
  listTasks,
  listTimeOff,
  markNotificationRead,
  markThreadRead,
  postMessage,
  postVoiceMessage,
  requestTimeOff,
  saveSchedule,
  setTaskStatus,
  startMessageThread,
  timeOffStatusLabel,
  updateWorkforceSettings,
  voiceNoteFileUrl,
  weekdayLabel,
} from '@/lib/workforce';

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const labelCls = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';

function formatTime(value) {
  const date = toLocalDate(value);
  if (!date) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function formatDay(value) {
  const date = toLocalDate(value);
  if (!date) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
/** An entry's total span, in the reader's own unit words
 * (Intl unit formatting follows the device locale, the same
 * convention formatTime/formatDay above already use). */
function formatDuration(startValue, endValue) {
  const start = toLocalDate(startValue);
  const end = toLocalDate(endValue);
  if (!start || !end) return '';
  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  try {
    const unit = (value, name) =>
      new Intl.NumberFormat(undefined, { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(value);
    if (hours > 0 && minutes > 0) return `${unit(hours, 'hour')} ${unit(minutes, 'minute')}`;
    if (hours > 0) return unit(hours, 'hour');
    return unit(minutes, 'minute');
  } catch {
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
}
function formatDateOnly(value) {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Section({ title, children, help }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="font-heading text-base font-semibold">{title}</h2>
      {help && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{help}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ClockTab({ businessId, ctx, peopleById, onEvent }) {
  const { toast } = useToast();
  const [status, setStatus] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState([]);

  const load = useCallback(async () => {
    const [s, e] = await Promise.all([getClockStatus(businessId), listEntries(businessId)]);
    setStatus(s);
    setEntries(e.entries ?? []);
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const { checkUserAuth } = useAuth();
  const act = async (fn, okMessage) => {
    setBusy(true);
    try {
      // fn may return a follow-up line for the toast (the
      // clock-out grace note); anything else it returns is ignored.
      const followUp = await fn();
      toast({
        title: okMessage,
        description: typeof followUp === 'string' ? followUp : undefined,
      });
      setNote('');
      await load();
      onEvent();
      // Clocking in or out moves the shift-window deadline
      // (Nov 19, 2026): refresh /auth/me so the client timer
      // arms on clock-out and clears on clock-in.
      checkUserAuth().catch(() => {});
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <p className="text-sm text-muted-foreground">{t('workforce.loading')}</p>;
  const open = status.open_entry;
  const onBreak = Boolean(status.open_break);
  const selfOff = status.self_clock_enabled === false;
  // Door 1 (owner's ruling, Nov 23, 2026): a caller with no
  // staff profile has no clock of their own, and the server
  // says so with the explicit no_clock marker. Their Time clock
  // view is the team's entries alone — none of the worker
  // furniture below renders for them. Members key on
  // self_clock_enabled exactly as before; the marker is never
  // inferred from it.
  const noClock = status.no_clock === true;

  // The call-in gate (Nov 21, 2026): a refused clock-in names
  // the next scheduled shift when the schedule knows one, in
  // the reader's language — the staff_outside_window shape.
  const gateMessage = (data) => {
    if (data?.next_shift_start) {
      const when = new Date(data.next_shift_start);
      if (!Number.isNaN(when.getTime())) {
        const formatted = new Intl.DateTimeFormat(getLocale(), {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(when);
        return t('workforce.clockGate.closedNext', { when: formatted });
      }
    }
    return t('workforce.clockGate.closed');
  };
  const tryClockIn = async () => {
    try {
      await clockIn(businessId);
    } catch (error) {
      if (error?.data?.error === 'clock_in_not_scheduled') {
        throw new Error(gateMessage(error.data));
      }
      throw error;
    }
  };

  return (
    <div className="space-y-4">
      {!noClock && (
      <Section title={t('workforce.tab.clock')}>
        {selfOff && (
          <p className="mb-3 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
            {t('workforce.selfClockOff')}
          </p>
        )}
        {status.today_shift ? (
          <p className="text-sm">
            {t('workforce.todayShift', { start: status.today_shift.start_time, end: status.today_shift.end_time })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('workforce.noShiftToday')}</p>
        )}
        {status.call_in_open && !open && (
          <p className="mt-2 rounded-md bg-primary/10 px-3 py-2 text-sm">
            {t('workforce.callIn.openForYou')}
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          {open
            ? onBreak
              ? t('workforce.onBreak')
              : t('workforce.clockedInSince', { time: formatTime(open.clock_in_at) })
            : t('workforce.notClockedIn')}
        </p>
        {open?.unscheduled && (
          <p className="mt-1 text-xs text-muted-foreground">{t('workforce.unscheduledNote')}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!open && (
            <Button disabled={busy || selfOff} onClick={() => act(tryClockIn, t('workforce.clockedInMsg'))}>
              <Clock3 className="mr-2 h-4 w-4" /> {t('workforce.clockIn')}
            </Button>
          )}
          {open && !onBreak && (
            <>
              <Button
                variant="outline"
                disabled={busy || selfOff}
                onClick={() => act(() => breakOut(businessId, 'break15'), t('workforce.breakStarted'))}
              >
                {t('workforce.break15')}
              </Button>
              <Button
                variant="outline"
                disabled={busy || selfOff}
                onClick={() => act(() => breakOut(businessId, 'lunch30'), t('workforce.breakStarted'))}
              >
                {t('workforce.lunch30')}
              </Button>
              <Button
                variant="outline"
                disabled={busy || selfOff}
                onClick={() => act(() => breakOut(businessId, 'lunch60'), t('workforce.breakStarted'))}
              >
                {t('workforce.lunch60')}
              </Button>
            </>
          )}
          {open && onBreak && (
            <Button disabled={busy || selfOff} onClick={() => act(() => breakIn(businessId), t('workforce.breakEnded'))}>
              {t('workforce.breakIn')}
            </Button>
          )}
        </div>
        {open && (
          <div className="mt-4 max-w-xl">
            <label className={labelCls} htmlFor="early-note">
              {t('workforce.earlyNoteLabel')}
            </label>
            <textarea
              id="early-note"
              className={inputCls}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('workforce.earlyNotePlaceholder')}
            />
            <Button
              className="mt-2"
              disabled={busy || selfOff}
              onClick={() =>
                act(async () => {
                  const result = await clockOut(businessId, note);
                  // The grace note (Nov 19, 2026): after clock-out
                  // they have 10 minutes to check their times
                  // before the app signs them out on its own.
                  return result?.auto_logout_at ? t('workforce.autoLogoutNote') : undefined;
                }, t('workforce.clockedOutMsg'))
              }
            >
              {t('workforce.clockOut')}
            </Button>
          </div>
        )}
      </Section>
      )}

      <Section title={t('workforce.entries.title')}>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('workforce.entries.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.slice(0, 30).map((entry) => {
              const breakMinutes = (entry.breaks || []).reduce((sum, b) => {
                const out = new Date(b.out_at).getTime();
                const back = b.in_at ? new Date(b.in_at).getTime() : out;
                return sum + Math.max(0, Math.round((back - out) / 60000));
              }, 0);
              return (
                <li key={entry.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">
                      {ctx.level !== 'staff'
                        ? peopleById[entry.staff_member_id]?.full_name || ''
                        : formatDay(entry.clock_in_at)}
                    </span>
                    <span>
                      {formatDay(entry.clock_in_at)} {formatTime(entry.clock_in_at)} –{' '}
                      {entry.clock_out_at ? formatTime(entry.clock_out_at) : '…'}
                      {entry.clock_out_at && (
                        <span className="text-muted-foreground">
                          {' '}· {formatDuration(entry.clock_in_at, entry.clock_out_at)}
                        </span>
                      )}
                    </span>
                    {entry.called_in ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs">{t('workforce.entries.calledIn')}</span>
                    ) : entry.unscheduled ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t('workforce.entries.unscheduled')}</span>
                    ) : null}
                    {entry.missed_clock_out && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900 dark:bg-red-900/40 dark:text-red-100">
                        {t('workforce.entries.missedClockOut')}
                      </span>
                    )}
                    {entry.early_departure && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                        {t('workforce.entries.early')}
                      </span>
                    )}
                    {breakMinutes > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {t('workforce.entries.breaks', { minutes: breakMinutes })}
                      </span>
                    )}
                  </div>
                  {entry.early_note && (
                    <p className="mt-0.5 text-xs italic text-muted-foreground">“{entry.early_note}”</p>
                  )}
                  {entry.missed_clock_out && (
                    <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
                      {t('workforce.entries.missedDetail', {
                        start: formatTime(entry.missed_clock_out.shift_start),
                        end: formatTime(entry.missed_clock_out.shift_end),
                      })}
                    </p>
                  )}
                  {(entry.breaks || []).map((b) => (
                    <p key={b.id} className="text-xs text-muted-foreground">
                      {breakTypeLabel(b.break_type)}: {formatTime(b.out_at)} – {b.in_at ? formatTime(b.in_at) : '…'}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function ScheduleTab({ businessId, ctx, people }) {
  const { toast } = useToast();
  const editable = ctx.level !== 'staff';
  const candidates = useMemo(() => {
    if (ctx.level === 'owner') return people;
    if (ctx.level === 'manager') return people.filter((p) => p.level === 'staff');
    return people.filter((p) => p.id === ctx.my_staff_id);
  }, [people, ctx]);
  const [personId, setPersonId] = useState('');
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);

  const loadFor = useCallback(
    async (id) => {
      if (!id) return;
      const data = await listSchedules(businessId);
      const mine = (data.schedules ?? []).filter((s) => s.staff_member_id === id);
      const next = {};
      for (const shift of mine) next[shift.weekday] = { start_time: shift.start_time, end_time: shift.end_time };
      setDraft(next);
    },
    [businessId],
  );

  useEffect(() => {
    if (!personId && candidates.length) setPersonId(candidates[0].id);
  }, [candidates, personId]);
  useEffect(() => {
    loadFor(personId).catch(() => {});
  }, [personId, loadFor]);

  const save = async () => {
    setBusy(true);
    try {
      const shifts = Object.entries(draft)
        .filter(([, v]) => v && v.start_time && v.end_time)
        .map(([weekday, v]) => ({ weekday: Number(weekday), start_time: v.start_time, end_time: v.end_time }));
      await saveSchedule(businessId, personId, shifts);
      toast({ title: t('workforce.schedule.saved') });
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('workforce.schedule.title')} help={t('workforce.schedule.help')}>
      {candidates.length > 1 && (
        <div className="mb-3 max-w-xs">
          <label className={labelCls}>{t('workforce.schedule.person')}</label>
          <select className={inputCls} value={personId} onChange={(e) => setPersonId(e.target.value)}>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} {p.role_name ? `(${p.role_name})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* The card always names whose schedule it is (owner's
          catch, Nov 19, 2026): with exactly one candidate there
          is no picker to render, so the name stands plainly —
          the week below is never silently somebody's. */}
      {candidates.length === 1 && (
        <div className="mb-3 max-w-xs">
          <label className={labelCls}>{t('workforce.schedule.person')}</label>
          <p className="text-sm font-medium">
            {candidates[0].full_name} {candidates[0].role_name ? `(${candidates[0].role_name})` : ''}
          </p>
        </div>
      )}
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5, 6].map((day) => {
          const value = draft[day];
          return (
            <div key={day} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm font-medium">{weekdayLabel(day)}</span>
              {editable ? (
                <>
                  <input
                    type="time"
                    className="w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={value?.start_time || ''}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [day]: { start_time: e.target.value, end_time: d[day]?.end_time || '' } }))
                    }
                  />
                  <span className="text-muted-foreground">–</span>
                  <input
                    type="time"
                    className="w-32 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={value?.end_time || ''}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [day]: { start_time: d[day]?.start_time || '', end_time: e.target.value } }))
                    }
                  />
                  {value && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDraft((d) => ({ ...d, [day]: undefined }))}
                    >
                      {t('workforce.schedule.clear')}
                    </Button>
                  )}
                </>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {value ? `${value.start_time} – ${value.end_time}` : t('workforce.schedule.off')}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {editable && (
        <Button className="mt-4" disabled={busy || !personId} onClick={save}>
          {t('workforce.schedule.save')}
        </Button>
      )}
    </Section>
  );
}

function TimeOffTab({ businessId, ctx, peopleById }) {
  const { toast } = useToast();
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ start_date: '', end_date: '', reason: '' });
  const [reasons, setReasons] = useState({});
  const load = useCallback(async () => {
    const data = await listTimeOff(businessId);
    setRequests(data.requests ?? []);
  }, [businessId]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const submit = async () => {
    try {
      await requestTimeOff(businessId, form);
      toast({ title: t('workforce.timeOff.submitted') });
      setForm({ start_date: '', end_date: '', reason: '' });
      await load();
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    }
  };
  const decide = async (request, status) => {
    try {
      await decideTimeOff(businessId, request.id, status, reasons[request.id] || '');
      toast({ title: t('workforce.timeOff.decided') });
      await load();
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    }
  };
  const canDecide = (request) => {
    if (request.status !== 'pending' || ctx.level === 'staff') return false;
    const requesterLevel = peopleById[request.staff_member_id]?.level;
    if (ctx.level === 'manager' && requesterLevel !== 'staff') return false;
    return true;
  };

  return (
    <div className="space-y-4">
      {ctx.my_staff_id && (
        <Section title={t('workforce.timeOff.newRequest')}>
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{t('workforce.timeOff.start')}</label>
              <input
                type="date"
                className={inputCls}
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>{t('workforce.timeOff.end')}</label>
              <input
                type="date"
                className={inputCls}
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>{t('workforce.timeOff.reason')}</label>
              <input
                className={inputCls}
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
          </div>
          <Button className="mt-3" onClick={submit} disabled={!form.start_date || !form.end_date}>
            {t('workforce.timeOff.submit')}
          </Button>
        </Section>
      )}
      <Section title={t('workforce.timeOff.title')}>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('workforce.timeOff.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {requests.map((request) => (
              <li key={request.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{peopleById[request.staff_member_id]?.full_name || ''}</span>
                  <span>
                    {formatDateOnly(request.start_date)} – {formatDateOnly(request.end_date)}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{timeOffStatusLabel(request.status)}</span>
                </div>
                {request.reason && <p className="mt-0.5 text-muted-foreground">{request.reason}</p>}
                {request.decision_reason && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('workforce.timeOff.decisionReason')}: {request.decision_reason}
                  </p>
                )}
                {canDecide(request) && (
                  <div className="mt-2 flex max-w-xl flex-wrap items-center gap-2">
                    <input
                      className={inputCls}
                      placeholder={t('workforce.timeOff.decisionReason')}
                      value={reasons[request.id] || ''}
                      onChange={(e) => setReasons((r) => ({ ...r, [request.id]: e.target.value }))}
                    />
                    <Button size="sm" onClick={() => decide(request, 'approved')}>
                      <Check className="mr-1 h-4 w-4" /> {t('workforce.timeOff.approve')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => decide(request, 'declined')}>
                      <X className="mr-1 h-4 w-4" /> {t('workforce.timeOff.decline')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function TasksTab({ businessId, ctx, people, peopleById }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [form, setForm] = useState({ staff_member_id: '', title: '', notes: '', due_date: '', kind: 'task' });
  const [stopTask, setStopTask] = useState(null);
  const load = useCallback(async () => {
    const data = await listTasks(businessId);
    setTasks(data.tasks ?? []);
  }, [businessId]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  const assignable = ctx.level === 'owner' ? people : people.filter((p) => p.level === 'staff');

  const add = async () => {
    try {
      await createTask(businessId, { ...form, due_date: form.due_date || null });
      toast({ title: t('workforce.tasks.added') });
      setForm({ staff_member_id: '', title: '', notes: '', due_date: '', kind: 'task' });
      await load();
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    }
  };
  const toggle = async (task) => {
    try {
      await setTaskStatus(businessId, task.id, task.status === 'done' ? 'open' : 'done');
      await load();
    } catch (error) {
      // The training gate (Nov 20, 2026): a training task's Done
      // refused because the person's training is unfinished —
      // show the stop dialog with a door back to the training
      // instead of a bare error.
      if (error?.data?.error === 'training_incomplete') {
        setStopTask(task);
        return;
      }
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      {ctx.level !== 'staff' && (
        <Section title={t('workforce.tasks.new')}>
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{t('workforce.tasks.assignTo')}</label>
              <select
                className={inputCls}
                value={form.staff_member_id}
                onChange={(e) => setForm((f) => ({ ...f, staff_member_id: e.target.value }))}
              >
                <option value="">—</option>
                {assignable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('workforce.tasks.due')}</label>
              <input
                type="date"
                className={inputCls}
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>{t('workforce.tasks.titleField')}</label>
              <input
                className={inputCls}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>{t('workforce.tasks.notes')}</label>
              <input
                className={inputCls}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <label className="flex items-start gap-2 text-sm leading-snug sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.kind === 'training'}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.checked ? 'training' : 'task' }))}
              />
              <span>{t('workforce.tasks.trainingTask')}</span>
            </label>
          </div>
          <Button className="mt-3" onClick={add} disabled={!form.staff_member_id || !form.title}>
            {t('workforce.tasks.add')}
          </Button>
        </Section>
      )}
      <Section title={t('workforce.tasks.title')}>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('workforce.tasks.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
                <span className={task.status === 'done' ? 'font-medium line-through opacity-60' : 'font-medium'}>
                  {task.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('workforce.tasks.forPerson', { name: peopleById[task.staff_member_id]?.full_name || '' })}
                  {task.due_date ? ` · ${formatDateOnly(task.due_date)}` : ''}
                  {task.created_by_name ? ` · ${t('workforce.tasks.assignedBy', { name: task.created_by_name })}` : ''}
                </span>
                {task.notes && <span className="w-full text-xs text-muted-foreground">{task.notes}</span>}
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => toggle(task)}>
                  {task.status === 'done' ? t('workforce.tasks.reopen') : t('workforce.tasks.done')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {stopTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
            <h3 className="font-heading text-lg font-semibold">{t('workforce.tasks.notYetTitle')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t('workforce.tasks.notYetBody', {
                name: peopleById[stopTask.staff_member_id]?.full_name || '',
              })}
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setStopTask(null)}>
                {t('ui.close')}
              </Button>
              <Button
                onClick={() => {
                  setStopTask(null);
                  navigate('/training');
                }}
              >
                {t('workforce.tasks.goTraining')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InboxTab({ businessId, ctx, people, onRead, onGoTab }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const loadNotifications = useCallback(async () => {
    const data = await listNotifications(businessId);
    setItems(data.notifications ?? []);
  }, [businessId]);
  const loadThreads = useCallback(async () => {
    const data = await listMessageThreads(businessId);
    setThreads(data.threads ?? []);
  }, [businessId]);
  useEffect(() => {
    loadNotifications().catch(() => {});
    loadThreads().catch(() => {});
  }, [loadNotifications, loadThreads]);

  const openThread = async (thread) => {
    try {
      discardRecording();
      const data = await getMessageThread(businessId, thread.id);
      setActiveThread(data.thread);
      setThreadMessages(data.messages ?? []);
      setDraft('');
      if (thread.is_mine && (thread.unread ?? 0) > 0) {
        await markThreadRead(businessId, thread.id).catch(() => {});
        await loadThreads();
        onRead();
      }
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    }
  };

  // Every activity row is a DOOR (owner's ruling, Nov 19, 2026):
  // there is no "mark read" without going to the thing itself.
  // Tapping a row marks the notice read BECAUSE the person went
  // there, then takes them to it. The destination follows the
  // event the server recorded (entry_id carries the related
  // record: the thread, the request, the task, the stub, the
  // time entry). Read receipts are untouched by this: they still
  // fire only from opening the conversation itself, and the
  // owner's read state is never exposed to staff (release 315).
  const openNotification = async (item) => {
    if (!item.is_read) {
      await markNotificationRead(businessId, item.id).catch(() => {});
      await loadNotifications();
      onRead();
    }
    switch (item.event) {
      case 'message': {
        const thread = threads.find((th) => th.id === item.entry_id);
        if (thread) await openThread(thread);
        break;
      }
      case 'schedule_set':
        onGoTab('schedule');
        break;
      case 'time_off_requested':
      case 'time_off_decided':
        onGoTab('timeoff');
        break;
      case 'task_assigned':
      case 'task_done':
        onGoTab('tasks');
        break;
      case 'stub_pushed':
        navigate('/payroll');
        break;
      case 'photo_submitted':
        // A photo waits for the owner's word — the decision
        // lives on the Staff page (Nov 21, 2026).
        navigate('/staff');
        break;
      case 'photo_approved':
      case 'photo_declined':
        // The person's own photo state lives on their Settings
        // card, wording and all.
        navigate('/settings');
        break;
      case 'dd_submitted':
      case 'dd_corrected':
      case 'dd_correction_requested':
      case 'dd_invited':
        // Direct deposit lives on the Payroll page: the owner's
        // receiving list and the member's own form alike
        // (Nov 21, 2026).
        navigate('/payroll');
        break;
      case 'clock_in':
      case 'break_out':
      case 'break_in':
      case 'clock_out':
        onGoTab('clock');
        break;
      case 'missed_clock_out':
        // The fix lives on the Staff page, on the person's
        // record (Nov 21, 2026).
        navigate('/staff');
        break;
      default:
        // A notice type with no home of its own: the tap still
        // marked it read above; there is nowhere to go.
        break;
    }
  };

  const startConversation = async () => {
    if (!pickerTarget) return;
    setBusy(true);
    try {
      const target = pickerTarget === 'owner' ? { with_owner: true } : { staff_member_id: pickerTarget };
      const data = await startMessageThread(businessId, target);
      setPickerOpen(false);
      setPickerTarget('');
      await loadThreads();
      await openThread(data.thread);
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeThread) return;
    setBusy(true);
    try {
      await postMessage(businessId, activeThread.id, body);
      setDraft('');
      const data = await getMessageThread(businessId, activeThread.id);
      setActiveThread(data.thread);
      setThreadMessages(data.messages ?? []);
      await loadThreads();
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  // Text messages cap at 2,000 characters — the server has
  // always cut them there, silently. The composer now shows
  // the limit honestly (owner's ruling, Nov 19, 2026): a
  // counter appears as the person gets close, and the box
  // itself stops at the limit, so nothing they wrote is ever
  // silently lost. The server cut stays as the backstop.
  const MESSAGE_MAX_CHARS = 2000;
  const MESSAGE_COUNTER_FROM = 1500;

  // ---- Voice notes ---------------------------------------------------------
  // Record with the device's own microphone (the browser asks
  // permission the first time — that prompt is the browser's,
  // not ours). Before sending, the sender can listen back, toss
  // the take, or send it. The server converts the recording to
  // MP3 so it plays on the other person's phone, whatever kind
  // it is. 3 minutes is the composer's cap.
  //
  // Capture counts samples through WebAudio (src/lib/
  // voiceCapture.js): a device recorder's container clock
  // proved able to squeeze and shift a note on Android, so the
  // note's timing is never read from a container — it is the
  // sample count. MediaRecorder remains only as the fallback
  // for browsers where WebAudio capture cannot run.
  const VOICE_MAX_MS = 3 * 60 * 1000;
  const [recPhase, setRecPhase] = useState('idle'); // idle | recording | ready
  const [recElapsedMs, setRecElapsedMs] = useState(0);
  const [recPreviewUrl, setRecPreviewUrl] = useState(null);
  const recRef = useRef({ recorder: null, capture: null, stream: null, chunks: [], timer: null, startedAt: 0, blob: null, durationMs: 0 });

  const stopRecTracks = useCallback(() => {
    const rec = recRef.current;
    if (rec.timer) clearInterval(rec.timer);
    rec.timer = null;
    if (rec.capture) rec.capture.dispose();
    rec.capture = null;
    if (rec.stream) rec.stream.getTracks().forEach((track) => track.stop());
    rec.stream = null;
  }, []);

  const discardRecording = useCallback(() => {
    stopRecTracks();
    recRef.current.blob = null;
    if (recPreviewUrl) URL.revokeObjectURL(recPreviewUrl);
    setRecPreviewUrl(null);
    setRecElapsedMs(0);
    setRecPhase('idle');
  }, [recPreviewUrl, stopRecTracks]);

  useEffect(() => () => {
    stopRecTracks();
    if (recPreviewUrl) URL.revokeObjectURL(recPreviewUrl);
  }, [recPreviewUrl, stopRecTracks]);

  const stopRecording = () => {
    const rec = recRef.current;
    if (rec.capture) {
      const { samples, sampleRate } = rec.capture.finish();
      rec.capture = null;
      const wav = buildVoiceWav(samples, sampleRate);
      rec.blob = new Blob([wav.bytes], { type: 'audio/wav' });
      rec.durationMs = wav.durationMs;
      stopRecTracks();
      setRecPreviewUrl(URL.createObjectURL(rec.blob));
      setRecPhase('ready');
      return;
    }
    if (rec.recorder?.state === 'recording') rec.recorder.stop();
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: t('workforce.messages.micDenied'), variant: 'destructive' });
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast({ title: t('workforce.messages.micDenied'), variant: 'destructive' });
      return;
    }
    const rec = recRef.current;
    rec.stream = stream;
    rec.startedAt = Date.now();

    // The on-screen clock and the 3-minute cap follow the
    // recording itself: samples counted for a PCM capture, the
    // wall clock for the MediaRecorder fallback.
    const armTimer = () => {
      setRecElapsedMs(0);
      setRecPhase('recording');
      rec.timer = setInterval(() => {
        const elapsed = rec.capture
          ? (rec.capture.sampleCount() / rec.capture.sampleRate) * 1000
          : Date.now() - rec.startedAt;
        setRecElapsedMs(elapsed);
        if (elapsed >= VOICE_MAX_MS) stopRecording();
      }, 250);
    };

    // First choice: the sample-counted PCM capture.
    try {
      const capture = createPcmCapture(stream);
      await capture.begin();
      rec.capture = capture;
      armTimer();
      return;
    } catch {
      rec.capture = null;
    }

    // Fallback: the device recorder, for browsers where
    // WebAudio capture cannot run at all.
    if (typeof MediaRecorder === 'undefined') {
      stopRecTracks();
      toast({ title: t('workforce.messages.micDenied'), variant: 'destructive' });
      return;
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', '']
      .find((candidate) => candidate === '' || MediaRecorder.isTypeSupported(candidate));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    rec.recorder = recorder;
    rec.chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) rec.chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(rec.chunks, { type: recorder.mimeType || 'audio/webm' });
      rec.blob = blob;
      rec.durationMs = Date.now() - rec.startedAt;
      stopRecTracks();
      setRecPreviewUrl(URL.createObjectURL(blob));
      setRecPhase('ready');
    };
    recorder.start();
    armTimer();
  };

  const sendVoice = async () => {
    const blob = recRef.current.blob;
    if (!blob || !activeThread) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      await postVoiceMessage(businessId, activeThread.id, dataUrl, recRef.current.durationMs);
      discardRecording();
      const data = await getMessageThread(businessId, activeThread.id);
      setActiveThread(data.thread);
      setThreadMessages(data.messages ?? []);
      await loadThreads();
    } catch (error) {
      toast({ title: error.message || t('workforce.messages.voiceFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const recClock = `${Math.floor(recElapsedMs / 60000)}:${String(Math.floor((recElapsedMs % 60000) / 1000)).padStart(2, '0')}`;

  const pickerPeople = people.filter((p) => p.status === 'active' && p.id !== ctx.my_staff_id);
  const threadTitle = (thread) =>
    thread.other
      ? thread.other.name
      : (thread.participants ?? []).map((p) => p.name).join(' & ');

  return (
    <div className="space-y-6">
      <Section title={t('workforce.inbox.title')} help={t('workforce.inbox.help')}>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('workforce.inbox.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className={item.is_read ? 'opacity-60' : ''}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-3 text-left text-sm"
                  onClick={() => openNotification(item)}
                >
                  <BellRing className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1">
                    {item.detail}
                    <span className="block text-xs text-muted-foreground">
                      {formatDay(item.created_at)} {formatTime(item.created_at)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('workforce.messages.title')} help={t('workforce.messages.help')}>
        {!activeThread && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setPickerOpen((open) => !open)}>
                <MessageCircle className="mr-1.5 h-4 w-4" /> {t('workforce.messages.new')}
              </Button>
            </div>
            {pickerOpen && (
              <div className="mb-5 flex max-w-xl flex-wrap items-end gap-2 rounded-lg bg-muted/50 p-3">
                <div className="min-w-48 flex-1">
                  <label className={labelCls}>{t('workforce.messages.to')}</label>
                  <select className={inputCls} value={pickerTarget} onChange={(e) => setPickerTarget(e.target.value)}>
                    <option value="">{t('workforce.messages.selectPerson')}</option>
                    {!ctx.is_owner && <option value="owner">{ctx.owner_name || t('workforce.messages.owner')}</option>}
                    {pickerPeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} {p.role_name ? `(${p.role_name})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <Button size="sm" disabled={busy || !pickerTarget} onClick={startConversation}>
                  {t('workforce.messages.start')}
                </Button>
              </div>
            )}
            {threads.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('workforce.messages.empty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {threads.map((thread) => (
                  <li key={thread.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 py-3.5 text-left text-sm"
                      onClick={() => openThread(thread)}
                    >
                      {thread.other ? (
                        <ProfileAvatar
                          businessId={businessId}
                          personKey={thread.other.key}
                          name={thread.other.name}
                          hasPhoto={Boolean(thread.other.photo)}
                          className="h-9 w-9 text-xs"
                        />
                      ) : (
                        <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{threadTitle(thread)}</span>
                        {thread.oversight && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                            {t('workforce.messages.oversight')}
                          </span>
                        )}
                        <span className="block truncate text-xs text-muted-foreground">
                          {thread.last_message
                            ? `${thread.last_message.sender_name}: ${thread.last_message.kind === 'voice' ? t('workforce.messages.voiceNote') : thread.last_message.body}`
                            : t('workforce.messages.emptyThread')}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        {thread.last_message_at && (
                          <span className="text-xs text-muted-foreground">
                            {formatDay(thread.last_message_at)} {formatTime(thread.last_message_at)}
                          </span>
                        )}
                        {thread.is_mine && thread.last_message && (
                          <span className="text-[11px] font-medium text-muted-foreground">
                            {thread.last_message.mine
                              ? t('workforce.messages.sentLabel')
                              : t('workforce.messages.receivedLabel')}
                          </span>
                        )}
                      </span>
                      {(thread.unread ?? 0) > 0 && (
                        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                          {thread.unread}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {activeThread && (
          <div>
            <div className="mb-4 flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setActiveThread(null)}>
                <ArrowLeft className="mr-1 h-4 w-4" /> {t('workforce.messages.back')}
              </Button>
              {activeThread.other ? (
                <ProfileAvatar
                  businessId={businessId}
                  personKey={activeThread.other.key}
                  name={activeThread.other.name}
                  hasPhoto={Boolean(activeThread.other.photo)}
                  className="h-8 w-8 text-[11px]"
                />
              ) : null}
              <span className="text-sm font-medium">{threadTitle(activeThread)}</span>
            </div>
            {activeThread.oversight && (
              <p className="mb-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {t('workforce.messages.oversightNote')}
              </p>
            )}
            {threadMessages.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{t('workforce.messages.emptyThread')}</p>
            ) : (
              <ul className="space-y-3 py-1">
                {threadMessages.map((message) => {
                  const sender = (activeThread.participants ?? []).find(
                    (p) => p.user_id === message.sender_user_id,
                  );
                  return (
                  <li key={message.id} className={`flex items-end gap-2 ${message.mine ? 'justify-end' : 'justify-start'}`}>
                    {!message.mine && sender ? (
                      <ProfileAvatar
                        businessId={businessId}
                        personKey={sender.key}
                        name={sender.name}
                        hasPhoto={Boolean(sender.photo)}
                        className="h-7 w-7 text-[10px]"
                      />
                    ) : null}
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        message.mine
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      {!message.mine && (
                        <span className="mb-0.5 block text-xs font-medium opacity-70">{message.sender_name}</span>
                      )}
                      {message.kind === 'voice' ? (
                        <span className="block">
                          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium opacity-80">
                            <Mic className="h-3.5 w-3.5" /> {t('workforce.messages.voiceNote')}
                          </span>
                          <audio
                            controls
                            preload="metadata"
                            src={voiceNoteFileUrl(businessId, message.thread_id, message.id)}
                            className="h-9 max-w-full"
                          />
                        </span>
                      ) : (
                        <span className="whitespace-pre-wrap">{message.body}</span>
                      )}
                      <span className="mt-1 block text-[11px] opacity-60">
                        {formatDay(message.created_at)} {formatTime(message.created_at)}
                        {message.mine && message.read_at ? ` · ${t('workforce.messages.readLabel')}` : ''}
                      </span>
                    </div>
                    {/* The sender's own face beside their own
                        sent bubbles (owner's ruling, Nov 21,
                        2026): the received side has always shown
                        the other person's photo; the sent side
                        mirrors it — the person's approved photo,
                        or their initials when they have none,
                        exactly the header's fallback. */}
                    {message.mine && sender ? (
                      <ProfileAvatar
                        businessId={businessId}
                        personKey={sender.key}
                        name={sender.name}
                        hasPhoto={Boolean(sender.photo)}
                        className="h-7 w-7 text-[10px]"
                      />
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            )}
            {activeThread.can_post && (
              <div className="mt-5 space-y-3">
                {recPhase === 'recording' && (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                      {t('workforce.messages.recording')} {recClock}
                    </span>
                    <Button size="sm" variant="outline" className="ml-auto" onClick={stopRecording}>
                      {t('workforce.messages.stopRecording')}
                    </Button>
                  </div>
                )}
                {recPhase === 'ready' && (
                  <div className="space-y-2 rounded-lg bg-muted/50 px-3 py-2.5">
                    <p className="text-xs text-muted-foreground">{t('workforce.messages.voiceReady')}</p>
                    <audio controls src={recPreviewUrl} className="h-9 w-full max-w-sm" />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={busy} onClick={sendVoice}>
                        <Send className="mr-1.5 h-4 w-4" /> {t('workforce.messages.sendVoice')}
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={discardRecording}>
                        <Trash2 className="mr-1.5 h-4 w-4" /> {t('workforce.messages.discard')}
                      </Button>
                    </div>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <textarea
                      className={inputCls}
                      rows={2}
                      maxLength={MESSAGE_MAX_CHARS}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={t('workforce.messages.placeholder')}
                    />
                    {draft.length >= MESSAGE_COUNTER_FROM && (
                      <p
                        className={`mt-1 text-right text-xs ${
                          draft.length >= MESSAGE_MAX_CHARS
                            ? 'font-medium text-destructive'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {draft.length >= MESSAGE_MAX_CHARS
                          ? t('workforce.messages.charLimit')
                          : t('workforce.messages.charCount', { count: draft.length, max: MESSAGE_MAX_CHARS })}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy || recPhase !== 'idle'}
                    onClick={startRecording}
                    aria-label={t('workforce.messages.voiceNote')}
                    title={t('workforce.messages.voiceNote')}
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                  <Button disabled={busy || !draft.trim()} onClick={send}>
                    <Send className="mr-1.5 h-4 w-4" /> {t('workforce.messages.send')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function RewardsTab({ businessId, ctx, people, businessName }) {
  const { toast } = useToast();
  const [rewards, setRewards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [kind, setKind] = useState('percent_off');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [percent, setPercent] = useState('10');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [detail, setDetail] = useState('');
  const [redeemCode, setRedeemCode] = useState('');
  const [slip, setSlip] = useState('');

  const load = useCallback(async () => {
    const data = await listRewards(businessId);
    setRewards(data.rewards ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  // Business-only module: this tab is only ever mounted on Business
  // plans — the Workforce tab bar hides it entirely on Essentials
  // (the owner's invisibility ruling, Nov 14, 2026), and the server
  // refuses the rewards API off Business the same way.

  const canGive = ctx.level === 'owner' || ctx.level === 'manager';
  const recipients = people.filter((person) => {
    if (person.status !== 'active') return false;
    if (ctx.level === 'owner') return true;
    return person.level === 'staff' && person.id !== ctx.my_staff_id;
  });
  const mine = rewards.filter((reward) => reward.recipient_staff_id === ctx.my_staff_id);
  const canVoid = (reward) =>
    reward.status === 'active' &&
    (ctx.is_owner || (ctx.my_staff_id && reward.giver_staff_id === ctx.my_staff_id));

  const act = async (fn, okMessage) => {
    setBusy(true);
    try {
      await fn();
      if (okMessage) toast({ title: okMessage });
      await load();
    } catch (error) {
      toast({ title: error.message || t('rewards.actionFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const give = () =>
    act(async () => {
      const created = await createReward(businessId, {
        recipient_staff_id: recipientId,
        kind,
        title,
        description,
        percent_value: kind === 'percent_off' ? Number(percent) : undefined,
        amount: kind === 'gift_card' ? Number(amount) : undefined,
        currency: kind === 'gift_card' ? currency : undefined,
        detail: kind === 'custom' ? detail : undefined,
      });
      const name = people.find((p) => p.id === recipientId)?.full_name || '';
      toast({ title: t('rewards.give.sent', { name }) });
      setTitle('');
      setDescription('');
      setDetail('');
      return created;
    }, null);

  const showSlip = (reward) => {
    setSlip(
      buildRewardSlipText(businessName, reward, {
        forLabel: t('rewards.slip.for'),
        codeLabel: t('rewards.slip.code'),
        showLine: t('rewards.slip.show'),
        valueLine: rewardValueText(reward),
      }),
    );
  };

  const printSlip = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const escaped = slip.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    win.document.write(`<pre style="font-family: monospace; font-size: 16px; line-height: 1.6;">${escaped}</pre>`);
    win.document.close();
    win.print();
  };

  const rewardRow = (reward, { showMine = false } = {}) => (
    <li key={reward.id} className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{reward.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{rewardValueText(reward)}</p>
          {reward.description && <p className="mt-0.5 text-sm text-muted-foreground">{reward.description}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {showMine
              ? t('rewards.mine.from', { name: reward.giver_name })
              : t('rewards.history.recipient', { name: reward.recipient_name })}{' '}
            · {formatDay(reward.issued_at)}
          </p>
          {reward.status === 'active' && (
            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">{t('rewards.code')}: </span>
              <span className="rounded-md bg-muted px-2.5 py-1 font-mono text-base font-semibold tracking-widest">
                {reward.code}
              </span>
              {showMine && (
                <span className="ml-2 text-xs text-muted-foreground">{t('rewards.showCode')}</span>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{rewardStatusLabel(reward.status)}</span>
          {reward.status === 'active' && (
            <Button size="sm" variant="outline" onClick={() => showSlip(reward)}>
              {t('rewards.slip.print')}
            </Button>
          )}
          {canVoid(reward) && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => act(() => voidReward(businessId, reward.id), t('rewards.voided'))}
            >
              {t('rewards.void')}
            </Button>
          )}
        </div>
      </div>
    </li>
  );

  if (loading) return <p className="text-sm text-muted-foreground">{t('workforce.loading')}</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('rewards.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('rewards.subtitle')}</p>
      </div>
      {canGive && (
        <Section title={t('rewards.give.title')} help={t('rewards.give.help')}>
          <div className="grid max-w-2xl gap-3">
            <div>
              <label className={labelCls} htmlFor="reward-recipient">{t('rewards.give.recipient')}</label>
              <select id="reward-recipient" className={inputCls} value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
                <option value="">—</option>
                {recipients.map((person) => (
                  <option key={person.id} value={person.id}>{person.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="reward-kind">{t('rewards.give.kind')}</label>
              <select id="reward-kind" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="percent_off">{t('rewards.kind.percentOff')}</option>
                <option value="gift_card">{t('rewards.kind.giftCard')}</option>
                <option value="custom">{t('rewards.kind.custom')}</option>
              </select>
            </div>
            {kind === 'percent_off' && (
              <div>
                <label className={labelCls} htmlFor="reward-percent">{t('rewards.give.percent')}</label>
                <input id="reward-percent" className={inputCls} type="number" min="1" max="100" value={percent} onChange={(e) => setPercent(e.target.value)} />
              </div>
            )}
            {kind === 'gift_card' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="reward-amount">{t('rewards.give.amount')}</label>
                  <input id="reward-amount" className={inputCls} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="reward-currency">{t('rewards.give.currency')}</label>
                  <input id="reward-currency" className={inputCls} value={currency} onChange={(e) => setCurrency(e.target.value)} />
                </div>
              </div>
            )}
            {kind === 'custom' && (
              <div>
                <label className={labelCls} htmlFor="reward-detail">{t('rewards.give.detail')}</label>
                <textarea id="reward-detail" className={inputCls} rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={t('rewards.give.detailPlaceholder')} />
              </div>
            )}
            <div>
              <label className={labelCls} htmlFor="reward-title">{t('rewards.give.titleField')}</label>
              <input id="reward-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('rewards.give.titlePlaceholder')} />
            </div>
            <div>
              <label className={labelCls} htmlFor="reward-description">{t('rewards.give.description')}</label>
              <textarea id="reward-description" className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <Button disabled={busy || !recipientId || !title.trim()} onClick={give}>
                <Gift className="mr-2 h-4 w-4" /> {t('rewards.give.submit')}
              </Button>
            </div>
          </div>
        </Section>
      )}

      {ctx.my_staff_id && (
        <Section title={t('rewards.mine.title')}>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('rewards.mine.empty')}</p>
          ) : (
            <ul className="divide-y divide-border">{mine.map((reward) => rewardRow(reward, { showMine: true }))}</ul>
          )}
        </Section>
      )}

      {canGive && (
        <Section title={t('rewards.redeem.title')} help={t('rewards.redeem.help')}>
          <div className="flex max-w-xl flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <label className={labelCls} htmlFor="reward-redeem-code">{t('rewards.code')}</label>
              <input
                id="reward-redeem-code"
                className={`${inputCls} font-mono uppercase tracking-widest`}
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value)}
                placeholder={t('rewards.redeem.placeholder')}
              />
            </div>
            <Button
              disabled={busy || !redeemCode.trim()}
              onClick={() =>
                act(async () => {
                  await redeemReward(businessId, redeemCode);
                  setRedeemCode('');
                }, t('rewards.redeem.done'))
              }
            >
              <Check className="mr-2 h-4 w-4" /> {t('rewards.redeem.submit')}
            </Button>
          </div>
        </Section>
      )}

      <Section title={t('rewards.history.title')}>
        {rewards.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('rewards.history.empty')}</p>
        ) : (
          <ul className="divide-y divide-border">{rewards.map((reward) => rewardRow(reward))}</ul>
        )}
      </Section>

      {slip && (
        <Section title={t('rewards.slip.print')}>
          <pre className="whitespace-pre-wrap rounded-md border border-dashed border-border bg-background p-4 font-mono text-sm leading-relaxed">{slip}</pre>
          <Button className="mt-3" variant="outline" onClick={printSlip}>
            {t('rewards.slip.print')}
          </Button>
        </Section>
      )}
    </div>
  );
}

const TABS = [
  { id: 'clock', labelKey: 'workforce.tab.clock', icon: Clock3 },
  { id: 'rewards', labelKey: 'workforce.tab.rewards', icon: Gift },
  { id: 'schedule', labelKey: 'workforce.tab.schedule', icon: CalendarClock },
  { id: 'timeoff', labelKey: 'workforce.tab.timeOff', icon: Palmtree },
  { id: 'tasks', labelKey: 'workforce.tab.tasks', icon: ListTodo },
  { id: 'inbox', labelKey: 'workforce.tab.inbox', icon: BellRing },
];

export default function Workforce() {
  const { activeId, record } = useBusiness();
  const { toast } = useToast();
  const { can, isLoading: entitlementLoading } = useEntitlements();
  // Rewards is Business-only and INVISIBLE off Business (the owner's
  // ruling, Nov 14, 2026): the tab does not appear at all on other
  // plans — while entitlements are still loading the plan is unknown,
  // so the tab stays hidden until Business is confirmed.
  const showRewards = !entitlementLoading && can('rewards');
  // The header Messages door (owner's ruling, Nov 19, 2026)
  // arrives here with the inbox asked for by name; honor it on
  // every arrival, not just the first mount, so tapping the door
  // while already on this page switches to the inbox too.
  const location = useLocation();
  const [tab, setTab] = useState(() => (location.state?.workforceTab === 'inbox' ? 'inbox' : 'clock'));
  useEffect(() => {
    if (location.state?.workforceTab === 'inbox') setTab('inbox');
  }, [location]);
  const [ctx, setCtx] = useState(null);
  const [people, setPeople] = useState([]);
  const [unread, setUnread] = useState(0);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  const loadMeta = useCallback(async () => {
    if (!activeId) return;
    try {
      const [c, p, n, s, mu] = await Promise.all([
        getWorkforceContext(activeId),
        listPeople(activeId),
        listNotifications(activeId),
        getWorkforceSettings(activeId),
        getMessageUnread(activeId).catch(() => ({ unread: 0 })),
      ]);
      setCtx(c);
      setPeople(p.people ?? []);
      setUnread((n.unread ?? 0) + (mu.unread ?? 0));
      setSettings(s);
    } catch {
      setError(t('workforce.loadError'));
    }
  }, [activeId]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);

  if (!activeId || (!ctx && !error)) {
    return <p className="text-sm text-muted-foreground">{t('workforce.loading')}</p>;
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">{t('workforce.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('workforce.subtitle')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.filter(({ id }) => id !== 'rewards' || showRewards).map(({ id, labelKey, icon: Icon }) => (
          <Button key={id} variant={tab === id ? 'default' : 'outline'} size="sm" onClick={() => setTab(id)}>
            <Icon className="mr-1.5 h-4 w-4" />
            {t(labelKey)}
            {id === 'inbox' && unread > 0 ? ` (${unread})` : ''}
          </Button>
        ))}
      </div>

      {tab === 'clock' && <ClockTab businessId={activeId} ctx={ctx} peopleById={peopleById} onEvent={loadMeta} />}
      {tab === 'schedule' && <ScheduleTab businessId={activeId} ctx={ctx} people={people} />}
      {tab === 'timeoff' && <TimeOffTab businessId={activeId} ctx={ctx} peopleById={peopleById} />}
      {tab === 'tasks' && <TasksTab businessId={activeId} ctx={ctx} people={people} peopleById={peopleById} />}
      {tab === 'inbox' && <InboxTab businessId={activeId} ctx={ctx} people={people} onRead={loadMeta} onGoTab={setTab} />}
      {tab === 'rewards' && showRewards && (
        <RewardsTab businessId={activeId} ctx={ctx} people={people} businessName={record?.name || ''} />
      )}

      {ctx.is_owner && settings && (
        <Section title={t('workforce.settings.title')}>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={settings.self_clock_enabled !== false}
              onChange={async (event) => {
                try {
                  const saved = await updateWorkforceSettings(activeId, {
                    self_clock_enabled: event.target.checked,
                  });
                  setSettings(saved);
                  toast({ title: t('workforce.settings.saved') });
                } catch (err) {
                  toast({ title: err.message || t('workforce.actionFailed'), variant: 'destructive' });
                }
              }}
            />
            <span>
              <span className="font-medium">{t('workforce.settings.selfClock')}</span>
              <span className="block text-xs text-muted-foreground">{t('workforce.settings.selfClockHelp')}</span>
            </span>
          </label>
        </Section>
      )}
    </div>
  );
}
