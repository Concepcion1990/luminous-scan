/**
 * Training — step-by-step lessons for every part of the app,
 * matched to your role (Training phase).
 *
 * Three tracks: staff see the staff track; managers see manager +
 * staff; the owner sees all three. What you see is decided on the
 * server — this page renders the state it is given. Assignments
 * (from a role growing, or assigned by the owner/manager) come
 * first, with their deadlines. Owners and managers also get Team
 * progress: who finished what, assigning, deadlines, warnings.
 *
 * The design rule for this page is the owner's: roomy and calm.
 * One lesson opens at a time; everything else waits quietly.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlarmClock, BellRing, Check, ChevronDown, Flag, GraduationCap, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useBusiness } from '@/hooks/useBusiness';
import { t } from '@/lib/i18n';
import { toLocalDate } from '@/lib/dates';
import { TRAINING_LESSONS, lessonsForTrack } from '@/lib/trainingCatalog';
import {
  assignTraining,
  completeLesson,
  getTeamProgress,
  getTrainingState,
  lessonById,
  lessonSteps,
  lessonTitle,
  moduleLabel,
  setAssignmentDeadline,
  trackHelp,
  trackTitle,
  warnAssignment,
} from '@/lib/training';

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const labelCls = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';

function formatDay(value) {
  const date = toLocalDate(value);
  if (!date) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function Section({ title, help, children, icon: Icon }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5 text-primary" aria-hidden />}
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
      </div>
      {help && <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{help}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DueChip({ assignment }) {
  if (assignment.status === 'completed') return null;
  if (!assignment.due_date) {
    return <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{t('training.noDue')}</span>;
  }
  if (assignment.overdue) {
    return (
      <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-900 dark:bg-red-900/40 dark:text-red-100">
        {t('training.due', { date: formatDay(assignment.due_date) })} · {t('training.overdue')}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
      {t('training.due', { date: formatDay(assignment.due_date) })}
    </span>
  );
}

function LessonCard({ lesson, done, completedAt, open, onToggle, onComplete, busy }) {
  return (
    <div className="rounded-lg border border-border bg-background">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
        aria-expanded={open}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            done ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100' : 'bg-muted text-muted-foreground'
          }`}
        >
          {done ? <Check className="h-4 w-4" /> : <GraduationCap className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{lessonTitle(lesson)}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {moduleLabel(lesson.module)}
            {done && completedAt ? ` · ${t('training.finishedOn', { date: formatDay(completedAt) })}` : ''}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-4 sm:px-5">
          <p className={labelCls}>{t('training.steps')}</p>
          <ol className="mt-2.5 space-y-2.5">
            {lessonSteps(lesson).map((step, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          {!done && (
            <Button className="mt-4" onClick={() => onComplete(lesson)} disabled={busy}>
              <Check className="mr-1.5 h-4 w-4" /> {t('training.markDone')}
            </Button>
          )}
          {done && (
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1.5 text-sm text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
              <Check className="h-4 w-4" /> {t('training.done')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MyAssignments({ assignments, completedSet }) {
  const open = assignments.filter((a) => a.status !== 'completed');
  if (!open.length) return null;
  return (
    <Section title={t('training.newForYou')} help={t('training.newForYouHelp')} icon={Sparkles}>
      <div className="space-y-4">
        {open.map((assignment) => (
          <div key={assignment.id} className="rounded-lg border border-border bg-background p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{moduleLabel(assignment.module)}</h3>
              <DueChip assignment={assignment} />
              {assignment.warning_sent_at && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs text-red-900 dark:bg-red-900/40 dark:text-red-100">
                  <AlarmClock className="h-3.5 w-3.5" />
                  {t('training.warningSentOn', { date: formatDay(assignment.warning_sent_at) })}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {assignment.source === 'role_grant'
                ? t('training.sourceRole')
                : t('training.assignedBy', { name: assignment.assigned_by_name || '' })}
            </p>
            <ul className="mt-3 space-y-1.5">
              {assignment.lesson_ids.map((id) => {
                const lesson = lessonById(id);
                if (!lesson) return null;
                const done = completedSet.has(id);
                return (
                  <li key={id} className="flex items-center gap-2 text-sm">
                    {done ? (
                      <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full border border-border" />
                    )}
                    <span className={done ? 'text-muted-foreground line-through' : ''}>{lessonTitle(lesson)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function AssignmentRow({ businessId, assignment, reload }) {
  const { toast } = useToast();
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (fn, okKey, failKey) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: t(okKey) });
      await reload();
    } catch (error) {
      toast({ title: error.message || t(failKey), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{moduleLabel(assignment.module)}</span>
        <DueChip assignment={assignment} />
        {assignment.warning_sent_at && (
          <span className="text-xs text-muted-foreground">
            {t('training.warningSentOn', { date: formatDay(assignment.warning_sent_at) })}
          </span>
        )}
      </div>
      {assignment.status !== 'completed' && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className={labelCls}>{t('training.team.days')}</span>
            <input
              type="number"
              min="1"
              max="365"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={`${inputCls} mt-1 w-28`}
              placeholder="7"
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !days}
            onClick={() =>
              act(
                () => setAssignmentDeadline(businessId, assignment.id, { due_in_days: Number(days) }),
                'training.team.deadlineSaved',
                'training.team.deadlineFailed',
              )
            }
          >
            {t('training.team.deadlineSave')}
          </Button>
          {assignment.overdue && (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                act(() => warnAssignment(businessId, assignment.id), 'training.team.warnedToast', 'training.team.warnFailed')
              }
            >
              <BellRing className="mr-1.5 h-4 w-4" /> {t('training.team.warn')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function TeamSection({ businessId, level }) {
  const { toast } = useToast();
  const [team, setTeam] = useState(null);
  const [personId, setPersonId] = useState('');
  const [module, setModule] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await getTeamProgress(businessId);
    setTeam(data.people ?? []);
  }, [businessId]);

  useEffect(() => {
    load().catch(() => setTeam([]));
  }, [load]);

  const assignable = useMemo(() => {
    if (!team) return [];
    // The server enforces the same rule; the picker just mirrors it:
    // owners may train anyone, managers only staff.
    return level === 'owner' ? team : team.filter((p) => p.level === 'staff');
  }, [team, level]);

  const modules = useMemo(() => [...new Set(TRAINING_LESSONS.map((l) => l.module))].sort(), []);

  const submitAssign = async () => {
    if (!personId || !module) return;
    setBusy(true);
    try {
      await assignTraining(businessId, {
        staff_member_id: personId,
        module,
        ...(days ? { due_in_days: Number(days) } : {}),
      });
      toast({ title: t('training.team.assignedToast') });
      setModule('');
      setDays('');
      await load();
    } catch (error) {
      toast({ title: error.message || t('training.team.assignFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (!team) return null;
  return (
    <Section title={t('training.team.title')} help={t('training.team.help')} icon={Flag}>
      <div className="rounded-lg border border-border bg-background p-4 sm:p-5">
        <h3 className="text-sm font-semibold">{t('training.team.assignTitle')}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <label className="block">
            <span className={labelCls}>{t('training.team.person')}</span>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">—</option>
              {assignable.map((p) => (
                <option key={p.staff_id} value={p.staff_id}>
                  {p.full_name} ({p.role_name})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>{t('training.team.module')}</span>
            <select value={module} onChange={(e) => setModule(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">—</option>
              {modules.map((m) => (
                <option key={m} value={m}>
                  {moduleLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>{t('training.team.days')}</span>
            <input
              type="number"
              min="1"
              max="365"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={`${inputCls} mt-1 w-24`}
              placeholder="7"
            />
          </label>
          <Button onClick={submitAssign} disabled={busy || !personId || !module}>
            {t('training.team.assign')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t('training.team.daysHint')}</p>
      </div>

      <div className="mt-5 space-y-5">
        {!team.length && <p className="text-sm text-muted-foreground">{t('training.team.none')}</p>}
        {team.map((person) => (
          <div key={person.staff_id} className="rounded-lg border border-border p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold">
                {person.full_name}
                <span className="ml-2 text-sm font-normal text-muted-foreground">{person.role_name}</span>
              </h3>
              <span className="text-sm text-muted-foreground">
                {t('training.lessonsDoneOf', { done: person.lessons_done, total: person.lessons_total })}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${person.lessons_total ? Math.round((person.lessons_done / person.lessons_total) * 100) : 0}%` }}
              />
            </div>
            {person.assignments.filter((a) => a.status !== 'completed').length > 0 && (
              <>
                <p className={`${labelCls} mt-4`}>{t('training.team.openAssignments')}</p>
                <div className="mt-2 space-y-2.5">
                  {person.assignments
                    .filter((a) => a.status !== 'completed')
                    .map((assignment) => (
                      <AssignmentRow
                        key={assignment.id}
                        businessId={businessId}
                        assignment={assignment}
                        reload={load}
                      />
                    ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

export default function Training() {
  const { activeId } = useBusiness();
  const { toast } = useToast();
  const [state, setState] = useState(null);
  const [failed, setFailed] = useState(false);
  const [openLesson, setOpenLesson] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) return;
    const data = await getTrainingState(activeId);
    setState(data);
  }, [activeId]);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  const completedSet = useMemo(() => new Set(state?.completed_lesson_ids ?? []), [state]);
  const completedAtById = useMemo(() => {
    const map = new Map();
    for (const row of state?.completions ?? []) map.set(row.lesson_id, row.completed_at);
    return map;
  }, [state]);

  const onComplete = async (lesson) => {
    setBusy(true);
    try {
      await completeLesson(activeId, lesson.id);
      toast({ title: t('training.markedDone') });
      await load();
    } catch (error) {
      toast({ title: error.message || t('training.loadFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (!activeId || (!state && !failed)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <p className="text-sm text-muted-foreground">{t('training.loading')}</p>
      </div>
    );
  }
  if (failed || !state) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <p className="text-sm text-destructive">{t('training.loadFailed')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">{t('training.title')}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t('training.subtitle')}</p>
      </header>

      <MyAssignments assignments={state.assignments} completedSet={completedSet} />

      {state.tracks.map((track) => {
        const lessons = lessonsForTrack(track);
        const doneCount = lessons.filter((l) => completedSet.has(l.id)).length;
        return (
          <Section
            key={track}
            title={trackTitle(track)}
            help={`${trackHelp(track)} ${t('training.lessonsDoneOf', { done: doneCount, total: lessons.length })}`}
          >
            <div className="space-y-3">
              {lessons.map((lesson) => (
                <LessonCard
                  key={lesson.id}
                  lesson={lesson}
                  done={completedSet.has(lesson.id)}
                  completedAt={completedAtById.get(lesson.id)}
                  open={openLesson === lesson.id}
                  onToggle={() => setOpenLesson(openLesson === lesson.id ? null : lesson.id)}
                  onComplete={onComplete}
                  busy={busy}
                />
              ))}
              {!lessons.length && <p className="text-sm text-muted-foreground">{t('training.empty')}</p>}
            </div>
          </Section>
        );
      })}

      {(state.level === 'owner' || state.level === 'manager') && (
        <TeamSection businessId={activeId} level={state.level} />
      )}
    </div>
  );
}
