// Release 360 (Nov 23, 2026): completion preservation — the quiz
// repair changed NO completion state. Rows written before 360 in
// the exact pre-360 shape (training_progress rows planted
// directly, a passed training_quiz_results row) still read back
// as completions everywhere they surfaced before: the person's
// own state, the idempotent complete door, the owner's team
// counts, and the per-person results record. The integrity rule
// is unchanged too: an unfinished lesson still refuses the plain
// complete door with quiz_required and finishes only through its
// live quiz. Fixture style mirrors tests/t10/training.test.js.
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
import { lessonById } from '../../server/trainingCatalog.js';

after(close);
beforeEach(() => resetRateLimits());

const TR = (bid) => `/api/businesses/${bid}/training`;

/** Insert a trusted active staff row (created by the owner), then register its user. */
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

/** Pass a lesson's quiz the way the page does: rebuild it with the
 *  server's own builder over the steps the state says this person
 *  can see, and answer every question correctly. */
async function passQuiz(cookie, bid, lessonId) {
  const st = await state(cookie, bid);
  const lesson = lessonById(lessonId);
  assert.ok(lesson, `${lessonId} exists`);
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

/** Plant a completion row directly, in the exact pre-360 shape. */
async function plantProgress(businessId, personKey, personUserId, personName, lessonId) {
  await pool.query(
    `INSERT INTO training_progress (id, business_id, person_key, person_user_id, person_name, lesson_id, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '7 days')`,
    [crypto.randomUUID(), businessId, personKey, personUserId, personName, lessonId],
  );
}

test('(a) pre-360 rows still read as completions: state, idempotent complete, team counts, results record', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('t57-preserve@example.com');
  const staff = await addTeamMember(business, owner.id, 't57-preserve-staff@example.com');

  await plantProgress(business.id, staff.staffId, staff.user.id, 'Sam Staff', 'clock-basics');
  await plantProgress(business.id, staff.staffId, staff.user.id, 'Sam Staff', 'counts-run');
  await pool.query(
    `INSERT INTO training_quiz_results (id, business_id, person_key, person_name, lesson_id, total, correct, passed)
     VALUES ($1, $2, $3, $4, 'clock-basics', 5, 5, true)`,
    [crypto.randomUUID(), business.id, staff.staffId, 'Sam Staff'],
  );

  const mine = await state(staff.cookie, business.id);
  assert.ok(mine.completed_lesson_ids.includes('clock-basics'), 'planted clock-basics shows complete');
  assert.ok(mine.completed_lesson_ids.includes('counts-run'), 'planted counts-run shows complete');

  // The complete door stays idempotent for a finished lesson —
  // 200, no quiz demand.
  const again = await req(`${TR(business.id)}/lessons/clock-basics/complete`, {
    method: 'POST', body: {}, cookie: staff.cookie,
  });
  assert.equal(again.status, 200, `idempotent complete: ${again.text}`);
  assert.ok(again.json.completed_lesson_ids.includes('clock-basics'));

  const team = await req(`${TR(business.id)}/team`, { cookie: ownerCookie });
  assert.equal(team.status, 200);
  const row = team.json.people.find((p) => p.staff_id === staff.staffId);
  assert.ok(row, 'the staff member is on the owner team view');
  assert.ok(row.lessons_done >= 2, `team counts the planted lessons (lessons_done=${row.lessons_done})`);

  const results = await req(`${TR(business.id)}/team/${staff.staffId}/results`, { cookie: ownerCookie });
  assert.equal(results.status, 200);
  const planted = results.json.quiz_results.find((r) => r.lesson_id === 'clock-basics');
  assert.ok(planted, 'the planted quiz result is in the record');
  assert.equal(planted.passed, true, 'the planted result reads as passed');
});

test('(b) integrity unchanged: an unfinished lesson still needs its live quiz', async () => {
  const { business, user: owner } = await ownerWithBusiness('t57-integrity@example.com');
  const staff = await addTeamMember(business, owner.id, 't57-integrity-staff@example.com');

  const gated = await req(`${TR(business.id)}/lessons/schedule-yours/complete`, {
    method: 'POST', body: {}, cookie: staff.cookie,
  });
  assert.equal(gated.status, 400);
  assert.equal(gated.json.error, 'quiz_required');

  const done = await passQuiz(staff.cookie, business.id, 'schedule-yours');
  assert.ok(done.completed_lesson_ids.includes('schedule-yours'), 'the live quiz completes the lesson');
});

test('(c) Business plan: a planted owner completion for a Business-only lesson shows complete', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('t57-bizpreserve@example.com', 'Biz', { plan: 'business' });

  await plantProgress(business.id, 'owner', owner.id, 'Owner', 'owner-restaurant');

  const mine = await state(ownerCookie, business.id);
  assert.ok(
    mine.completed_lesson_ids.includes('owner-restaurant'),
    "the owner's state shows the planted Business lesson complete",
  );
});
