/**
 * The training builds (Nov 20, 2026):
 *
 * 1. INTEGRITY — a lesson counts complete only when its quiz is
 *    answered correctly (the owner is exempt); lesson comments
 *    file quietly into the person's record; exactly ONE bell
 *    rings when a member finishes ALL their training; and the
 *    Workforce "First training" task's Done CHECKS real training
 *    completion before it strikes.
 * 2. SCOPING — nobody trains on what they don't have: lessons
 *    and steps follow the person's real doors (permissions,
 *    grants, ticks); core lessons are for everyone.
 * 3. THE OWNER'S QUIZ — her questions on her own Store Policies
 *    + Terms: two trainings, two ticks, instant multiple-choice
 *    feedback, typed answers judged nearly-word-for-word or
 *    filed to her for review, her passing line, send-back.
 * 4. THE VISIBILITY MAP — the owner-confidentiality lesson
 *    carries the two neutral wordings WORD FOR WORD.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
} from './helpers.js';
import { buildQuiz } from '../../server/trainingScope.js';
import { lessonById as serverLessonById } from '../../server/trainingCatalog.js';

after(close);
beforeEach(() => resetRateLimits());

const TR = (bid) => `/api/businesses/${bid}/training`;
const WF = (bid) => `/api/businesses/${bid}/workforce`;
const PQ = (bid) => `/api/businesses/${bid}/policy-quiz`;

const SALES_PERMS = [
  'products.view', 'scan.use', 'orders.manage', 'returns.manage',
  'listings.manage', 'reports.view', 'print.use',
];

async function addTeamMember(business, ownerId, email, { manager = false, name, roleId, permissions = '[]' } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, $7, 'active', $8)`,
    [
      id,
      business.id,
      name || (manager ? 'Manny Manager' : 'Sam Staff'),
      email,
      roleId || (manager ? 'preset-manager' : 'preset-sales'),
      manager ? 'Manager' : 'Sales clerk',
      permissions,
      ownerId,
    ],
  );
  const account = await registerVerifiedUser(email);
  return { staffId: id, email, cookie: account.cookie, user: account.user };
}

async function state(cookie, bid) {
  const res = await req(`${TR(bid)}/state`, { cookie });
  assert.equal(res.status, 200);
  return res.json;
}

async function inbox(cookie, bid) {
  const res = await req(`${WF(bid)}/notifications`, { cookie });
  assert.equal(res.status, 200);
  return res.json.notifications;
}

/** Answer a lesson's quiz correctly, the way the page would. */
async function passQuiz(cookie, bid, lessonId) {
  const st = await state(cookie, bid);
  const lesson = serverLessonById(lessonId);
  const steps = st.step_scope?.[lessonId]
    ?? Array.from({ length: lesson.steps }, (_, i) => i + 1);
  const quiz = buildQuiz(lesson, steps, {
    personKey: st.my_key,
    isBusiness: st.plan === 'business',
  });
  const res = await req(`${TR(bid)}/lessons/${lessonId}/quiz`, {
    method: 'POST',
    body: { answers: quiz.questions.map((q) => q.answer_index) },
    cookie,
  });
  assert.equal(res.status, 200, `quiz ${lessonId}: ${res.text}`);
  assert.equal(res.json.passed, true, `quiz ${lessonId} passes`);
  return res.json;
}

// ---- 1. Integrity: the quiz gate ---------------------------------------------

