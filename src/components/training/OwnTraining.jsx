/**
 * "Add your own training" (Nov 25, 2026) — the box at the very
 * end of the Training page, mirroring the Settings policies /
 * terms machinery (release 321) in its new home.
 *
 * The OWNER's side (OwnTrainingBox): write a training — a title
 * and the material, typed in or uploaded as a file, either or —
 * then build its quiz: unlimited questions, multiple-choice and
 * written-answer mixed freely, a passing line of the owner's
 * choosing, and the owner's choice of how written answers are
 * judged (near-exact against their answer key, or sent to them
 * to mark). Assignment is by tick: only the ticked staff
 * members see a training. There is no limit on how many
 * trainings the one box creates; each stands on its own, and
 * the owner sees each ticked person's result here.
 *
 * The TEAM's side (OwnTrainingCards): the trainings ticked for
 * you — read the material, answer the questions. Multiple
 * choice is checked on the spot, like the policy trainings;
 * the run is scored on the server, and in review mode the
 * training counts done when the owner marks it passed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, GraduationCap, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { t } from '@/lib/i18n';
import { formatShortDate } from '@/lib/dates';
import {
  checkOwnTrainingAnswer,
  createOwnTraining,
  deleteOwnTraining,
  getOwnTrainings,
  getTeamProgress,
  ownTrainingFileUrl,
  removeOwnTrainingFile,
  reviewOwnTrainingAttempt,
  saveOwnTraining,
  submitOwnTraining,
  uploadOwnTrainingFile,
} from '@/lib/training';

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const labelCls = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const LETTERS = ['A', 'B', 'C', 'D'];

/** The file rules, mirroring the server's (businessPolicyRoutes):
 *  document types only, up to 25 MB. */
const FILE_MAX_BYTES = 25 * 1024 * 1024;
const FILE_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
];
const FILE_TYPE_BY_EXTENSION = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
};
const FILE_ACCEPT = ['.pdf', '.txt', '.doc', '.docx', '.rtf', '.odt', ...FILE_TYPES].join(',');

function fileTypeOf(file) {
  if (file.type && FILE_TYPES.includes(file.type)) return file.type;
  const extension = String(file.name || '').split('.').pop()?.toLowerCase();
  return FILE_TYPE_BY_EXTENSION[extension] || null;
}

