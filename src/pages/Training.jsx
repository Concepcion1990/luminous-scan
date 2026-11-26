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
import { AlarmClock, BellRing, Check, ChevronDown, Flag, GraduationCap, Printer, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useBusiness } from '@/hooks/useBusiness';
import { apiRequest } from '@/api/client';
import { t } from '@/lib/i18n';
import { formatShortDate } from '@/lib/dates';
import { resolveDocStyle } from '@/lib/docStyle';
import TrainingRecordDoc from '@/components/print/TrainingRecordDoc';
import { TRAINING_HEADINGS, TRAINING_LESSONS, lessonHeading, lessonVisibleOnPlan, visibleLessonsForTrack } from '@/lib/trainingCatalog';
import { OwnTrainingBox, OwnTrainingCards } from '@/components/training/OwnTraining';
import {
  addLessonComment,
  assignTraining,
  checkPolicyAnswer,
  completeLesson,
  getLessonQuiz,
  getPolicyTraining,
  getTeamMemberResults,
  getTeamProgress,
  getTrainingState,
  lessonById,
  lessonSteps,
  lessonTitle,
  moduleLabel,
  reviewPolicyAttempt,
  setAssignmentDeadline,
  submitLessonQuiz,
  submitPolicyTraining,
  trackHelp,
  trackTitle,
  warnAssignment,
} from '@/lib/training';

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const labelCls = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';

