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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BellRing, CalendarClock, Check, Clock3, ListTodo, MessageCircle, Palmtree, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useBusiness } from '@/hooks/useBusiness';
import { t } from '@/lib/i18n';
import { toLocalDate } from '@/lib/dates';
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
  requestTimeOff,
  saveSchedule,
  setTaskStatus,
  startMessageThread,
  timeOffStatusLabel,
  updateWorkforceSettings,
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

  const act = async (fn, okMessage) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: okMessage });
      setNote('');
      await load();
      onEvent();
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

  return (
    <div className="space-y-4">
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
            <Button disabled={busy || selfOff} onClick={() => act(() => clockIn(businessId), t('workforce.clockedInMsg'))}>
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
              onClick={() => act(() => clockOut(businessId, note), t('workforce.clockedOutMsg'))}
            >
              {t('workforce.clockOut')}
            </Button>
          </div>
        )}
      </Section>

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
                    </span>
                    {entry.unscheduled && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t('workforce.entries.unscheduled')}</span>
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
                      {t('workforce.schedule.off')}
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
  const [tasks, setTasks] = useState([]);
  const [form, setForm] = useState({ staff_member_id: '', title: '', notes: '', due_date: '' });
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
      setForm({ staff_member_id: '', title: '', notes: '', due_date: '' });
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
    </div>
  );
}

function InboxTab({ businessId, ctx, people, onRead }) {
  const { toast } = useToast();
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
              <li key={item.id} className={`flex items-center gap-3 py-3 text-sm ${item.is_read ? 'opacity-60' : ''}`}>
                <BellRing className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1">
                  {item.detail}
                  <span className="block text-xs text-muted-foreground">
                    {formatDay(item.created_at)} {formatTime(item.created_at)}
                  </span>
                </span>
                {!item.is_read && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await markNotificationRead(businessId, item.id).catch(() => {});
                      await loadNotifications();
                      onRead();
                    }}
                  >
                    {t('workforce.inbox.markRead')}
                  </Button>
                )}
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
                    {!ctx.is_owner && <option value="owner">{t('workforce.messages.owner')}</option>}
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
                      <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{threadTitle(thread)}</span>
                        {thread.oversight && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                            {t('workforce.messages.oversight')}
                          </span>
                        )}
                        <span className="block truncate text-xs text-muted-foreground">
                          {thread.last_message
                            ? `${thread.last_message.sender_name}: ${thread.last_message.body}`
                            : t('workforce.messages.emptyThread')}
                        </span>
                      </span>
                      {thread.last_message_at && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDay(thread.last_message_at)} {formatTime(thread.last_message_at)}
                        </span>
                      )}
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
                {threadMessages.map((message) => (
                  <li key={message.id} className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
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
                      <span className="whitespace-pre-wrap">{message.body}</span>
                      <span className="mt-1 block text-[11px] opacity-60">
                        {formatDay(message.created_at)} {formatTime(message.created_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {activeThread.can_post && (
              <div className="mt-5 flex items-end gap-2">
                <textarea
                  className={inputCls}
                  rows={2}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('workforce.messages.placeholder')}
                />
                <Button disabled={busy || !draft.trim()} onClick={send}>
                  <Send className="mr-1.5 h-4 w-4" /> {t('workforce.messages.send')}
                </Button>
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

const TABS = [
  { id: 'clock', labelKey: 'workforce.tab.clock', icon: Clock3 },
  { id: 'schedule', labelKey: 'workforce.tab.schedule', icon: CalendarClock },
  { id: 'timeoff', labelKey: 'workforce.tab.timeOff', icon: Palmtree },
  { id: 'tasks', labelKey: 'workforce.tab.tasks', icon: ListTodo },
  { id: 'inbox', labelKey: 'workforce.tab.inbox', icon: BellRing },
];

export default function Workforce() {
  const { activeId } = useBusiness();
  const { toast } = useToast();
  const [tab, setTab] = useState('clock');
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
        {TABS.map(({ id, labelKey, icon: Icon }) => (
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
      {tab === 'inbox' && <InboxTab businessId={activeId} ctx={ctx} people={people} onRead={loadMeta} />}

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