function readAsDataUrl(file, mime) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) return reject(new Error('read_failed'));
      resolve(`data:${mime};base64,${result.slice(comma + 1)}`);
    };
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function MaterialView({ businessId, training }) {
  const material = training.material;
  return (
    <>
      <p className={labelCls}>{t('training.own.read')}</p>
      {material?.kind === 'text' ? (
        <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm leading-relaxed">
          {material.text}
        </div>
      ) : material?.kind === 'file' ? (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">{material.filename}</span>{' '}
          <a
            className="font-medium text-primary underline"
            href={ownTrainingFileUrl(businessId, training.id)}
            target="_blank"
            rel="noreferrer"
          >
            {t('settings.policies.openFile')}
          </a>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t('training.own.noMaterial')}</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The team's side
// ---------------------------------------------------------------------------

export function OwnTrainingCard({ businessId, training, onDone }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState({});
  const [wrong, setWrong] = useState({});
  const [texts, setTexts] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const attempt = training.latest_attempt;
  const finished = training.completed;
  const pending = attempt?.status === 'pending_review';
  const sentBack = attempt?.status === 'sent_back';

  const pick = async (question, choiceIndex) => {
    if (picks[question.id] !== undefined) return;
    try {
      const { correct } = await checkOwnTrainingAnswer(businessId, training.id, question.id, choiceIndex);
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
      const answers = training.questions.map((q) =>
        q.kind === 'mc'
          ? { question_id: q.id, choice_index: picks[q.id] }
          : { question_id: q.id, text: texts[q.id] || '' },
      );
      const next = await submitOwnTraining(businessId, training.id, answers);
      setResult(next);
      if (next.status === 'passed') {
        toast({ title: t('training.quiz.passed') });
        await onDone?.();
      }
    } catch (error) {
      toast({ title: error.message || t('training.loadFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const allPicked = training.questions
    .filter((q) => q.kind === 'mc')
    .every((q) => picks[q.id] !== undefined);
  const showQuiz = !finished && !pending;

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
          <span className="block truncate text-sm font-medium">{training.title || t('training.own.untitled')}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {finished
              ? attempt?.score_percent !== null && attempt?.score_percent !== undefined
                ? `${t('training.done')} · ${t('training.policy.score', { score: attempt.score_percent })}`
                : t('training.done')
              : pending
                ? t('training.own.pendingReview')
                : sentBack
                  ? t('training.policy.sentBack')
                  : t('training.policy.passLine', { percent: training.pass_percent })}
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
          {pending ? (
            <p className="mb-3 text-sm text-muted-foreground">{t('training.own.pendingNote')}</p>
          ) : null}
          <MaterialView businessId={businessId} training={training} />
          {showQuiz && (
            <>
              {training.questions.length === 0 ? (
                <>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{t('training.policy.noQuestions')}</p>
                  <Button className="mt-3" onClick={submit} disabled={busy}>
                    {t('training.policy.markRead')}
                  </Button>
                </>
              ) : (
                <>
                  <div className="mt-4 space-y-4">
                    {training.questions.map((q, qi) => (
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
                  {result?.status === 'pending_review' && (
                    <p className="mt-3 text-sm text-muted-foreground">{t('training.own.pendingNote')}</p>
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

export function OwnTrainingCards({ businessId, onDone }) {
  const [trainings, setTrainings] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await getOwnTrainings(businessId);
      setTrainings(data.trainings ?? []);
    } catch {
      setTrainings([]);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!trainings?.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="font-heading text-lg font-semibold">{t('training.own.sectionTitle')}</h2>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t('training.own.sectionHelp')}</p>
      <div className="mt-4 space-y-3">
        {trainings.map((training) => (
          <OwnTrainingCard
            key={training.id}
            businessId={businessId}
            training={training}
            onDone={async () => {
              await load();
              await onDone?.();
            }}
          />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The owner's side — the box
// ---------------------------------------------------------------------------

function statusChip(attempt, completed) {
  if (completed) {
    return <span className="rounded-full bg-ok/12 px-2 py-0.5 text-xs text-ok">{t('training.team.passed')}</span>;
  }
  if (!attempt) {
    return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t('training.own.notTaken')}</span>;
  }
  if (attempt.status === 'pending_review') {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
        {t('training.team.needsReview')}
      </span>
    );
  }
  if (attempt.status === 'sent_back') {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
        {t('training.team.sentBackChip')}
      </span>
    );
  }
  if (attempt.status === 'below_line') {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900 dark:bg-red-900/40 dark:text-red-100">
        {t('training.team.belowLineChip')}
      </span>
    );
  }
  return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{attempt.status}</span>;
}

function OwnTrainingEditor({ businessId, training, team, reload }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(training.title || '');
  const [materialText, setMaterialText] = useState(
    training.material?.kind === 'text' ? training.material.text : '',
  );
  const [questions, setQuestions] = useState(() =>
    (training.questions || []).map((q) => ({
      kind: q.kind,
      question: q.question,
      choices: q.kind === 'mc' ? [...(q.choices || []), '', '', '', ''].slice(0, 4) : [],
      correct_index: q.correct_index ?? 0,
      expected_answer: q.expected_answer || '',
    })),
  );
  const [passPercent, setPassPercent] = useState(training.pass_percent ?? 80);
  const [writtenMode, setWrittenMode] = useState(training.written_mode || 'auto');
  const [ticks, setTicks] = useState(() => new Set((training.assignees || []).map((a) => a.person_key)));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const hasFile = training.material?.kind === 'file';

  const patch = (index, values) =>
    setQuestions((current) => current.map((q, i) => (i === index ? { ...q, ...values } : q)));
  const patchChoice = (index, choiceIndex, value) =>
    setQuestions((current) =>
      current.map((q, i) => {
        if (i !== index) return q;
        const choices = [...q.choices];
        choices[choiceIndex] = value;
        return { ...q, choices };
      }),
    );
  const removeQuestion = (index) => setQuestions((current) => current.filter((_, i) => i !== index));
  const addMc = () =>
    setQuestions((current) => [
      ...current,
      { kind: 'mc', question: '', choices: ['', '', '', ''], correct_index: 0, expected_answer: '' },
    ]);
  const addOpen = () =>
    setQuestions((current) => [
      ...current,
      { kind: 'open', question: '', choices: [], correct_index: 0, expected_answer: '' },
    ]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = questions.map((q) => {
        if (q.kind !== 'mc') {
          return { kind: 'open', question: q.question, expected_answer: q.expected_answer };
        }
        const kept = q.choices
          .map((c, ci) => ({ text: c.trim(), ci }))
          .filter((entry) => entry.text);
        const correct = kept.findIndex((entry) => entry.ci === q.correct_index);
        return {
          kind: 'mc',
          question: q.question,
          choices: kept.map((entry) => entry.text),
          correct_index: correct,
        };
      });
      await saveOwnTraining(businessId, training.id, {
        title,
        // Either or: while a file stands and no replacement
        // words are typed, the text is not sent at all; typed
        // words save as the material and replace the file.
        ...(!hasFile || materialText.trim() ? { material_text: materialText } : {}),
        pass_percent: Number(passPercent) || 80,
        written_mode: writtenMode,
        questions: payload,
        assignee_ids: [...ticks],
      });
      setSaved(true);
      toast({ title: t('training.own.saved') });
      setTimeout(() => setSaved(false), 2000);
      await reload();
    } catch (err) {
      setError(err?.message || t('training.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const mime = fileTypeOf(file);
    if (!mime) {
      setError(t('settings.policies.badType'));
      return;
    }
    if (file.size > FILE_MAX_BYTES) {
      setError(t('settings.policies.tooLarge'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const dataUrl = await readAsDataUrl(file, mime);
      await uploadOwnTrainingFile(businessId, training.id, { dataUrl, filename: file.name || '' });
      toast({ title: t('training.own.saved') });
      await reload();
    } catch (err) {
      setError(err?.message || t('training.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async () => {
    setBusy(true);
    try {
      await removeOwnTrainingFile(businessId, training.id);
      await reload();
    } catch (err) {
      setError(err?.message || t('training.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const removeTraining = async () => {
    if (!window.confirm(t('training.own.deleteConfirm'))) return;
    setBusy(true);
    try {
      await deleteOwnTraining(businessId, training.id);
      await reload();
    } catch (err) {
      setError(err?.message || t('training.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const review = async (attemptId, action) => {
    setBusy(true);
    try {
      await reviewOwnTrainingAttempt(businessId, attemptId, { action, note });
      setNote('');
      toast({ title: t('settings.save.saved') });
      await reload();
    } catch (err) {
      setError(err?.message || t('training.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-background">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
        aria-expanded={open}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <GraduationCap className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{training.title || t('training.own.untitled')}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {t('training.policy.passLine', { percent: training.pass_percent })}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-5 border-t border-border px-4 py-4 sm:px-5">
          <div className="space-y-1.5">
            <Label htmlFor={`own-title-${training.id}`} className="text-xs text-muted-foreground">
              {t('training.own.fieldTitle')}
            </Label>
            <Input
              id={`own-title-${training.id}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('training.own.titlePlaceholder')}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`own-material-${training.id}`} className="text-xs text-muted-foreground">
              {t('training.own.fieldMaterial')}
            </Label>
            {hasFile ? (
              <div className="space-y-2">
                <p className="text-sm">
                  <span className="text-muted-foreground">{training.material.filename}</span>{' '}
                  <a
                    className="font-medium text-primary underline"
                    href={ownTrainingFileUrl(businessId, training.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('settings.policies.openFile')}
                  </a>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
                    {t('settings.policies.replaceFile')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={removeFile}>
                    {t('settings.policies.removeFile')}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{t('settings.policies.orWrite')}</p>
                <Textarea
                  id={`own-material-${training.id}`}
                  value={materialText}
                  onChange={(event) => setMaterialText(event.target.value)}
                  placeholder={t('training.own.materialPlaceholder')}
                  rows={5}
                />
              </div>
            ) : (
              <>
                <Textarea
                  id={`own-material-${training.id}`}
                  value={materialText}
                  onChange={(event) => setMaterialText(event.target.value)}
                  placeholder={t('training.own.materialPlaceholder')}
                  rows={6}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('settings.policies.orUpload')}</span>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
                    {t('settings.policies.uploadFile')}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">{t('settings.policies.fileTypes')}</span>
                </div>
              </>
            )}
            <input ref={fileRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={onFile} />
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">{t('settings.policyQuiz.title')}</h4>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('training.own.questionsHint')}</p>
            </div>
            {questions.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('settings.policyQuiz.empty')}</p>
            )}
            <div className="space-y-3">
              {questions.map((q, index) => (
                <div key={index} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {index + 1}. {t(q.kind === 'mc' ? 'settings.policyQuiz.mcLabel' : 'settings.policyQuiz.openLabel')}
                    </span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => removeQuestion(index)} disabled={busy}>
                      <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {t('settings.policyQuiz.remove')}
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`own-q-${training.id}-${index}`} className="text-xs text-muted-foreground">
                      {t('settings.policyQuiz.question')}
                    </Label>
                    <Textarea
                      id={`own-q-${training.id}-${index}`}
                      value={q.question}
                      onChange={(event) => patch(index, { question: event.target.value })}
                      rows={2}
                      maxLength={500}
                    />
                  </div>
                  {q.kind === 'mc' ? (
                    <div className="space-y-1.5">
                      {LETTERS.map((letter, ci) => (
                        <div key={letter} className="flex items-center gap-2">
                          <span className="w-4 text-xs font-medium text-muted-foreground">{letter}</span>
                          <Input
                            value={q.choices[ci] || ''}
                            onChange={(event) => patchChoice(index, ci, event.target.value)}
                            maxLength={200}
                            className="flex-1"
                          />
                          <label className="flex items-center gap-1.5 text-xs">
                            <input
                              type="radio"
                              name={`own-correct-${training.id}-${index}`}
                              checked={q.correct_index === ci}
                              onChange={() => patch(index, { correct_index: ci })}
                            />
                            {t('settings.policyQuiz.correct')}
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor={`own-expected-${training.id}-${index}`} className="text-xs text-muted-foreground">
                        {t('settings.policyQuiz.expected')}
                      </Label>
                      <Textarea
                        id={`own-expected-${training.id}-${index}`}
                        value={q.expected_answer}
                        onChange={(event) => patch(index, { expected_answer: event.target.value })}
                        rows={2}
                        maxLength={500}
                      />
                      <p className="text-[11px] text-muted-foreground">{t('settings.policyQuiz.expectedHint')}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={addMc} disabled={busy}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('settings.policyQuiz.addMc')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={addOpen} disabled={busy}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('settings.policyQuiz.addOpen')}
              </Button>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-muted-foreground">{t('training.own.writtenMode')}</legend>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`own-mode-${training.id}`}
                  className="mt-1"
                  checked={writtenMode === 'auto'}
                  onChange={() => setWrittenMode('auto')}
                />
                <span>
                  {t('training.own.modeAuto')}
                  <span className="block text-xs text-muted-foreground">{t('training.own.modeAutoHint')}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`own-mode-${training.id}`}
                  className="mt-1"
                  checked={writtenMode === 'review'}
                  onChange={() => setWrittenMode('review')}
                />
                <span>
                  {t('training.own.modeReview')}
                  <span className="block text-xs text-muted-foreground">{t('training.own.modeReviewHint')}</span>
                </span>
              </label>
            </fieldset>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`own-pass-${training.id}`} className="text-xs text-muted-foreground">
                  {t('settings.policyQuiz.passLine')}
                </Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={`own-pass-${training.id}`}
                    type="number"
                    min="1"
                    max="100"
                    value={passPercent}
                    onChange={(event) => setPassPercent(event.target.value)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
                <p className="text-[11px] text-muted-foreground">{t('training.own.passLineHint')}</p>
              </div>
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <h4 className="text-sm font-semibold">{t('training.own.assignTitle')}</h4>
            <p className="text-xs leading-relaxed text-muted-foreground">{t('training.own.assignHint')}</p>
            {team.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('training.own.assignNone')}</p>
            ) : (
              <div className="space-y-1.5">
                {team.map((person) => (
                  <label key={person.staff_id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ticks.has(person.staff_id)}
                      onChange={(event) => {
                        setTicks((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(person.staff_id);
                          else next.delete(person.staff_id);
                          return next;
                        });
                      }}
                    />
                    <span>
                      {person.full_name}
                      <span className="ml-2 text-xs text-muted-foreground">{person.role_name}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button type="button" size="sm" onClick={save} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : saved ? (
                <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
              ) : null}
              {t('training.own.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={removeTraining} disabled={busy}>
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('training.own.delete')}
            </Button>
          </div>

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}

          <div className="space-y-2 border-t border-border pt-4">
            <h4 className="text-sm font-semibold">{t('training.own.resultsTitle')}</h4>
            {(training.results || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('training.own.resultsNone')}</p>
            ) : (
              <div className="space-y-3">
                {training.results.map((row) => {
                  const attempt = row.latest_attempt;
                  return (
                    <div key={row.person_key} className="rounded-md border border-border px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-medium">{row.person_name}</span>
                        {attempt?.score_percent !== null && attempt?.score_percent !== undefined && (
                          <span className="text-muted-foreground">{t('training.policy.score', { score: attempt.score_percent })}</span>
                        )}
                        {attempt && (
                          <span className="text-muted-foreground">{formatShortDate(attempt.created_at)}</span>
                        )}
                        {statusChip(attempt, row.completed)}
                      </div>
                      {attempt && Array.isArray(attempt.answers) && attempt.answers.length > 0 && (
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
                      {attempt?.needs_review && (
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
                            {t('training.own.markPass')}
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => review(attempt.id, 'send_back')}>
                            {t('training.team.sendBack')}
                          </Button>
                        </div>
                      )}
                      {attempt?.review_note ? (
                        <p className="mt-2 text-xs text-muted-foreground">{attempt.review_note}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function OwnTrainingBox({ businessId }) {
  const { toast } = useToast();
  const [trainings, setTrainings] = useState(null);
  const [team, setTeam] = useState([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const data = await getOwnTrainings(businessId);
    setTrainings(data.trainings ?? []);
    try {
      const progress = await getTeamProgress(businessId);
      setTeam(progress.people ?? []);
    } catch {
      setTeam([]);
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      await createOwnTraining(businessId);
      await load();
    } catch (error) {
      toast({ title: error.message || t('training.loadFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="font-heading text-lg font-semibold">{t('training.own.title')}</h2>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t('training.own.help')}</p>
      <div className="mt-4">
        {failed ? (
          <p className="text-sm text-destructive">{t('training.loadFailed')}</p>
        ) : !trainings ? (
          <p className="text-sm text-muted-foreground">{t('training.loading')}</p>
        ) : (
          <div className="space-y-3">
            {trainings.map((training) => (
              <OwnTrainingEditor
                key={`${training.id}-${training.updated_at}`}
                businessId={businessId}
                training={training}
                team={team}
                reload={load}
              />
            ))}
            <Button type="button" variant="outline" onClick={create} disabled={busy}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('training.own.newTraining')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
