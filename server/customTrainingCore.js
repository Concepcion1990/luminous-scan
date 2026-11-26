/**
 * "Add your own training" — the pure heart (Nov 25, 2026).
 *
 * The owner's own trainings carry a quiz the owner builds:
 * unlimited questions, multiple-choice and written-answer mixed
 * freely. This module holds the two decisions that must be
 * provable without a database — how an owner's question list is
 * cleaned on save, and how a submitted run is scored on the
 * server (release 334's pattern: completion is server-checked,
 * never taken on the client's word).
 *
 * Written answers are judged the owner's choice, per training:
 *   - 'auto': a typed answer counts correct when it matches the
 *     owner's expected answer nearly word for word (the same
 *     matcher the policy quiz uses, server/policyQuizRoutes.js).
 *     The score counts EVERY question, and the training passes
 *     at or over the owner's passing line.
 *   - 'review': nothing is finally judged here — the run files
 *     as pending_review and the OWNER marks it passed or sends
 *     it back. The auto-computed score still files with the
 *     attempt, as information for the owner's eye.
 *
 * No questions written = no quiz: the training is the reading
 * itself, and a submit closes it as passed (the policy quiz's
 * reading-only rule, carried over).
 */
import { answerMatches } from './policyQuizRoutes.js';

export const CUSTOM_WRITTEN_MODES = ['auto', 'review'];
export const CUSTOM_QUESTIONS_MAX = 1000;
export const CUSTOM_MATERIAL_MAX = 100_000;

/** Clean one owner-written question list for storage. Throws a
 *  plain {status, code} error on the first bad question, in the
 *  policy-quiz editor's own words and limits. */
export function cleanCustomQuestions(incoming) {
  if (!Array.isArray(incoming)) {
    throw Object.assign(new Error('Send the questions list.'), { status: 400, code: 'invalid_value' });
  }
  if (incoming.length > CUSTOM_QUESTIONS_MAX) {
    throw Object.assign(new Error('That is more questions than the training can hold.'), { status: 400, code: 'invalid_value' });
  }
  return incoming.map((q, i) => {
    const kind = String(q?.kind || '');
    const question = String(q?.question || '').trim().slice(0, 500);
    if (!question) {
      throw Object.assign(new Error('Every question needs its words.'), { status: 400, code: 'invalid_value' });
    }
    if (kind === 'mc') {
      const choices = (Array.isArray(q.choices) ? q.choices : [])
        .map((c) => String(c || '').trim().slice(0, 200))
        .filter(Boolean);
      if (choices.length < 2 || choices.length > 4) {
        throw Object.assign(new Error('A multiple-choice question needs two to four choices.'), { status: 400, code: 'invalid_value' });
      }
      const correct = Number(q.correct_index);
      if (!Number.isInteger(correct) || correct < 0 || correct >= choices.length) {
        throw Object.assign(new Error('Mark the correct choice for every multiple-choice question.'), { status: 400, code: 'invalid_value' });
      }
      return { kind, question, choices, correct_index: correct, expected_answer: '', position: i };
    }
    if (kind === 'open') {
      const expected = String(q.expected_answer || '').trim().slice(0, 500);
      if (!expected) {
        throw Object.assign(new Error('An open question needs the expected answer.'), { status: 400, code: 'invalid_value' });
      }
      return { kind, question, choices: [], correct_index: null, expected_answer: expected, position: i };
    }
    throw Object.assign(new Error('A question is multiple choice or open.'), { status: 400, code: 'invalid_value' });
  });
}

export function cleanPassPercent(raw) {
  const passPercent = Number(raw ?? 80);
  if (!Number.isInteger(passPercent) || passPercent < 1 || passPercent > 100) {
    throw Object.assign(new Error('The passing line is a whole percent between 1 and 100.'), { status: 400, code: 'invalid_value' });
  }
  return passPercent;
}

export function cleanWrittenMode(raw) {
  const mode = String(raw || 'auto');
  if (!CUSTOM_WRITTEN_MODES.includes(mode)) {
    throw Object.assign(new Error('Written answers are checked against the key or sent to the owner.'), { status: 400, code: 'invalid_value' });
  }
  return mode;
}

/**
 * Score one submitted run, server-side. `questions` are the
 * owner's stored rows (with the answer keys); `answers` is the
 * person's submitted list of {question_id, choice_index|text}.
 * Returns the filed answer rows (keys included — they file to
 * the owner's record, never back to the taker), the totals, and
 * the standing: 'passed' | 'below_line' | 'pending_review' |
 * 'reading_only'.
 */
export function scoreCustomAttempt(questions, answers, { writtenMode = 'auto', passPercent = 80 } = {}) {
  const given = new Map(
    (Array.isArray(answers) ? answers : []).map((a) => [String(a?.question_id || ''), a]),
  );
  if (!questions.length) {
    return { filed: [], total: 0, correct: 0, scorePercent: null, status: 'reading_only', needsReview: false };
  }
  let correct = 0;
  const filed = [];
  for (const q of questions) {
    const answer = given.get(q.id) || {};
    if (q.kind === 'mc') {
      const chosen = Number.isInteger(answer.choice_index) ? answer.choice_index : null;
      const right = chosen === q.correct_index;
      if (right) correct += 1;
      filed.push({
        question_id: q.id, kind: 'mc', question: q.question,
        choices: Array.isArray(q.choices) ? q.choices : [], choice_index: chosen, correct: right,
      });
    } else {
      const text = String(answer.text || '').trim().slice(0, 1000);
      const matched = answerMatches(text, q.expected_answer);
      if (matched) correct += 1;
      filed.push({
        question_id: q.id, kind: 'open', question: q.question,
        text, expected_answer: q.expected_answer, matched,
      });
    }
  }
  const total = questions.length;
  const scorePercent = Math.round((100 * correct) / total);
  if (writtenMode === 'review') {
    return { filed, total, correct, scorePercent, status: 'pending_review', needsReview: true };
  }
  return {
    filed,
    total,
    correct,
    scorePercent,
    status: scorePercent >= passPercent ? 'passed' : 'below_line',
    needsReview: false,
  };
}

/** A training counts done for a person when a passed attempt
 *  stands among their attempts (a later send-back of a DIFFERENT
 *  attempt does not un-pass an earlier pass — the review route
 *  flips the very attempt it judges). */
export function customAttemptCompletes(attempt) {
  return Boolean(attempt) && attempt.status === 'passed';
}
