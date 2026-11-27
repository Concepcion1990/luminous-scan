/**
 * T78 — the TRAINING BUILD (Nov 25, 2026), the owner's Training
 * Organization Rule + "Add your own training" design.
 *
 *  (A) SECTIONED HEADINGS: the training page is separated by
 *  heading — general training under its own heading, Restaurant
 *  training under its OWN heading. The catalog carries the
 *  heading per lesson (general ⇔ not the restaurant module;
 *  restaurant ⇔ the restaurant module, 9 lessons), client and
 *  server in direct agreement, and the page groups each track's
 *  lessons under the two headings.
 *
 *  (B) ADD YOUR OWN TRAINING: at the very end of the training
 *  page, a box mirroring the release-321 Settings policies/terms
 *  machinery. The owner writes their own training (title +
 *  material, typed or a file), builds its quiz (unlimited
 *  questions, multiple-choice and written-answer mixed freely),
 *  sets the passing score, and chooses how written answers are
 *  judged — auto-checked near-exact against the answer key, or
 *  sent to the owner to mark pass/fail. Assignment is by tick.
 *  Multiple trainings from the one box. BOTH plans, per-business
 *  private. Completion is server-checked (release 334 pattern):
 *  the score is computed in server/customTrainingCore.js from
 *  the stored questions — never taken from the client — and the
 *  OWNER stays quiz-exempt.
 *
 *  TEST + RETEST — her direct order: the scoring battery runs
 *  named runs and re-runs (a below-line run, then the same
 *  person's better retest passing; review mode filing pending,
 *  then the owner's mark deciding).
 *
 *  Keyset: 5958 + 48 = 6006 ×52 at this build, uniform (the box's 41 plus
 *  the seven own-training API wordings in the apiErrors
 *  registry); the barcode-pool build (Nov 25, 2026) takes the
 *  keyset to 5931 and the catalog to 120 (6100 and 121 since the checklists build, Nov 26, 2026), and the pins below
 *  carry the current totals. Training catalog: 118 + 1 = 119
 *  at this build (owner track, training module, GENERAL
 *  heading, 5 steps). Migration 056 (the five
 *  custom-training tables).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { PLANS, WELCOME_OPTIONS } from '../../src/lib/plans.js';
import {
  TRAINING_HEADINGS,
  TRAINING_LESSONS as CLIENT_LESSONS,
  lessonHeading,
} from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';
import {
  cleanCustomQuestions,
  cleanPassPercent,
  cleanWrittenMode,
  customAttemptCompletes,
  scoreCustomAttempt,
} from '../../server/customTrainingCore.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'training.heading.general', 'training.heading.restaurant',
  'training.own.title', 'training.own.help', 'training.own.newTraining',
  'training.own.untitled', 'training.own.fieldTitle', 'training.own.titlePlaceholder',
  'training.own.fieldMaterial', 'training.own.materialPlaceholder',
  'training.own.questionsHint', 'training.own.writtenMode', 'training.own.modeAuto',
  'training.own.modeAutoHint', 'training.own.modeReview', 'training.own.modeReviewHint',
  'training.own.passLineHint', 'training.own.assignTitle', 'training.own.assignHint',
  'training.own.assignNone', 'training.own.save', 'training.own.saved',
  'training.own.delete', 'training.own.deleteConfirm', 'training.own.resultsTitle',
  'training.own.resultsNone', 'training.own.notTaken', 'training.own.pendingReview',
  'training.own.markPass', 'training.own.sectionTitle', 'training.own.sectionHelp',
  'training.own.read', 'training.own.noMaterial', 'training.own.pendingNote',
  'plansLib.includes.ownTraining',
  'training.lessons.owner-own-training.title', 'training.lessons.owner-own-training.step1',
  'training.lessons.owner-own-training.step2', 'training.lessons.owner-own-training.step3',
  'training.lessons.owner-own-training.step4', 'training.lessons.owner-own-training.step5',
  'apiErrors.ownTrainingOwnerWrites', 'apiErrors.ownTrainingNotHere',
  'apiErrors.ownTrainingTooLong', 'apiErrors.ownTrainingTicksList',
  'apiErrors.ownTrainingTickNotTeam', 'apiErrors.ownTrainingNoFile',
  'apiErrors.ownTrainingWrittenMode',
];

/* ------------------------------------------------ i18n gate */