test('integrity: a lesson completes only through its quiz; the owner is exempt', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('tb-quiz@example.com');
  const staff = await addTeamMember(business, owner.id, 'tb-quiz-staff@example.com');

  // The quiz exists, is 5–8 questions, and leaks no answer key.
  const quizRes = await req(`${TR(business.id)}/lessons/clock-basics/quiz`, { cookie: staff.cookie });
  assert.equal(quizRes.status, 200);
  assert.ok(quizRes.json.questions.length >= 5 && quizRes.json.questions.length <= 8, 'quiz is 5–8 questions');
  assert.ok(!JSON.stringify(quizRes.json).includes('answer_index'), 'no answer key travels');

  // The plain complete door refuses a non-owner.
  const gated = await req(`${TR(business.id)}/lessons/clock-basics/complete`, {
    method: 'POST', body: {}, cookie: staff.cookie,
  });
  assert.equal(gated.status, 400);
  assert.equal(gated.json.error, 'quiz_required');

  // Wrong answers: not passed, no progress, and the attempt is filed.
  const wrong = await req(`${TR(business.id)}/lessons/clock-basics/quiz`, {
    method: 'POST',
    body: { answers: quizRes.json.questions.map(() => 99) },
    cookie: staff.cookie,
  });
  assert.equal(wrong.status, 200);
  assert.equal(wrong.json.passed, false);
  assert.ok(!wrong.json.completed_lesson_ids.includes('clock-basics'));
  const { rows: filed } = await pool.query(
    "SELECT passed FROM training_quiz_results WHERE business_id = $1 AND lesson_id = 'clock-basics'",
    [business.id],
  );
  assert.equal(filed.length, 1);
  assert.equal(filed[0].passed, false);

  // Correct answers: passed, progress recorded.
  const done = await passQuiz(staff.cookie, business.id, 'clock-basics');
  assert.ok(done.completed_lesson_ids.includes('clock-basics'));

  // The owner takes no quiz and completes directly.
  const ownerQuiz = await req(`${TR(business.id)}/lessons/owner-setup/quiz`, { cookie: ownerCookie });
  assert.equal(ownerQuiz.json.owner_exempt, true);
  const ownerDone = await req(`${TR(business.id)}/lessons/owner-setup/complete`, {
    method: 'POST', body: {}, cookie: ownerCookie,
  });
  assert.equal(ownerDone.status, 200);
});

test('integrity: lesson comments file quietly into the person\u2019s record', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('tb-comment@example.com');
  const staff = await addTeamMember(business, owner.id, 'tb-comment-staff@example.com');

  const bellsBefore = (await inbox(ownerCookie, business.id)).length;
  const sent = await req(`${TR(business.id)}/lessons/clock-basics/comments`, {
    method: 'POST', body: { body: 'The clock page moved — this lesson helped.' }, cookie: staff.cookie,
  });
  assert.equal(sent.status, 201);
  // Quietly: no bell rang for the comment.
  assert.equal((await inbox(ownerCookie, business.id)).length, bellsBefore);

  // The owner reads it in the person's record; staff cannot read records.
  const record = await req(`${TR(business.id)}/team/${staff.staffId}/results`, { cookie: ownerCookie });
  assert.equal(record.status, 200);
  assert.ok(record.json.comments.some((c) => c.body.includes('clock page moved')));
  assert.equal(
    (await req(`${TR(business.id)}/team/${staff.staffId}/results`, { cookie: staff.cookie })).status,
    403,
  );
});

// ---- 2. Scoping ----------------------------------------------------------------

