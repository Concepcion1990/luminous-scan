import { useEffect, useState } from 'react';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { getPolicyQuestions, savePolicyQuestions } from '@/lib/training';
import { t } from '@/lib/i18n';

/**
 * "Questions for your team" (Nov 20, 2026) — the owner's quiz on
 * one of her own documents (Store Policies or Terms), written
 * beside the document in Settings. Hers alone to write; NO limit
 * on how many questions. Two kinds: multiple choice (the choices
 * beside A/B/C/D, the correct one marked) and open (she supplies
 * the expected answer). The passing line is hers to set per
 * document. The questions reach a person only when she ticks
 * that person's training tick in their Staff record; with no
 * questions written, the training is the reading itself.
 */
const LETTERS = ['A', 'B', 'C', 'D'];

export default function PolicyQuestionsEditor({ businessId, docKind }) {
  const { toast } = useToast();
  const [questions, setQuestions] = useState(null);
  const [passPercent, setPassPercent] = useState(80);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    setQuestions(null);
    getPolicyQuestions(businessId, docKind)
      .then((data) => {
        if (!mounted) return;
        setQuestions(
          (data.questions || []).map((q) => ({
            kind: q.kind,
            question: q.question,
            choices: q.kind === 'mc' ? [...(q.choices || []), '', '', '', ''].slice(0, 4) : [],
            correct_index: q.correct_index ?? 0,
            expected_answer: q.expected_answer || '',
          })),
        );
        setPassPercent(data.pass_percent ?? 80);
      })
      .catch((err) => {
        if (mounted) setError(err?.message || t('settings.save.error'));
      });
    return () => {
      mounted = false;
    };
  }, [businessId, docKind]);

  if (!questions) {
    return (
      <div className="space-y-2 border-t border-border pt-4">
        <h4 className="text-sm font-semibold">{t('settings.policyQuiz.title')}</h4>
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('settings.policyQuiz.title')}
          </p>
        )}
      </div>
    );
  }

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
  const remove = (index) => setQuestions((current) => current.filter((_, i) => i !== index));
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
        // Empty choice boxes drop out — and the marked correct
        // answer is remapped to its new position, so the mark
        // can never slide onto a different choice.
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
      const data = await savePolicyQuestions(businessId, docKind, {
        questions: payload,
        pass_percent: Number(passPercent) || 80,
      });
      setQuestions(
        (data.questions || []).map((q) => ({
          kind: q.kind,
          question: q.question,
          choices: q.kind === 'mc' ? [...(q.choices || []), '', '', '', ''].slice(0, 4) : [],
          correct_index: q.correct_index ?? 0,
          expected_answer: q.expected_answer || '',
        })),
      );
      setPassPercent(data.pass_percent ?? 80);
      setSaved(true);
      toast({ title: t('settings.policyQuiz.saved') });
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err?.message || t('settings.save.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">{t('settings.policyQuiz.title')}</h4>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('settings.policyQuiz.hint')}</p>
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
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(index)} disabled={busy}>
                <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('settings.policyQuiz.remove')}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`pq-${docKind}-${index}`} className="text-xs text-muted-foreground">
                {t('settings.policyQuiz.question')}
              </Label>
              <Textarea
                id={`pq-${docKind}-${index}`}
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
                        name={`pq-correct-${docKind}-${index}`}
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
                <Label htmlFor={`pq-expected-${docKind}-${index}`} className="text-xs text-muted-foreground">
                  {t('settings.policyQuiz.expected')}
                </Label>
                <Textarea
                  id={`pq-expected-${docKind}-${index}`}
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

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`pq-pass-${docKind}`} className="text-xs text-muted-foreground">
            {t('settings.policyQuiz.passLine')}
          </Label>
          <div className="flex items-center gap-1.5">
            <Input
              id={`pq-pass-${docKind}`}
              type="number"
              min="1"
              max="100"
              value={passPercent}
              onChange={(event) => setPassPercent(event.target.value)}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('settings.policyQuiz.passLineHint')}</p>
        </div>
        <Button type="button" size="sm" onClick={save} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : saved ? (
            <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
          ) : null}
          {t('settings.policyQuiz.save')}
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