test('keyset stands at 6100 in all 52 locales, uniform', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  const enKeys = Object.keys(LOCALES.en).sort();
  assert.equal(enKeys.length, 6100);
  for (const code of codes) {
    assert.equal(Object.keys(LOCALES[code]).length, 6100, `${code} keyset`);
    assert.deepEqual(Object.keys(LOCALES[code]).sort(), enKeys, `${code} keyset differs from en`);
  }
});

test('the 48 new keys exist in all 52 locales and are not the key itself', () => {
  assert.equal(NEW_KEYS.length, 48);
  for (const [code, strings] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof strings[key] === 'string' && strings[key].length >= 1, `${code} missing ${key}`);
      assert.notEqual(strings[key], key, `${code} ${key} renders as its own key`);
    }
  }
});

test('the five Englishes carry the new keys byte-identical to base en; es/fr variants and prs ride their base', () => {
  for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) {
    for (const key of NEW_KEYS) assert.equal(LOCALES[code][key], en[key], `${code} ${key}`);
  }
  for (const code of ['es-ES', 'es-US', 'es-CU', 'es-PR', 'es-VE']) {
    for (const key of NEW_KEYS) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
  }
  for (const key of NEW_KEYS) assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
  for (const key of NEW_KEYS) assert.equal(LOCALES['prs'][key], LOCALES['fa'][key], `prs ${key}`);
});

/* ------------------------------------------- plan presentation */

test('plan presentation: the own-training line rides Essentials on Plans + Welcome + the matrix, and Business does not repeat it', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.includes.ownTraining').length - 1, 3, 'the line is referenced exactly three times: Plans list, Welcome list, comparison matrix');
  assert.ok(plans.includes("{ get label() { return t('plansLib.includes.ownTraining'); }"), 'the comparison matrix row exists');
  const line = en['plansLib.includes.ownTraining'];
  assert.ok(PLANS.essentials.includes.includes(line), 'Plans Essentials list carries the line');
  const welcomeEssentials = WELCOME_OPTIONS.find((option) => option.key === 'essentials');
  assert.ok(welcomeEssentials.includes.includes(line), 'Welcome Essentials list carries the line');
  assert.ok(!PLANS.business.includes.includes(line), 'Business list does not repeat an Essentials line (the Nov 19 dedupe ruling)');
});

/* -------------------------------------- (A) sectioned headings */

test('catalogs stood at 120 at this build (121 since the checklists build), client and server JSON-identical, every lesson carrying its heading', () => {
  assert.equal(CLIENT_LESSONS.length, 121);
  assert.equal(SERVER_LESSONS.length, 121);
  assert.equal(JSON.stringify(CLIENT_LESSONS), JSON.stringify(SERVER_LESSONS), 'the two catalogs agree exactly');
  for (const lesson of CLIENT_LESSONS) {
    assert.ok(TRAINING_HEADINGS.includes(lesson.heading), `${lesson.id} heading is one of the two`);
    assert.equal(
      lesson.heading,
      lesson.module === 'restaurant' ? 'restaurant' : 'general',
      `${lesson.id}: the restaurant module rides the Restaurant heading, everything else General`,
    );
  }
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 9, 'the nine restaurant lessons (359 + 361) sit under the Restaurant heading');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 112, '111 through the barcode-pool build; +1 staff-checklists (the checklists build, Nov 26, 2026) under the General heading');
});

test('the new lesson: owner-own-training, owner track, training module, GENERAL heading, 5 steps', () => {
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-own-training');
  assert.ok(lesson, 'the lesson exists');
  assert.deepEqual(
    { track: lesson.track, module: lesson.module, heading: lesson.heading, steps: lesson.steps },
    { track: 'owner', module: 'training', heading: 'general', steps: 5 },
  );
});

test('lessonHeading resolves the catalog heading, with the module fallback for unheaded rows', () => {
  assert.equal(lessonHeading({ module: 'restaurant', heading: 'restaurant' }), 'restaurant');
  assert.equal(lessonHeading({ module: 'scanner', heading: 'general' }), 'general');
  assert.equal(lessonHeading({ module: 'restaurant' }), 'restaurant');
  assert.equal(lessonHeading({ module: 'scanner' }), 'general');
});