test('scoping: lessons and steps follow the person\u2019s real doors', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('tb-scope@example.com');
  const staff = await addTeamMember(business, owner.id, 'tb-scope-staff@example.com');
  const viewer = await addTeamMember(business, owner.id, 'tb-scope-viewer@example.com', {
    name: 'Val Viewer', roleId: 'preset-viewer',
  });

  const st = await state(staff.cookie, business.id);
  const mine = new Set(st.my_lesson_ids);
  // Core for everyone.
  for (const id of ['welcome-basics', 'your-language', 'download-app', 'counts-run', 'clock-basics', 'stub-yours', 'dd-submit']) {
    assert.ok(mine.has(id), `core lesson ${id} is the sales clerk's`);
  }
  // Their doors: scanner, products, orders, returns, listings, printing.
  for (const id of ['scanner-lookup', 'products-find-edit', 'orders-basics', 'returns-basics', 'listings-basics', 'print-shelf-tag']) {
    assert.ok(mine.has(id), `${id} follows the sales clerk's doors`);
  }
  // Not their doors: categories, locations, import.
  for (const id of ['categories-basics', 'locations-basics', 'import-basics']) {
    assert.ok(!mine.has(id), `${id} is not trained on what they don't have`);
  }
  // Steps are scoped too: products-find-edit without the GS1 tick
  // shows steps 1–9 (10 is GS1-only, 11 is the owner's alone).
  assert.deepEqual(st.step_scope['products-find-edit'], [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // The viewer trains on far less.
  const vst = await state(viewer.cookie, business.id);
  const vmine = new Set(vst.my_lesson_ids);
  assert.ok(vmine.has('products-find-edit'), 'the viewer has products.view');
  assert.ok(!vmine.has('orders-basics'), 'the viewer has no orders door');
  assert.ok(!vmine.has('scanner-lookup'), 'the viewer has no scanner door');

  // The owner's GS1 tick brings step 10 to this person.
  const grown = await req(`/api/entities/StaffMember/${staff.staffId}`, {
    method: 'PATCH',
    body: { permissions: [...SALES_PERMS, 'settings.gs1'] },
    cookie: ownerCookie,
  });
  assert.equal(grown.status, 200);
  const st2 = await state(staff.cookie, business.id);
  assert.deepEqual(st2.step_scope['products-find-edit'], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // ...and the tick's training arrived as an assignment too.
  assert.ok(
    st2.assignments.some((a) => a.module === 'products' && a.source === 'role_grant'),
    'the GS1 tick brought its training',
  );
});

// ---- 1b. The First-training task gate + the ONE all-done bell -------------------

test('integrity: the First training task\u2019s Done checks real completion; one bell when ALL is done', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('tb-task@example.com');
  const viewer = await addTeamMember(business, owner.id, 'tb-task-viewer@example.com', {
    name: 'Val Viewer', roleId: 'preset-viewer',
  });

  // The owner's task, named in her own words — the title alone
  // marks it as a training task.
  const created = await req(`${WF(business.id)}/tasks`, {
    method: 'POST',
    body: { staff_member_id: viewer.staffId, title: 'First training' },
    cookie: ownerCookie,
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.task.kind, 'training');
  const taskId = created.json.task.id;

  // Done refuses while training is unfinished.
  const refused = await req(`${WF(business.id)}/tasks/${taskId}`, {
    method: 'PATCH', body: { status: 'done' }, cookie: viewer.cookie,
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error, 'training_incomplete');
  const stillOpen = await pool.query('SELECT status FROM work_tasks WHERE id = $1', [taskId]);
  assert.equal(stillOpen.rows[0].status, 'open');

  // Finish everything the viewer's doors scope to them.
  const st = await state(viewer.cookie, business.id);
  for (const id of st.my_lesson_ids) {
    await passQuiz(viewer.cookie, business.id, id);
  }

  // Exactly ONE all-done bell for the owner.
  const bells = (await inbox(ownerCookie, business.id)).filter((n) => n.event === 'training_all_done');
  assert.equal(bells.length, 1, 'one bell, once, when ALL training finished');

  // Now Done strikes.
  const struck = await req(`${WF(business.id)}/tasks/${taskId}`, {
    method: 'PATCH', body: { status: 'done' }, cookie: viewer.cookie,
  });
  assert.equal(struck.status, 200);
  assert.equal(struck.json.task.status, 'done');

  // An ordinary task never checks training.
  const plain = await req(`${WF(business.id)}/tasks`, {
    method: 'POST',
    body: { staff_member_id: viewer.staffId, title: 'Tidy the counter' },
    cookie: ownerCookie,
  });
  assert.equal(plain.json.task.kind, 'task');
  const plainDone = await req(`${WF(business.id)}/tasks/${plain.json.task.id}`, {
    method: 'PATCH', body: { status: 'done' }, cookie: viewer.cookie,
  });
  assert.equal(plainDone.status, 200);
});

// ---- 3. The owner's quiz ---------------------------------------------------------

test('owner\u2019s quiz: ticks assign it, picks are checked on the spot, the line and review hold', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('tb-pq@example.com');
  const staff = await addTeamMember(business, owner.id, 'tb-pq-staff@example.com');

  // The owner writes questions beside her Store Policies.
  const saved = await req(`${PQ(business.id)}/questions/policies`, {
    method: 'PUT',
    body: {
      pass_percent: 80,
      questions: [
        { kind: 'mc', question: 'When do we open?', choices: ['8 AM', '9 AM', '10 AM', 'Noon'], correct_index: 1 },
        { kind: 'mc', question: 'Who closes the till?', choices: ['Anyone', 'The closer on the schedule'], correct_index: 1 },
        { kind: 'open', question: 'What do we say when a customer walks in?', expected_answer: 'Welcome in, let me know if you need anything' },
      ],
    },
    cookie: ownerCookie,
  });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.questions.length, 3);

  // Writing is the owner's alone.
  assert.equal(
    (await req(`${PQ(business.id)}/questions/policies`, { cookie: staff.cookie })).status,
    403,
  );

  // Unticked: the training is not theirs.
  assert.equal(
    (await req(`${PQ(business.id)}/training/policies`, { cookie: staff.cookie })).status,
    403,
  );

  // Tick the policies training for this person.
  const ticked = await req(`/api/entities/StaffMember/${staff.staffId}`, {
    method: 'PATCH',
    body: { permissions: [...SALES_PERMS, 'training.policiesQuiz'] },
    cookie: ownerCookie,
  });
  assert.equal(ticked.status, 200);

  const training = await req(`${PQ(business.id)}/training/policies`, { cookie: staff.cookie });
  assert.equal(training.status, 200);
  assert.equal(training.json.questions.length, 3);
  assert.ok(!JSON.stringify(training.json).includes('correct_index'), 'no correct answers travel');
  assert.ok(!JSON.stringify(training.json).includes('expected_answer'), 'no expected answers travel');
  const [q1, q2, q3] = training.json.questions;

  // Instant feedback: a wrong pick is flagged on the spot.
  const wrongPick = await req(`${PQ(business.id)}/training/policies/check`, {
    method: 'POST', body: { question_id: q1.id, choice_index: 0 }, cookie: staff.cookie,
  });
  assert.deepEqual(wrongPick.json, { correct: false });
  const rightPick = await req(`${PQ(business.id)}/training/policies/check`, {
    method: 'POST', body: { question_id: q1.id, choice_index: 1 }, cookie: staff.cookie,
  });
  assert.deepEqual(rightPick.json, { correct: true });

  // Under the line: 1 of 2 multiple choice = 50% < 80% — NOT DONE.
  const below = await req(`${PQ(business.id)}/training/policies/submit`, {
    method: 'POST',
    body: {
      answers: [
        { question_id: q1.id, choice_index: 1 },
        { question_id: q2.id, choice_index: 0 },
        { question_id: q3.id, text: 'Welcome in, let me know if you need anything' },
      ],
    },
    cookie: staff.cookie,
  });
  assert.equal(below.json.status, 'below_line');
  assert.equal(below.json.score_percent, 50);

  // Over the line with a typed answer that does not match: the
  // training still closes, flagged for the owner's review.
  const passed = await req(`${PQ(business.id)}/training/policies/submit`, {
    method: 'POST',
    body: {
      answers: [
        { question_id: q1.id, choice_index: 1 },
        { question_id: q2.id, choice_index: 1 },
        { question_id: q3.id, text: 'Hello there friend' },
      ],
    },
    cookie: staff.cookie,
  });
  assert.equal(passed.json.status, 'passed');
  assert.equal(passed.json.score_percent, 100);
  assert.equal(passed.json.needs_review, true);

  // The answers file into the person's record, readable by the owner.
  const record = await req(`${TR(business.id)}/team/${staff.staffId}/results`, { cookie: ownerCookie });
  const attempt = record.json.policy_attempts.find((a) => a.status === 'passed');
  assert.ok(attempt, 'the passed attempt is filed');
  assert.equal(attempt.needs_review, true);
  const openAnswer = attempt.answers.find((a) => a.kind === 'open');
  assert.equal(openAnswer.text, 'Hello there friend');
  assert.equal(openAnswer.matched, false);

  // The owner accepts the answer.
  const accepted = await req(`${PQ(business.id)}/attempts/${attempt.id}/review`, {
    method: 'POST', body: { action: 'accept' }, cookie: ownerCookie,
  });
  assert.equal(accepted.json.needs_review, false);

  // A near-word-for-word typed answer counts as correct on the
  // spot — no review flag.
  const staff2 = await addTeamMember(business, owner.id, 'tb-pq-staff2@example.com', { name: 'Nia Near' });
  await req(`/api/entities/StaffMember/${staff2.staffId}`, {
    method: 'PATCH',
    body: { permissions: [...SALES_PERMS, 'training.policiesQuiz'] },
    cookie: ownerCookie,
  });
  const passed2 = await req(`${PQ(business.id)}/training/policies/submit`, {
    method: 'POST',
    body: {
      answers: [
        { question_id: q1.id, choice_index: 1 },
        { question_id: q2.id, choice_index: 1 },
        { question_id: q3.id, text: 'welcome in! Let me know if you need anything.' },
      ],
    },
    cookie: staff2.cookie,
  });
  assert.equal(passed2.json.status, 'passed');
  assert.equal(passed2.json.needs_review, false);

  // Send-back: the training reopens and the person is belled.
  const record2 = await req(`${TR(business.id)}/team/${staff2.staffId}/results`, { cookie: ownerCookie });
  const attempt2 = record2.json.policy_attempts[0];
  const sentBack = await req(`${PQ(business.id)}/attempts/${attempt2.id}/review`, {
    method: 'POST', body: { action: 'send_back', note: 'Please read the greeting again.' }, cookie: ownerCookie,
  });
  assert.equal(sentBack.json.status, 'sent_back');
  assert.ok(
    (await inbox(staff2.cookie, business.id)).some((n) => n.event === 'training_sent_back'),
    'the person hears their training was sent back',
  );
  const retake = await req(`${PQ(business.id)}/training/policies`, { cookie: staff2.cookie });
  assert.equal(retake.json.latest_attempt.status, 'sent_back');

  // The terms training is separate: ticked for nobody, and with
  // no questions written its submit is the reading itself.
  const tickedTerms = await req(`/api/entities/StaffMember/${staff.staffId}`, {
    method: 'PATCH',
    body: { permissions: [...SALES_PERMS, 'training.policiesQuiz', 'training.termsQuiz'] },
    cookie: ownerCookie,
  });
  assert.equal(tickedTerms.status, 200);
  const reading = await req(`${PQ(business.id)}/training/terms/submit`, {
    method: 'POST', body: { answers: [] }, cookie: staff.cookie,
  });
  assert.equal(reading.json.status, 'passed');
  assert.equal(reading.json.reading_only, true);
});

// ---- 4. The visibility map --------------------------------------------------------

test('visibility map: the confidentiality lesson carries both neutral wordings word for word', async () => {
  const { en } = await import('../../src/lib/locales/en.js');
  const server = await import('../../server/trainingCatalog.js');
  const lesson = server.lessonById('owner-confidentiality');
  assert.equal(lesson.steps, 7);
  assert.ok(
    en['training.lessons.owner-confidentiality.step6'].includes(
      'Changes are turned off right now. Nothing can be added or changed at the moment — please ask the owner of the business if you need anything.',
    ),
    'the stop wording, word for word',
  );
  assert.ok(
    en['training.lessons.owner-confidentiality.step7'].includes(
      'That can\u2019t be added right now — please ask the owner of the business.',
    ) || en['training.lessons.owner-confidentiality.step7'].includes(
      "That can't be added right now — please ask the owner of the business.",
    ),
    'the limit wording, word for word',
  );
  // The whole map is taught: trial, plan, price, payment, limits.
  const map = en['training.lessons.owner-confidentiality.step5'];
  for (const word of ['trial', 'plan', 'costs', 'payment', 'limit']) {
    assert.ok(map.toLowerCase().includes(word), `the map names ${word}`);
  }
});
