// Release 360 (Nov 23, 2026): the quiz repair pins — pure node,
// no DB. Every lesson's quiz is DERIVED server-side by buildQuiz
// (5–8 questions quoting the lesson's own steps). The one provable
// defect: owner-import (2 steps, the catalog's only sub-3-step
// lesson) yielded a notBelongs question with a duplicated own-step
// option, because takeOwn cycled its 2 steps to fill 3 own slots.
// The repair: notBelongs falls back to belongs when fewer than 3
// steps are visible — question count unchanged, so an in-flight
// attempt cannot hit quiz_changed.
//
// This suite walks the whole matrix — every lesson × plan × the
// step views a person can actually get (full steps, the no-tick
// scoped view, the GS1-tick scoped view) — and pins the shape of
// every question, determinism, and that every step a quiz can
// quote resolves to a real locale key in EVERY locale file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { buildQuiz, visibleStepNumbers } from '../../server/trainingScope.js';
import { TRAINING_LESSONS, lessonVisibleOnPlan } from '../../server/trainingCatalog.js';

const PERSON_KEY = 't57-probe';
const STEP_VIEWS = [
  ['full', (lesson) => Array.from({ length: lesson.steps }, (_, i) => i + 1)],
  ['no permissions', (lesson) => visibleStepNumbers(lesson, { permissions: [] })],
  ['settings.gs1 tick', (lesson) => visibleStepNumbers(lesson, { permissions: ['settings.gs1'] })],
];

function checkQuiz(lesson, own, quiz, label) {
  const target = Math.min(8, Math.max(5, own.length + 1));
  assert.equal(quiz.questions.length, target, `${label}: question count is ${target}`);
  for (const [qi, q] of quiz.questions.entries()) {
    const at = `${label} q${qi + 1} (${q.type})`;
    assert.equal(q.options.length, 4, `${at}: exactly 4 options`);
    const keys = q.options.map((o) => `${o.lesson_id}:${o.step}`);
    assert.equal(new Set(keys).size, 4, `${at}: options distinct by lesson:step`);
    assert.ok(
      Number.isInteger(q.answer_index) && q.answer_index >= 0 && q.answer_index < q.options.length,
      `${at}: answer_index in range`,
    );
    const answer = q.options[q.answer_index];
    if (q.type === 'belongs') {
      assert.equal(answer.lesson_id, lesson.id, `${at}: the belongs answer is one of the lesson's own steps`);
    } else if (q.type === 'notBelongs') {
      const foreign = q.options.filter((o) => o.lesson_id !== lesson.id);
      assert.equal(foreign.length, 1, `${at}: exactly one option is foreign`);
      assert.equal(answer.lesson_id, foreign[0].lesson_id, `${at}: the foreign option is the answer`);
      assert.equal(answer.step, foreign[0].step, `${at}: the foreign option is the answer`);
    } else if (q.type === 'order') {
      const minStep = Math.min(...q.options.map((o) => o.step));
      assert.equal(answer.step, minStep, `${at}: the order answer is the earliest step among its options`);
    } else {
      assert.fail(`${at}: unknown question type ${q.type}`);
    }
  }
}

test('quiz coverage: every lesson, both plans, every step view — well-formed and deterministic', () => {
  let built = 0;
  for (const lesson of TRAINING_LESSONS) {
    for (const isBusiness of [false, true]) {
      if (!lessonVisibleOnPlan(lesson, isBusiness)) continue;
      for (const [viewName, viewOf] of STEP_VIEWS) {
        const own = viewOf(lesson);
        const label = `${lesson.id} (${isBusiness ? 'business' : 'essentials'}, ${viewName} view, ${own.length} steps)`;
        const quiz = buildQuiz(lesson, own, { personKey: PERSON_KEY, isBusiness });
        checkQuiz(lesson, own, quiz, label);
        const again = buildQuiz(lesson, own, { personKey: PERSON_KEY, isBusiness });
        assert.deepEqual(again, quiz, `${label}: buildQuiz is deterministic`);
        built += 1;
      }
    }
  }
  assert.ok(built > 0, 'the matrix built quizzes');
});