test('the training page renders the two headings and groups lessons under them', () => {
  const page = read('src/pages/Training.jsx');
  assert.ok(page.includes('TRAINING_HEADINGS.map'), 'the page iterates the headings');
  assert.ok(page.includes('t(`training.heading.${heading}`)'), 'each group is titled by its heading key');
  assert.ok(page.includes('lessonHeading(lesson) === heading'), 'lessons are grouped by their catalog heading');
  assert.ok(page.includes('<OwnTrainingBox businessId={activeId} />'), 'the owner box renders on the page');
  assert.ok(
    page.indexOf('<OwnTrainingBox') > page.indexOf('<TeamSection'),
    'the box sits at the very end of the page, after the Team section',
  );
  assert.ok(page.includes('state.is_owner && <OwnTrainingBox'), 'the box is the owner\'s alone');
  assert.ok(page.includes('<OwnTrainingCards businessId={activeId}'), 'ticked members get their trainings on the page');
});

/* --------------------------------- (B) the scoring battery */

const QUIZ = [
  { id: 'q1', kind: 'mc', question: 'Gloves?', choices: ['Yes', 'No'], correct_index: 0, expected_answer: '' },
  { id: 'q2', kind: 'mc', question: 'Wash first?', choices: ['After', 'Before'], correct_index: 1, expected_answer: '' },
  { id: 'q3', kind: 'open', question: 'Where do knives live?', choices: [], correct_index: null, expected_answer: 'In the knife block' },
  { id: 'q4', kind: 'open', question: 'First step on arrival?', choices: [], correct_index: null, expected_answer: 'Wash your hands' },
];

test('auto mode: a mixed quiz scores every question — test, then the retest passes', () => {
  // TEST: one MC right, one MC wrong, one written near-exact, one written wrong → 2/4 = 50 < 80.
  const first = scoreCustomAttempt(QUIZ, [
    { question_id: 'q1', choice_index: 0 },
    { question_id: 'q2', choice_index: 0 },
    { question_id: 'q3', text: 'in the knife block!' },
    { question_id: 'q4', text: 'check the rota' },
  ], { writtenMode: 'auto', passPercent: 80 });
  assert.equal(first.total, 4);
  assert.equal(first.correct, 2);
  assert.equal(first.scorePercent, 50);
  assert.equal(first.status, 'below_line');
  assert.equal(first.needsReview, false);
  // RETEST: the same person, everything right → 100 ≥ 80.
  const retest = scoreCustomAttempt(QUIZ, [
    { question_id: 'q1', choice_index: 0 },
    { question_id: 'q2', choice_index: 1 },
    { question_id: 'q3', text: 'In the knife block' },
    { question_id: 'q4', text: 'wash your hands' },
  ], { writtenMode: 'auto', passPercent: 80 });
  assert.equal(retest.correct, 4);
  assert.equal(retest.scorePercent, 100);
  assert.equal(retest.status, 'passed');
});

test('auto mode: the passing line is the owner\'s — a run exactly on the line passes', () => {
  const answers = [
    { question_id: 'q1', choice_index: 0 },
    { question_id: 'q2', choice_index: 1 },
    { question_id: 'q3', text: 'In the knife block' },
    { question_id: 'q4', text: 'no idea' },
  ]; // 3/4 = 75
  assert.equal(scoreCustomAttempt(QUIZ, answers, { writtenMode: 'auto', passPercent: 75 }).status, 'passed', '75 at a 75 line passes');
  assert.equal(scoreCustomAttempt(QUIZ, answers, { writtenMode: 'auto', passPercent: 76 }).status, 'below_line', '75 under a 76 line does not');
  assert.equal(scoreCustomAttempt(QUIZ, answers, { writtenMode: 'auto', passPercent: 90 }).status, 'below_line', 'the owner may set the line at 90');
});