function formatDay(value) {
  return formatShortDate(value);
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

function stepText(ref) {
  return t(`training.lessons.${ref.lesson_id}.step${ref.step}`);
}

const QUIZ_PROMPT_KEY = {
  belongs: 'training.quiz.belongs',
  notBelongs: 'training.quiz.notBelongs',
  order: 'training.quiz.order',
};

/**
 * The per-lesson quiz (Nov 20, 2026): a lesson counts complete
 * only when its quiz is answered correctly — retry until pass.
 * The questions quote the app's own lesson steps by reference and
 * the server scores them; no answer key ever reaches this page.
 */
function QuizPanel({ businessId, lesson, onPassed }) {
  const { toast } = useToast();
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setResult(null);
    try {
      const data = await getLessonQuiz(businessId, lesson.id);
      setQuiz(data);
      setAnswers(new Array((data.questions || []).length).fill(null));
    } catch {
      setFailed(true);
    }
  }, [businessId, lesson.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (failed) {
    return <p className="mt-4 text-sm text-destructive">{t('training.loadFailed')}</p>;
  }
  if (!quiz) {
    return <p className="mt-4 text-sm text-muted-foreground">{t('training.loading')}</p>;
  }

  const submit = async () => {
    setBusy(true);
    try {
      const data = await submitLessonQuiz(businessId, lesson.id, answers);
      if (data.passed) {
        toast({ title: t('training.quiz.passed') });
        await onPassed();
      } else {
        setResult(data);
      }
    } catch (error) {
      toast({ title: error.message || t('training.loadFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-5 rounded-lg border border-border bg-card p-4">
      <p className={labelCls}>{t('training.quiz.title')}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t('training.quiz.intro')}</p>
      <div className="mt-3 space-y-4">
        {quiz.questions.map((question, qi) => (
          <fieldset key={qi}>
            <legend className="text-sm font-medium">
              {qi + 1}. {t(QUIZ_PROMPT_KEY[question.type] || 'training.quiz.belongs')}
            </legend>
            <div className="mt-2 space-y-1.5">
              {question.options.map((option, oi) => (
                <label
                  key={oi}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm leading-relaxed ${
                    answers[qi] === oi ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <input
                    type="radio"
                    name={`quiz-${lesson.id}-${qi}`}
                    className="mt-1"
                    checked={answers[qi] === oi}
                    onChange={() => {
                      setAnswers((current) => {
                        const next = [...current];
                        next[qi] = oi;
                        return next;
                      });
                      setResult(null);
                    }}
                  />
                  <span>{stepText(option)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      {result && !result.passed && (
        <p className="mt-3 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
          {t('training.quiz.failed', { correct: result.correct, total: result.total })}
        </p>
      )}
      <Button className="mt-4" onClick={submit} disabled={busy || answers.some((a) => a === null)}>
        {t('training.quiz.submit')}
      </Button>
    </div>
  );
}

/** A comment on a lesson, filed quietly to the owner (Nov 20,
 *  2026) — it lands in the person's staff record; no bell rings. */
function CommentBox({ businessId, lesson, mine }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await addLessonComment(businessId, lesson.id, draft.trim());
      setDraft('');
      setSent(true);
      toast({ title: t('training.comment.sent') });
    } catch (error) {
      toast({ title: error.message || t('training.loadFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className={labelCls}>{t('training.comment.title')}</p>
      {mine?.length ? (
        <ul className="mt-2 space-y-1.5">
          {mine.map((comment, i) => (
            <li key={i} className="rounded-md bg-muted px-3 py-2 text-sm leading-relaxed">
              {comment.body}
              <span className="mt-0.5 block text-xs text-muted-foreground">{formatDay(comment.created_at)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {sent && <p className="mt-2 text-sm text-ok">{t('training.comment.sent')}</p>}
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={t('training.comment.placeholder')}
        rows={2}
        className="mt-2"
        maxLength={1000}
      />
      <Button size="sm" variant="outline" className="mt-2" onClick={send} disabled={busy || !draft.trim()}>
        {t('training.comment.send')}
      </Button>
    </div>
  );
}

function LessonCard({ businessId, lesson, visibleSteps, done, completedAt, open, onToggle, onComplete, onPassed, busy, isOwner, myComments }) {
  const steps = lessonSteps(lesson);
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
            done ? 'bg-ok/12 text-ok' : 'bg-muted text-muted-foreground'
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
            {steps.map((stepText, i) => {
              // Steps are scoped to the reader's doors too: a
              // step they cannot perform is not rendered (the
              // server sends the visible step numbers).
              if (visibleSteps && !visibleSteps.includes(i + 1)) return null;
              return (
                <li key={i} className="flex gap-3 text-sm leading-relaxed">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">
                    {stepText}
                  </span>
                </li>
              );
            })}
          </ol>
          {!done && isOwner && (
            <Button className="mt-4" onClick={() => onComplete(lesson)} disabled={busy}>
              <Check className="mr-1.5 h-4 w-4" /> {t('training.markDone')}
            </Button>
          )}
          {!done && !isOwner && (
            <QuizPanel businessId={businessId} lesson={lesson} onPassed={onPassed} />
          )}
          {done && (
            <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ok/12 px-3 py-1.5 text-sm text-ok">
              <Check className="h-4 w-4" /> {t('training.done')}
            </p>
          )}
          {!isOwner && <CommentBox businessId={businessId} lesson={lesson} mine={myComments} />}
        </div>
      )}
    </div>
  );
}

function MyAssignments({ businessId, assignments, completedSet, completedAtById, openLesson, onToggleLesson, onComplete, onPassed, busy, isOwner, visibleStepsFor, commentsByLesson }) {
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
            {/* Assigned lessons OPEN here, in full — steps
                and the finish button — even when the lesson's track
                sits above the assignee's current role (owner ruling,
                Nov 15, 2026: assign everything, and what is assigned
                must be learnable). A title-only checklist left a
                staff member holding manager lessons they could
                never read. */}
            <div className="mt-3 space-y-3">
              {assignment.lesson_ids.map((id) => {
                const lesson = lessonById(id);
                if (!lesson) return null;
                return (
                  <LessonCard
                    key={id}
                    businessId={businessId}
                    lesson={lesson}
                    visibleSteps={visibleStepsFor(lesson)}
                    done={completedSet.has(id)}
                    completedAt={completedAtById.get(id)}
                    open={openLesson === id}
                    onToggle={() => onToggleLesson(id)}
                    onComplete={onComplete}
                    onPassed={onPassed}
                    busy={busy}
                    isOwner={isOwner}
                    myComments={commentsByLesson.get(id)}
                  />
                );
              })}
            </div>
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

const POLICY_DOCS = [
  { kind: 'policies', headingKey: 'settings.policies.storePolicies' },
  { kind: 'terms', headingKey: 'settings.policies.termsConditions' },
];

/**
 * One owner's-quiz training (Nov 20, 2026): read the owner's
 * document, then answer her questions. Multiple choice is
 * checked on the spot — a wrong pick is flagged and retried, a
 * right one locks in. Typed answers go in with the submit; one
 * that matches hers nearly word for word counts on the spot, and
 * one that does not still lets the training close — it files to
 * the owner flagged for review instead of trapping the person.
 */
function PolicyTrainingCard({ businessId, doc, onDone, onVisibility }) {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [docState, setDocState] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState({});
  const [wrong, setWrong] = useState({});
  const [texts, setTexts] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getPolicyTraining(businessId, doc.kind);
      setData(next);
      onVisibility?.(doc.kind, true);
    } catch {
      // Not ticked for this training — the card simply is not theirs.
      setHidden(true);
      onVisibility?.(doc.kind, false);
    }
    try {
      const policies = await apiRequest(`/api/businesses/${encodeURIComponent(businessId)}/policies`);
      setDocState(policies?.[doc.kind] || null);
    } catch {
      setDocState(null);
    }
  }, [businessId, doc.kind, onVisibility]);

  useEffect(() => {
    load();
  }, [load]);

  if (hidden || !data) return null;
  const attempt = data.latest_attempt;
  const finished = attempt?.status === 'passed';
  const sentBack = attempt?.status === 'sent_back';

  const pick = async (question, choiceIndex) => {
    if (picks[question.id] !== undefined) return;
    try {
      const { correct } = await checkPolicyAnswer(businessId, doc.kind, question.id, choiceIndex);
      if (correct) {
        setPicks((current) => ({ ...current, [question.id]: choiceIndex }));
        setWrong((current) => ({ ...current, [question.id]: false }));
      } else {
        setWrong((current) => ({ ...current, [question.id]: true }));
      }
    } catch (error) {
      toast({ title: error.message || t('training.loadFailed'), variant: 'destructive' });
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const answers = data.questions.map((q) =>
        q.kind === 'mc'
          ? { question_id: q.id, choice_index: picks[q.id] }
          : { question_id: q.id, text: texts[q.id] || '' },
      );
      const next = await submitPolicyTraining(businessId, doc.kind, answers);
      setResult(next);
      if (next.status === 'passed') {
        toast({ title: t('training.quiz.passed') });
        await load();
        await onDone?.();
      }
    } catch (error) {
      toast({ title: error.message || t('training.loadFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const allPicked = data.questions
    .filter((q) => q.kind === 'mc')
    .every((q) => picks[q.id] !== undefined);

  return (
    <div className="rounded-lg border border-border bg-background">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
        aria-expanded={open}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            finished ? 'bg-ok/12 text-ok' : 'bg-muted text-muted-foreground'
          }`}
        >
          {finished ? <Check className="h-4 w-4" /> : <GraduationCap className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{t(doc.headingKey)}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {finished
              ? attempt.score_percent !== null && attempt.score_percent !== undefined
                ? `${t('training.done')} · ${t('training.policy.score', { score: attempt.score_percent })}`
                : t('training.done')
              : sentBack
                ? t('training.policy.sentBack')
                : t('training.policy.passLine', { percent: data.pass_percent })}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-border px-4 py-4 sm:px-5">
          {sentBack && attempt.review_note ? (
            <p className="mb-3 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
              {attempt.review_note}
            </p>
          ) : null}
          {finished && attempt.needs_review ? (
            <p className="mb-3 text-sm text-muted-foreground">{t('training.policy.reviewWaiting')}</p>
          ) : null}
          <p className={labelCls}>{t('training.policy.read')}</p>
          {docState?.kind === 'text' ? (
            <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm leading-relaxed">
              {docState.text}
            </div>
          ) : docState?.kind === 'file' ? (
            <p className="mt-2 text-sm text-muted-foreground">{docState.filename}</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t('training.policy.noDocument')}</p>
          )}
          {!finished && (
            <>
              {data.questions.length === 0 ? (
                <>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t('training.policy.noQuestions')}</p>
                  <Button className="mt-3" onClick={submit} disabled={busy}>
                    {t('training.policy.markRead')}
                  </Button>
                </>
              ) : (
                <>
                  <div className="mt-4 space-y-4">
                    {data.questions.map((q, qi) => (
                      <fieldset key={q.id}>
                        <legend className="text-sm font-medium">{qi + 1}. {q.question}</legend>
                        {q.kind === 'mc' ? (
                          <div className="mt-2 space-y-1.5">
                            {q.choices.map((choice, ci) => (
                              <button
                                key={ci}
                                type="button"
                                disabled={picks[q.id] !== undefined}
                                onClick={() => pick(q, ci)}
                                className={`block w-full rounded-md border px-3 py-2 text-left text-sm leading-relaxed ${
                                  picks[q.id] === ci
                                    ? 'border-ok bg-ok/10'
                                    : 'border-border hover:border-primary'
                                }`}
                              >
                                {'ABCD'[ci]}. {choice}
                              </button>
                            ))}
                            {wrong[q.id] ? (
                              <p className="text-sm text-destructive">{t('training.policy.wrongPick')}</p>
                            ) : null}
                            {picks[q.id] !== undefined ? (
                              <p className="text-sm text-ok">{t('training.policy.rightPick')}</p>
                            ) : null}
                          </div>
                        ) : (
                          <Textarea
                            value={texts[q.id] || ''}
                            onChange={(event) => setTexts((current) => ({ ...current, [q.id]: event.target.value }))}
                            rows={2}
                            className="mt-2"
                            maxLength={1000}
                          />
                        )}
                      </fieldset>
                    ))}
                  </div>
                  {result?.status === 'below_line' && (
                    <p className="mt-3 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
                      {t('training.policy.score', { score: result.score_percent })} ·{' '}
                      {t('training.policy.passLine', { percent: result.pass_percent })} {t('training.policy.belowLine')}
                    </p>
                  )}
                  <Button className="mt-4" onClick={submit} disabled={busy || !allPicked}>
                    {t('training.policy.submitAnswers')}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PolicyTrainings({ businessId, onDone }) {
  // The section shell shows only when at least one of its cards is
  // really the person's (Nov 21, 2026): a member ticked for neither
  // quiz training must not meet an empty section.
  const [visible, setVisible] = useState({});
  const report = useCallback((kind, isVisible) => {
    setVisible((current) => (current[kind] === isVisible ? current : { ...current, [kind]: isVisible }));
  }, []);
  const cards = (
    <div className="space-y-3">
      {POLICY_DOCS.map((doc) => (
        <PolicyTrainingCard key={doc.kind} businessId={businessId} doc={doc} onDone={onDone} onVisibility={report} />
      ))}
    </div>
  );
  if (!Object.values(visible).some(Boolean)) return cards;
  return (
    <Section title={t('training.policy.sectionTitle')} help={t('training.policy.sectionHelp')} icon={GraduationCap}>
      {cards}
    </Section>
  );
}

/**
 * One person's filed training record (Nov 20, 2026): quiz
 * results, lesson comments, and the owner's-quiz attempts with
 * the answers themselves. The owner and managers read it; review
 * actions (accept / send back) are the owner's alone.
 */
function PersonRecord({ businessId, staffId, level }) {
  const { toast } = useToast();
  const [record, setRecord] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRecord(await getTeamMemberResults(businessId, staffId));
    } catch {
      setRecord({ quiz_results: [], comments: [], policy_attempts: [] });
    }
  }, [businessId, staffId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!record) return <p className="mt-3 text-sm text-muted-foreground">{t('training.loading')}</p>;
  const empty = !record.quiz_results.length && !record.comments.length && !record.policy_attempts.length;

  const review = async (attemptId, action) => {
    setBusy(true);
    try {
      await reviewPolicyAttempt(businessId, attemptId, { action, note });
      setNote('');
      toast({ title: t('settings.save.saved') });
      await load();
    } catch (error) {
      toast({ title: error.message || t('training.loadFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-3">
      {empty && <p className="text-sm text-muted-foreground">{t('training.team.recordNone')}</p>}
      {record.quiz_results.length > 0 && (
        <div>
          <p className={labelCls}>{t('training.team.recordQuiz')}</p>
          <ul className="mt-2 space-y-1.5">
            {record.quiz_results.map((row, i) => {
              const lesson = lessonById(row.lesson_id);
              return (
                <li key={i} className="flex flex-wrap items-center gap-x-2 text-sm">
                  <span className="font-medium">{lesson ? lessonTitle(lesson) : row.lesson_id}</span>
                  <span className="text-muted-foreground">
                    {t('training.team.scoreOf', { correct: row.correct, total: row.total })} · {formatDay(row.created_at)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      row.passed ? 'bg-ok/12 text-ok' : 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100'
                    }`}
                  >
                    {row.passed ? t('training.team.passed') : t('training.team.notPassed')}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {record.comments.length > 0 && (
        <div>
          <p className={labelCls}>{t('training.team.recordComments')}</p>
          <ul className="mt-2 space-y-1.5">
            {record.comments.map((row, i) => {
              const lesson = lessonById(row.lesson_id);
              return (
                <li key={i} className="rounded-md bg-muted px-3 py-2 text-sm leading-relaxed">
                  <span className="font-medium">{lesson ? lessonTitle(lesson) : row.lesson_id}: </span>
                  {row.body}
                  <span className="mt-0.5 block text-xs text-muted-foreground">{formatDay(row.created_at)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {record.policy_attempts.length > 0 && (
        <div>
          <p className={labelCls}>{t('training.team.recordPolicy')}</p>
          <div className="mt-2 space-y-3">
            {record.policy_attempts.map((attempt) => (
              <div key={attempt.id} className="rounded-md border border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium">
                    {t(attempt.doc_kind === 'policies' ? 'settings.policies.storePolicies' : 'settings.policies.termsConditions')}
                  </span>
                  {attempt.score_percent !== null && attempt.score_percent !== undefined && (
                    <span className="text-muted-foreground">{t('training.policy.score', { score: attempt.score_percent })}</span>
                  )}
                  <span className="text-muted-foreground">{formatDay(attempt.created_at)}</span>
                  {attempt.status === 'passed' && (
                    <span className="rounded-full bg-ok/12 px-2 py-0.5 text-xs text-ok">{t('training.team.passed')}</span>
                  )}
                  {attempt.status === 'below_line' && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900 dark:bg-red-900/40 dark:text-red-100">
                      {t('training.team.belowLineChip')}
                    </span>
                  )}
                  {attempt.status === 'sent_back' && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                      {t('training.team.sentBackChip')}
                    </span>
                  )}
                  {attempt.needs_review && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                      {t('training.team.needsReview')}
                    </span>
                  )}
                </div>
                {Array.isArray(attempt.answers) && attempt.answers.length > 0 && (
                  <ul className="mt-2 space-y-2">
                    {attempt.answers.map((answer, i) => (
                      <li key={i} className="text-sm leading-relaxed">
                        <span className="font-medium">{answer.question}</span>
                        {answer.kind === 'mc' ? (
                          <span className="block text-muted-foreground">
                            {t('training.team.theirChoice')}:{' '}
                            {answer.choice_index !== null && answer.choice_index !== undefined
                              ? answer.choices?.[answer.choice_index] || ''
                              : '—'}{' '}
                            · {answer.correct ? t('training.team.passed') : t('training.team.notPassed')}
                          </span>
                        ) : (
                          <>
                            <span className="block text-muted-foreground">
                              {t('training.team.theirAnswer')}: {answer.text || '—'}
                            </span>
                            <span className="block text-muted-foreground">
                              {t('training.team.expectedAnswer')}: {answer.expected_answer}
                            </span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {attempt.needs_review && level === 'owner' && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="block min-w-48 flex-1">
                      <span className={labelCls}>{t('training.team.reviewNote')}</span>
                      <input
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        className={`${inputCls} mt-1`}
                        maxLength={500}
                      />
                    </label>
                    <Button size="sm" disabled={busy} onClick={() => review(attempt.id, 'accept')}>
                      {t('training.team.accept')}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => review(attempt.id, 'send_back')}>
                      {t('training.team.sendBack')}
                    </Button>
                  </div>
                )}
                {attempt.review_note ? (
                  <p className="mt-2 text-xs text-muted-foreground">{attempt.review_note}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TeamSection({ businessId, level, isBusiness, business, docStyle }) {
  const { toast } = useToast();
  const [team, setTeam] = useState(null);
  const [personId, setPersonId] = useState('');
  const [module, setModule] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [recordFor, setRecordFor] = useState('');
  // The training record paper (the prints build, Nov 25, 2026):
  // the whole team's filed record on one Studio sheet, fetched
  // per person at print time from the same results the screen's
  // own record view reads.
  const [printPeople, setPrintPeople] = useState(null);
  const printRecord = async () => {
    setBusy(true);
    try {
      const people = await Promise.all(
        team.map(async (person) => {
          const results = await getTeamMemberResults(businessId, person.staff_id).catch(() => ({
            quiz_results: [],
            policy_attempts: [],
          }));
          return {
            name: person.full_name,
            role: person.role_name,
            done: person.lessons_done,
            total: person.lessons_total,
            results: (results.quiz_results ?? []).map((row) => {
              const lesson = lessonById(row.lesson_id);
              return {
                lesson: lesson ? lessonTitle(lesson) : row.lesson_id,
                correct: row.correct,
                total: row.total,
                passed: row.passed,
                date: row.created_at,
              };
            }),
            policies: (results.policy_attempts ?? []).map((attempt) => {
              const parts = [
                attempt.status === 'passed'
                  ? t('training.team.passed')
                  : attempt.status === 'below_line'
                    ? t('training.team.belowLineChip')
                    : attempt.status === 'sent_back'
                      ? t('training.team.sentBackChip')
                      : attempt.status,
              ];
              if (attempt.needs_review) parts.push(t('training.team.needsReview'));
              return {
                docLabel: t(attempt.doc_kind === 'policies' ? 'settings.policies.storePolicies' : 'settings.policies.termsConditions'),
                score: attempt.score_percent ?? null,
                statusLabel: parts.join(' · '),
                date: attempt.created_at,
              };
            }),
            warnings: (person.assignments ?? []).filter((a) => a.warning_sent_at).map((a) => a.warning_sent_at),
          };
        }),
      );
      setPrintPeople(people);
      setTimeout(() => {
        window.print();
        setPrintPeople(null);
      }, 50);
    } catch (error) {
      toast({ title: error.message || t('training.loadFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

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

  // Only modules with at least one plan-visible lesson are
  // assignable here — a Business-only topic does not dangle on
  // Essentials (owner ruling, Nov 14, 2026). Assigning a module
  // hands over its FULL plan catalog — every lesson, all tracks;
  // the server expands it the same way, and the assignee's
  // current role never trims it (owner ruling, Nov 15, 2026).
  const modules = useMemo(
    () => [...new Set(
      TRAINING_LESSONS.filter((l) => lessonVisibleOnPlan(l, isBusiness)).map((l) => l.module),
    )].sort(),
    [isBusiness],
  );

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
      <div className="mb-3 flex justify-end">
        <Button variant="outline" size="sm" disabled={busy || !team.length} onClick={printRecord}>
          <Printer className="mr-1.5 h-4 w-4" />
          {t('print.printButton')}
        </Button>
      </div>
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
            {(() => {
              // Assignments list only plan-visible lessons; an
              // assignment with none left on this plan does not
              // render (owner ruling, Nov 14, 2026).
              const openAssignments = person.assignments
                .map((assignment) => {
                  const ids = (assignment.lesson_ids || []).filter((id) =>
                    lessonVisibleOnPlan(lessonById(id), isBusiness));
                  return ids.length ? { ...assignment, lesson_ids: ids } : null;
                })
                .filter(Boolean)
                .filter((a) => a.status !== 'completed');
              if (!openAssignments.length) return null;
              return (
                <>
                  <p className={`${labelCls} mt-4`}>{t('training.team.openAssignments')}</p>
                  <div className="mt-2 space-y-2.5">
                    {openAssignments.map((assignment) => (
                      <AssignmentRow
                        key={assignment.id}
                        businessId={businessId}
                        assignment={assignment}
                        reload={load}
                      />
                    ))}
                  </div>
                </>
              );
            })()}
            <div className="mt-4">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRecordFor(recordFor === person.staff_id ? '' : person.staff_id)}
              >
                {t('training.team.record')}
              </Button>
              {recordFor === person.staff_id && (
                <PersonRecord businessId={businessId} staffId={person.staff_id} level={level} />
              )}
            </div>
          </div>
        ))}
      </div>
      {printPeople && (
        <div className="print-area hidden print:block">
          <TrainingRecordDoc people={printPeople} business={business} docStyle={docStyle} />
        </div>
      )}
    </Section>
  );
}

export default function Training() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
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

  // Scoping (Nov 20, 2026): the steps a person sees inside a
  // lesson are the steps they can perform — the server sends the
  // visible step numbers with the state; a lesson with no entry
  // shows every step.
  const visibleStepsFor = useCallback(
    (lesson) => state?.step_scope?.[lesson.id] ?? null,
    [state],
  );

  const commentsByLesson = useMemo(() => {
    const map = new Map();
    for (const comment of state?.my_comments ?? []) {
      if (!map.has(comment.lesson_id)) map.set(comment.lesson_id, []);
      map.get(comment.lesson_id).push(comment);
    }
    return map;
  }, [state]);

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

  // Plan visibility (owner ruling, Nov 14, 2026): lessons about
  // Business-only features do not exist on Essentials — no cards,
  // and the counters count only the lessons this plan has. The
  // plan arrives with the training state itself, so there is no
  // window where the wrong set shows.
  const isBusiness = state.plan === 'business';
  const visibleAssignment = (assignment) => {
    const ids = (assignment.lesson_ids || []).filter((id) =>
      lessonVisibleOnPlan(lessonById(id), isBusiness));
    return ids.length ? { ...assignment, lesson_ids: ids } : null;
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">{t('training.title')}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t('training.subtitle')}</p>
      </header>

      <MyAssignments
        businessId={activeId}
        assignments={state.assignments.map(visibleAssignment).filter(Boolean)}
        completedSet={completedSet}
        completedAtById={completedAtById}
        openLesson={openLesson}
        onToggleLesson={(id) => setOpenLesson(openLesson === id ? null : id)}
        onComplete={onComplete}
        onPassed={load}
        busy={busy}
        isOwner={state.is_owner}
        visibleStepsFor={visibleStepsFor}
        commentsByLesson={commentsByLesson}
      />

      {!state.is_owner && <PolicyTrainings businessId={activeId} onDone={load} />}

      {!state.is_owner && <OwnTrainingCards businessId={activeId} onDone={load} />}

      {state.tracks.map((track) => {
        // Scoping (Nov 20, 2026): a person sees only the lessons
        // their real doors open (the server's my_lesson_ids) — the
        // owner sees the whole catalog.
        const myIds = new Set(state.my_lesson_ids ?? []);
        const lessons = visibleLessonsForTrack(track, isBusiness)
          .filter((l) => state.is_owner || myIds.has(l.id));
        const doneCount = lessons.filter((l) => completedSet.has(l.id)).length;
        return (
          <Section
            key={track}
            title={trackTitle(track)}
            help={`${trackHelp(track)} ${t('training.lessonsDoneOf', { done: doneCount, total: lessons.length })}`}
          >
            {/* The Training Organization Rule (owner ruling,
                Nov 25, 2026): the page is SECTIONED BY HEADING —
                general training under its own heading, Restaurant
                training under its OWN heading. Each lesson's
                heading rides in the catalog; the lessons
                themselves are untouched. A heading with no
                lessons on this plan does not render. */}
            <div className="space-y-5">
              {TRAINING_HEADINGS.map((heading) => {
                const group = lessons.filter((lesson) => lessonHeading(lesson) === heading);
                if (!group.length) return null;
                return (
                  <div key={heading}>
                    <h3 className="font-heading text-base font-semibold">{t(`training.heading.${heading}`)}</h3>
                    <div className="mt-3 space-y-3">
                      {group.map((lesson) => (
                        <LessonCard
                          key={lesson.id}
                          businessId={activeId}
                          lesson={lesson}
                          visibleSteps={visibleStepsFor(lesson)}
                          done={completedSet.has(lesson.id)}
                          completedAt={completedAtById.get(lesson.id)}
                          open={openLesson === lesson.id}
                          onToggle={() => setOpenLesson(openLesson === lesson.id ? null : lesson.id)}
                          onComplete={onComplete}
                          onPassed={load}
                          busy={busy}
                          isOwner={state.is_owner}
                          myComments={commentsByLesson.get(lesson.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {!lessons.length && <p className="text-sm text-muted-foreground">{t('training.empty')}</p>}
            </div>
          </Section>
        );
      })}

      {(state.level === 'owner' || state.level === 'manager') && (
        <TeamSection businessId={activeId} level={state.level} isBusiness={isBusiness} business={record} docStyle={docStyle} />
      )}

      {/* "Add your own training" (her design, Nov 25, 2026):
          the box sits at the very end of the training page,
          the owner's alone, mirroring the Settings policies /
          terms machinery. */}
      {state.is_owner && <OwnTrainingBox businessId={activeId} />}
    </div>
  );
}