test('the repaired lesson: owner-import asks belongs instead of a duplicated notBelongs', () => {
  const lesson = TRAINING_LESSONS.find((l) => l.id === 'owner-import');
  assert.ok(lesson, 'owner-import exists');
  // Release 365 (Nov 23, 2026) grew owner-import 2 -> 4 steps —
  // it gained the column-marriage step and the dry-run-promise
  // step (the owner's import rulings). Release 366 (Nov 24,
  // 2026) added the fifth step — the photo truth (photos arrive
  // on their own; the Bring in missing photos door). The 360
  // repair still governs any view with fewer than 3 visible
  // steps: notBelongs falls back to belongs there, count
  // unchanged.
  assert.equal(lesson.steps, 5, 'owner-import is the 5-step lesson since release 366');
  // owner-import is Essentials-only (essentialsOnly), so its live
  // plan view is isBusiness=false; check both builder inputs anyway.
  for (const isBusiness of [false, true]) {
    const quiz = buildQuiz(lesson, [1, 2], { personKey: PERSON_KEY, isBusiness });
    assert.equal(quiz.questions.length, 5, 'question count unchanged by the fallback');
    assert.ok(quiz.questions.every((q) => q.type === 'belongs'), 'every question falls back to belongs');
    // With all five steps visible the lesson quizzes like any
    // other: notBelongs and order ask properly, nothing falls back.
    const full = buildQuiz(lesson, [1, 2, 3, 4, 5], { personKey: PERSON_KEY, isBusiness });
    // Release 366: with five steps visible the derived quiz asks
    // six questions — the standard mix, extended by the
    // derivation's own pattern for a larger lesson (the second
    // notBelongs quotes a different step; the 360 defect was a
    // DUPLICATED question, not a repeated type).
    assert.equal(full.questions.length, 6, 'full view question count');
    assert.deepEqual(
      full.questions.map((q) => q.type),
      ['belongs', 'notBelongs', 'belongs', 'order', 'belongs', 'notBelongs'],
      'full view asks the standard mix',
    );
  }
});

test('locale resolvability: every step a quiz can quote — and every lesson title/step — exists in every locale', () => {
  // Collect every option referenced by every built quiz across
  // the same matrix as the coverage test.
  const referenced = new Set();
  for (const lesson of TRAINING_LESSONS) {
    for (const isBusiness of [false, true]) {
      if (!lessonVisibleOnPlan(lesson, isBusiness)) continue;
      for (const [, viewOf] of STEP_VIEWS) {
        const quiz = buildQuiz(lesson, viewOf(lesson), { personKey: PERSON_KEY, isBusiness });
        for (const q of quiz.questions) {
          for (const o of q.options) referenced.add(`training.lessons.${o.lesson_id}.step${o.step}`);
        }
      }
    }
  }
  assert.ok(referenced.size > 0, 'the matrix referenced lesson steps');

  const needed = new Set(referenced);
  for (const lesson of TRAINING_LESSONS) {
    needed.add(`training.lessons.${lesson.id}.title`);
    for (let s = 1; s <= lesson.steps; s += 1) needed.add(`training.lessons.${lesson.id}.step${s}`);
  }

  const localesDir = new URL('../../src/lib/locales/', import.meta.url);
  const files = readdirSync(localesDir).filter((f) => f.endsWith('.js')).sort();
  assert.ok(files.length >= 52, `the locale folder holds the full set (found ${files.length})`);
  for (const file of files) {
    const text = readFileSync(new URL(file, localesDir), 'utf8');
    const keys = new Set();
    for (const m of text.matchAll(/['"](training\.lessons\.[^'"]+)['"]\s*:/g)) keys.add(m[1]);
    assert.ok(keys.size > 0, `${file}: training lesson keys extracted`);
    for (const key of needed) {
      assert.ok(keys.has(key), `${file}: ${key} exists`);
    }
  }
});