test('auto mode: near-exact written matching — case, punctuation and accents forgiven; different words refused', () => {
  const one = [QUIZ[2]];
  const run = (text) => scoreCustomAttempt(one, [{ question_id: 'q3', text }], { writtenMode: 'auto', passPercent: 80 });
  assert.equal(run('in the knife block').correct, 1, 'case forgiven');
  assert.equal(run('In the knife block.').correct, 1, 'punctuation forgiven');
  assert.equal(run('In thé knife block').correct, 1, 'accents forgiven');
  assert.equal(run('on the counter').correct, 0, 'different words refused');
  assert.equal(run('').correct, 0, 'an empty answer is not a match');
});

test('review mode: every run files pending for the owner\'s mark — test, then the mark decides', () => {
  const perfect = scoreCustomAttempt(QUIZ, [
    { question_id: 'q1', choice_index: 0 },
    { question_id: 'q2', choice_index: 1 },
    { question_id: 'q3', text: 'In the knife block' },
    { question_id: 'q4', text: 'Wash your hands' },
  ], { writtenMode: 'review', passPercent: 80 });
  assert.equal(perfect.status, 'pending_review', 'even a perfect run waits for the owner in review mode');
  assert.equal(perfect.needsReview, true);
  assert.equal(perfect.scorePercent, 100, 'the auto-computed score still files for the owner\'s eye');
  assert.equal(customAttemptCompletes({ status: 'pending_review' }), false, 'pending is not done');
  assert.equal(customAttemptCompletes({ status: 'passed' }), true, 'the owner\'s accept (passed) completes it');
  assert.equal(customAttemptCompletes({ status: 'sent_back' }), false, 'a send-back is not done — it is retaken');
  assert.equal(customAttemptCompletes({ status: 'below_line' }), false);
  assert.equal(customAttemptCompletes(null), false);
});

test('no questions written = no quiz: the training is the reading itself', () => {
  const out = scoreCustomAttempt([], [], { writtenMode: 'auto', passPercent: 80 });
  assert.equal(out.status, 'reading_only');
  assert.equal(out.scorePercent, null);
  assert.equal(out.total, 0);
});

test('missing answers count wrong, and answers for unknown questions are ignored', () => {
  const out = scoreCustomAttempt(QUIZ, [
    { question_id: 'q1', choice_index: 0 },
    { question_id: 'nope', choice_index: 0 },
  ], { writtenMode: 'auto', passPercent: 80 });
  assert.equal(out.total, 4, 'the total is the owner\'s questions, never the submitted list');
  assert.equal(out.correct, 1);
  assert.equal(out.filed.length, 4);
});

/* ------------------------------ the owner's question cleaning */

test('cleanCustomQuestions keeps a mixed list in order and refuses malformed questions', () => {
  const cleaned = cleanCustomQuestions([
    { kind: 'mc', question: 'Gloves?', choices: ['Yes', 'No', ''], correct_index: 0 },
    { kind: 'open', question: 'Where?', expected_answer: 'In the block' },
    { kind: 'mc', question: 'Wash?', choices: ['Before', 'After', 'Never', 'Weekly'], correct_index: 0 },
  ]);
  assert.equal(cleaned.length, 3);
  assert.deepEqual(cleaned.map((q) => q.position), [0, 1, 2]);
  assert.deepEqual(cleaned[0].choices, ['Yes', 'No'], 'empty choices drop out');
  assert.equal(cleaned[1].expected_answer, 'In the block');
  assert.throws(() => cleanCustomQuestions([{ kind: 'mc', question: '  ', choices: ['A', 'B'], correct_index: 0 }]), /words/);
  assert.throws(() => cleanCustomQuestions([{ kind: 'mc', question: 'Q', choices: ['Only'], correct_index: 0 }]), /two to four/);
  assert.throws(() => cleanCustomQuestions([{ kind: 'mc', question: 'Q', choices: ['A', 'B'], correct_index: 5 }]), /Mark the correct/);
  assert.throws(() => cleanCustomQuestions([{ kind: 'open', question: 'Q', expected_answer: ' ' }]), /expected answer/);
  assert.throws(() => cleanCustomQuestions([{ kind: 'essay', question: 'Q' }]), /multiple choice or open/);
  assert.throws(() => cleanCustomQuestions('nope'), /questions list/);
});

test('the passing line and the written mode are validated to the owner\'s two choices', () => {
  assert.equal(cleanPassPercent(90), 90);
  assert.equal(cleanPassPercent(undefined), 80);
  assert.throws(() => cleanPassPercent(0), /between 1 and 100/);
  assert.throws(() => cleanPassPercent(101), /between 1 and 100/);
  assert.throws(() => cleanPassPercent(80.5), /between 1 and 100/);
  assert.equal(cleanWrittenMode('review'), 'review');
  assert.equal(cleanWrittenMode(undefined), 'auto');
  assert.throws(() => cleanWrittenMode('sometimes'), /checked against the key or sent to the owner/);
});

/* ------------------------------ migration + server wiring */

test('migration 056 carries the five tables, the written-mode check, and no business foreign key', () => {
  const sql = read('migrations/056_custom_trainings.sql');
  for (const table of ['custom_trainings', 'custom_training_files', 'custom_training_questions', 'custom_training_assignments', 'custom_training_attempts']) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`), table);
  }
  assert.ok(sql.includes("written_mode TEXT NOT NULL DEFAULT 'auto' CHECK (written_mode IN ('auto', 'review'))"));
  assert.ok(sql.includes('UNIQUE (training_id, person_key)'), 'one tick per person per training');
  assert.ok(!/business_id[^,\n]*REFERENCES/.test(sql), 'business_id carries no foreign key (the migration-017 lesson)');
});

test('the routes are mounted, the file door rides the widened parser, and the wipe sweep deletes the five tables', () => {
  const app = read('server/app.js');
  assert.ok(app.includes('createCustomTrainingRouter({ getPool })'), 'the router is mounted');
  assert.ok(app.includes("'/api/businesses/:bid/own-training/:id/file'"), 'the material file door gets the widened JSON parser');
  const billing = read('server/billing.js');
  for (const table of ['custom_trainings', 'custom_training_files', 'custom_training_questions', 'custom_training_assignments', 'custom_training_attempts']) {
    assert.ok(billing.includes(`DELETE FROM ${table} WHERE business_id = $1`), `the wipe sweep deletes ${table}`);
  }
});

test('completion is server-checked: the submit route scores from the stored questions and never trusts a client score', () => {
  const routes = read('server/customTrainingRoutes.js');
  assert.ok(routes.includes("import {\n  CUSTOM_MATERIAL_MAX,"), 'the routes ride the pure core');
  assert.ok(routes.includes('scoreCustomAttempt(questions, req.body?.answers'), 'the score is computed server-side from the stored questions + submitted answers');
  assert.ok(!routes.includes('score_percent: req.body') && !routes.includes('body?.score'), 'no client-supplied score is ever read');
  assert.ok(routes.includes("throw err(400, 'owner_exempt'"), 'the owner stays quiz-exempt');
  assert.ok(routes.includes('requireAssigned(access, training.id)'), 'the tick is the only door in for the team');
  assert.ok(routes.includes('Only the owner writes these trainings.'), 'writing is the owner\'s alone');
  assert.ok(routes.includes("attempt.status === 'pending_review' ? 'passed' : attempt.status"), 'in review mode the owner\'s accept is the pass');
});

test('the box UI: ticks, both judging choices, the either-or material, and per-person results with review', () => {
  const ui = read('src/components/training/OwnTraining.jsx');
  assert.ok(ui.includes("type=\"checkbox\""), 'assignment is by tick');
  assert.ok(ui.includes("setWrittenMode('auto')") && ui.includes("setWrittenMode('review')"), 'the owner chooses how written answers are judged');
  assert.ok(ui.includes('uploadOwnTrainingFile') && ui.includes('removeOwnTrainingFile'), 'the material file door mirrors the policies machinery');
  assert.ok(ui.includes('reviewOwnTrainingAttempt'), 'the owner reviews from the box');
  assert.ok(ui.includes("t('training.own.markPass')"), 'review mode is marked pass from the box');
  assert.ok(ui.includes('checkOwnTrainingAnswer'), 'multiple choice is checked on the spot for the taker');
  assert.ok(ui.includes('submitOwnTraining'), 'the run files to the server');
});
