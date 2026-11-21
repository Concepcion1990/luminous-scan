/**
 * Training routes — the Training page's server side (Training phase).
 *
 *   GET   /api/businesses/:bid/training/state
 *   POST  /api/businesses/:bid/training/lessons/:lessonId/complete
 *   GET   /api/businesses/:bid/training/team            owner / manager
 *   POST  /api/businesses/:bid/training/assignments     owner / manager
 *   PATCH /api/businesses/:bid/training/assignments/:id owner / manager
 *   POST  /api/businesses/:bid/training/assignments/:id/warn
 *
 * TRACKS (the owner's spec): staff see the staff track; managers see
 * manager + staff; the owner sees all three. Every check is derived
 * server-side from the caller's staff row, like Workforce.
 *
 * HIERARCHY for assignments, deadlines and warnings — the same shape
 * as the rest of Workforce: the OWNER may assign to anyone,
 * including the MANAGER; a MANAGER may assign to STAFF only; the
 * manager's own training, deadline and warnings belong to the owner
 * alone. A warning can only be sent when a deadline exists and has
 * passed with lessons still unfinished (the strict rule — a warning
 * is about an unmet deadline, never a nudge).
 *
 * Training is on BOTH plans — the page itself is never gated. But
 * lesson VISIBILITY obeys the invisibility doctrine (owner ruling,
 * Nov 14, 2026): lessons about Business-only features do not
 * exist on Essentials — team totals/done counts and assignment
 * lesson lists are computed over the plan-visible lessons only.
 *
 * ASSIGN EVERYTHING (owner ruling, Nov 15, 2026): a MANUAL
 * assignment carries the module's FULL plan catalog — every
 * plan-visible lesson in the module, across all three tracks —
 * whatever the assignee's current role. The owner may be
 * preparing a staff member for a manager's chair, or widening a
 * manager's remit; the person's current role never trims the
 * list, on Essentials or on Business alike. An assigned lesson
 * is also the assignee's to COMPLETE, even when its track sits
 * above their role — the assignment is the permission. (The
 * role-grant hooks in trainingCore.js are a different door —
 * automatic, permission-driven — and still arrive at the
 * person's level.)
 *
 * JOIN SEED (owner ruling, Nov 15, 2026): nobody waits for a
 * role change to meet their training. Creating a StaffMember
 * row — and accepting the invite at sign-in — sets the member's
 * own-track training in place: every module with lessons at
 * their level, plan-filtered, already assigned when they first
 * open this page. A promotion that lifts their level re-seeds
 * at the new one. Extra training beyond the role remains the
 * owner's hand through the Assign box above.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import { businessTimezone, localParts, personLevel } from './workforceRoutes.js';
import { ownerPublicName } from './profilePhotos.js';
import {
  MODULE_LABELS,
  TRAINING_LESSONS,
  TRAINING_MODULES,
  lessonById,
  lessonVisibleOnPlan,
  visibleTracksForLevel,
} from './trainingCatalog.js';
import {
  OWNER_PERSON_KEY,
  assignmentsForPerson,
  completedLessonIds,
  completedLessons,
  createOrExtendAssignment,
  publicAssignment,
  recordLessonCompletion,
  ringBell,
  userForStaffRow,
} from './trainingCore.js';
import {
  buildQuiz,
  publicQuiz,
  scopedLessonIds,
  visibleStepNumbers,
} from './trainingScope.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] training route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

async function accessOr403(pool, user, businessId) {
  const access = await resolveAccess(pool, user, businessId);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  return access;
}

function callerLevel(access) {
  if (access.isOwner) return 'owner';
  return personLevel(access.staffRow);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isDateStr(value) {
  return DATE_RE.test(String(value || '')) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}
function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function todayLocal(business) {
  return localParts(new Date(), businessTimezone(business)).dateStr;
}

function withOverdue(pub, today) {
  return {
    ...pub,
    overdue: pub.status !== 'completed' && Boolean(pub.due_date) && pub.due_date < today,
  };
}

/** Resolve an assignment's deadline from a request body. */
function dueDateFromBody(body, business) {
  if (body?.due_date !== undefined && body?.due_date !== null && body?.due_date !== '') {
    if (!isDateStr(body.due_date)) throw err(400, 'invalid_value', 'due_date must be a YYYY-MM-DD date.');
    return body.due_date;
  }
  if (body?.due_in_days !== undefined && body?.due_in_days !== null && body?.due_in_days !== '') {
    const days = Number(body.due_in_days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw err(400, 'invalid_value', 'due_in_days must be a whole number between 1 and 365.');
    }
    return addDays(todayLocal(business), days);
  }
  return null;
}

export function createTrainingRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/training';

  async function ctx(req) {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    return { access, level: callerLevel(access), me: access.staffRow };
  }

  function myKey(access) {
    return access.isOwner ? OWNER_PERSON_KEY : access.staffRow.id;
  }

  async function myAssignments(access, today) {
    const rows = await assignmentsForPerson(pool(), access.business.id, myKey(access));
    return rows.map((row) => withOverdue(row, today));
  }

  async function assignmentOr404(businessId, id) {
    const { rows } = await pool().query(
      'SELECT * FROM training_assignments WHERE id = $1 AND business_id = $2 LIMIT 1',
      [id, businessId],
    );
    if (!rows[0]) throw err(404, 'not_found', 'That assignment is not in this business.');
    return rows[0];
  }

  /**
   * The assignment hierarchy, checked against the ASSIGNEE: the
   * owner may act on anyone; a manager only on staff assignees;
   * staff may not act at all.
   */
  function requireAssignRights(level, assignment) {
    if (level === 'owner') return;
    if (level === 'manager' && assignment.assignee_level === 'staff') return;
    throw err(403, 'forbidden', 'You cannot manage this person\u2019s training.');
  }

  // ---- My state ----------------------------------------------------------

  router.get(`${base}/state`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    const today = todayLocal(access.business);
    const completions = await completedLessons(pool(), access.business.id, myKey(access));
    const assignments = await myAssignments(access, today);
    // Scoping (Nov 20, 2026): the page shows a person only the
    // lessons their real doors open — their door scope, plus
    // anything ever assigned to them, plus anything already
    // finished (history is never ripped out). The owner sees
    // everything. Step scope rides along per lesson.
    const isBusiness = access.planKey === 'business';
    const mine = new Set(
      access.isOwner
        ? TRAINING_LESSONS.filter((l) => lessonVisibleOnPlan(l, isBusiness)).map((l) => l.id)
        : scopedLessonIds({ level, permissions: access.permissions || [], isBusiness }),
    );
    for (const assignment of assignments) {
      for (const id of assignment.lesson_ids || []) mine.add(id);
    }
    for (const row of completions) mine.add(row.lesson_id);
    const stepScope = {};
    for (const id of mine) {
      const lesson = lessonById(id);
      if (!lesson) continue;
      stepScope[id] = visibleStepNumbers(lesson, {
        permissions: access.permissions || [],
        isOwner: access.isOwner,
      });
    }
    const { rows: myComments } = await pool().query(
      `SELECT lesson_id, body, created_at FROM training_lesson_comments
        WHERE business_id = $1 AND person_key = $2 ORDER BY created_at DESC`,
      [access.business.id, myKey(access)],
    );
    return res.json({
      is_owner: access.isOwner,
      level,
      my_key: myKey(access),
      my_name: access.isOwner ? await ownerPublicName(pool(), access.business) : access.staffRow?.full_name || req.user.email,
      plan: access.planKey,
      today,
      tracks: visibleTracksForLevel(level),
      completed_lesson_ids: completions.map((row) => row.lesson_id),
      completions,
      assignments,
      my_lesson_ids: [...mine],
      step_scope: stepScope,
      my_comments: myComments,
    });
  }));

  /** The door check shared by completion and the quiz: a lesson
   *  is the caller's to finish when it was ASSIGNED to them (owner
   *  ruling, Nov 15, 2026: the assignment is the permission), or
   *  when it sits in their own tracks AND their real doors scope
   *  it to them (Nov 20, 2026). The owner walks through every
   *  door. */
  async function requireLessonDoor(access, level, lesson) {
    if (access.isOwner) return;
    const mine = await assignmentsForPerson(pool(), access.business.id, myKey(access));
    if (mine.some((a) => (a.lesson_ids || []).includes(lesson.id))) return;
    if (!visibleTracksForLevel(level).includes(lesson.track)) {
      throw err(403, 'forbidden', 'That lesson is not part of your training.');
    }
    const scoped = scopedLessonIds({
      level,
      permissions: access.permissions || [],
      isBusiness: access.planKey === 'business',
    });
    if (!scoped.includes(lesson.id)) {
      throw err(403, 'forbidden', 'That lesson is not part of your training.');
    }
  }

  function myVisibleSteps(access, lesson) {
    return visibleStepNumbers(lesson, {
      permissions: access.permissions || [],
      isOwner: access.isOwner,
    });
  }

  router.post(`${base}/lessons/:lessonId/complete`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const lesson = lessonById(req.params.lessonId);
    if (!lesson) throw err(404, 'not_found', 'That lesson does not exist.');
    const key = myKey(access);
    const already = await completedLessonIds(pool(), access.business.id, key);
    if (!already.has(lesson.id)) {
      await requireLessonDoor(access, level, lesson);
      // Integrity (Nov 20, 2026): a lesson counts complete only
      // when its quiz is answered correctly. The OWNER is exempt
      // — "don't torture the owner" — everyone else goes through
      // the quiz door below.
      if (!access.isOwner) {
        throw err(400, 'quiz_required', 'This lesson finishes with a short quiz — answer it correctly to complete the lesson.');
      }
      await recordLessonCompletion(pool(), access.business, {
        personKey: key,
        personUserId: req.user.id,
        // The owner's display name (Nov 21, 2026): their team
        // record names the person, not the bare label, once a
        // name is set.
        personName: await ownerPublicName(pool(), access.business),
        lessonId: lesson.id,
      });
    }
    const today = todayLocal(access.business);
    const completed = await completedLessonIds(pool(), access.business.id, key);
    return res.json({
      ok: true,
      completed_lesson_ids: [...completed],
      assignments: await myAssignments(access, today),
    });
  }));

  // ---- The per-lesson quiz -------------------------------------------------

  router.get(`${base}/lessons/:lessonId/quiz`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    const lesson = lessonById(req.params.lessonId);
    if (!lesson) throw err(404, 'not_found', 'That lesson does not exist.');
    if (access.isOwner) return res.json({ owner_exempt: true, questions: [] });
    await requireLessonDoor(access, level, lesson);
    const quiz = buildQuiz(lesson, myVisibleSteps(access, lesson), {
      personKey: myKey(access),
      isBusiness: access.planKey === 'business',
    });
    return res.json(publicQuiz(quiz));
  }));

  router.post(`${base}/lessons/:lessonId/quiz`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const lesson = lessonById(req.params.lessonId);
    if (!lesson) throw err(404, 'not_found', 'That lesson does not exist.');
    if (access.isOwner) {
      throw err(400, 'owner_exempt', 'The owner does not take quizzes.');
    }
    await requireLessonDoor(access, level, lesson);
    const key = myKey(access);
    const quiz = buildQuiz(lesson, myVisibleSteps(access, lesson), {
      personKey: key,
      isBusiness: access.planKey === 'business',
    });
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    if (answers.length !== quiz.questions.length) {
      throw err(400, 'quiz_changed', 'That quiz has changed — open it again and answer the questions shown.');
    }
    let correct = 0;
    quiz.questions.forEach((question, i) => {
      if (Number(answers[i]) === question.answer_index) correct += 1;
    });
    const total = quiz.questions.length;
    const passed = correct === total;
    const personName = access.staffRow?.full_name || '';
    await pool().query(
      `INSERT INTO training_quiz_results (id, business_id, person_key, person_name, lesson_id, total, correct, passed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [crypto.randomUUID(), access.business.id, key, personName, lesson.id, total, correct, passed],
    );
    if (passed) {
      await recordLessonCompletion(pool(), access.business, {
        personKey: key,
        personUserId: req.user.id,
        personName,
        lessonId: lesson.id,
        memberRow: access.staffRow,
        planKey: access.planKey,
      });
    }
    const today = todayLocal(access.business);
    const completed = await completedLessonIds(pool(), access.business.id, key);
    return res.json({
      passed,
      correct,
      total,
      completed_lesson_ids: [...completed],
      assignments: await myAssignments(access, today),
    });
  }));

  // ---- Per-lesson comments to the owner -------------------------------------

  router.post(`${base}/lessons/:lessonId/comments`, asyncHandler(async (req, res) => {
    const { access } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const lesson = lessonById(req.params.lessonId);
    if (!lesson) throw err(404, 'not_found', 'That lesson does not exist.');
    if (access.isOwner) {
      throw err(403, 'forbidden', 'Comments on a lesson go to the owner — you are the owner.');
    }
    const body = String(req.body?.body || '').trim().slice(0, 1000);
    if (!body) throw err(400, 'invalid_value', 'Write the comment first.');
    const id = crypto.randomUUID();
    const personName = access.staffRow?.full_name || '';
    await pool().query(
      `INSERT INTO training_lesson_comments (id, business_id, person_key, person_name, lesson_id, body)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, access.business.id, myKey(access), personName, lesson.id, body],
    );
    // Filed quietly into the person's record (owner ruling,
    // Nov 20, 2026): no bell rings for a comment.
    return res.status(201).json({ comment: { id, lesson_id: lesson.id, body, person_name: personName } });
  }));

  // ---- One person's filed record (quiz results + comments) ------------------

  router.get(`${base}/team/:staffId/results`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    if (level === 'staff') throw err(403, 'forbidden', 'Team records are for the owner and managers.');
    const { rows } = await pool().query(
      'SELECT * FROM staff_members WHERE id = $1 AND business_id = $2 LIMIT 1',
      [req.params.staffId, access.business.id],
    );
    const target = rows[0];
    if (!target) throw err(404, 'not_found', 'That team member is not in this business.');
    if (level === 'manager' && personLevel(target) !== 'staff') {
      throw err(403, 'forbidden', 'You cannot read this person\u2019s training record.');
    }
    const { rows: quizResults } = await pool().query(
      `SELECT lesson_id, total, correct, passed, created_at FROM training_quiz_results
        WHERE business_id = $1 AND person_key = $2 ORDER BY created_at DESC LIMIT 200`,
      [access.business.id, target.id],
    );
    const { rows: comments } = await pool().query(
      `SELECT lesson_id, body, created_at FROM training_lesson_comments
        WHERE business_id = $1 AND person_key = $2 ORDER BY created_at DESC LIMIT 200`,
      [access.business.id, target.id],
    );
    const { rows: policyAttempts } = await pool().query(
      `SELECT id, doc_kind, mc_total, mc_correct, score_percent, status, needs_review, review_note, answers, created_at
         FROM policy_quiz_attempts
        WHERE business_id = $1 AND person_key = $2 ORDER BY created_at DESC LIMIT 50`,
      [access.business.id, target.id],
    );
    return res.json({
      staff_id: target.id,
      quiz_results: quizResults,
      comments,
      policy_attempts: policyAttempts,
    });
  }));

  // ---- Team progress -----------------------------------------------------

  router.get(`${base}/team`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    if (level === 'staff') throw err(403, 'forbidden', 'Team progress is for the owner and managers.');
    const today = todayLocal(access.business);
    const { rows: team } = await pool().query(
      "SELECT * FROM staff_members WHERE business_id = $1 AND status IN ('active', 'invited') ORDER BY full_name ASC",
      [access.business.id],
    );
    const peopleOut = [];
    for (const row of team) {
      const personLvl = personLevel(row);
      // A manager sees staff only — never other managers, never the owner.
      if (level === 'manager' && personLvl !== 'staff') continue;
      const tracks = visibleTracksForLevel(personLvl);
      // Plan visibility (owner ruling, Nov 14, 2026): totals and
      // done counts cover only the lessons this plan actually has —
      // progress recorded against a now-hidden lesson stays stored
      // and simply never enters either number here.
      const isBusiness = access.planKey === 'business';
      const total = TRAINING_LESSONS.filter(
        (l) => tracks.includes(l.track) && lessonVisibleOnPlan(l, isBusiness),
      ).length;
      const completedSet = await completedLessonIds(pool(), access.business.id, row.id);
      const assignments = (await assignmentsForPerson(pool(), access.business.id, row.id)).map((row2) =>
        withOverdue(row2, today),
      );
      peopleOut.push({
        staff_id: row.id,
        full_name: row.full_name,
        // Progress travels by name: a manager's team payload
        // carries no staff email addresses (audit B4, Nov 21,
        // 2026); the owner's view keeps them.
        ...(access.isOwner ? { email: row.email } : {}),
        role_name: row.role_name || '',
        level: personLvl,
        lessons_total: total,
        lessons_done: [...completedSet].filter((id) => {
          const l = lessonById(id);
          return l && tracks.includes(l.track) && lessonVisibleOnPlan(l, isBusiness);
        }).length,
        assignments,
      });
    }
    return res.json({ people: peopleOut, today });
  }));

  // ---- Assignments ---------------------------------------------------------

  router.post(`${base}/assignments`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    if (level === 'staff') throw err(403, 'forbidden', 'Only the owner and managers can assign training.');
    const body = req.body || {};
    const module = String(body.module || '');
    if (!TRAINING_MODULES.includes(module)) {
      throw err(400, 'invalid_value', 'Choose a training topic to assign.');
    }
    const staffId = String(body.staff_member_id || '');
    const { rows } = await pool().query(
      'SELECT * FROM staff_members WHERE id = $1 AND business_id = $2 LIMIT 1',
      [staffId, access.business.id],
    );
    const target = rows[0];
    if (!target) throw err(404, 'not_found', 'That team member is not in this business.');
    const targetLevel = personLevel(target);
    requireAssignRights(level, { assignee_level: targetLevel });
    // The module's full plan catalog (owner ruling, Nov 15,
    // 2026) — every plan-visible lesson in the module, all
    // tracks, never trimmed by the assignee's current role.
    const lessons = TRAINING_LESSONS.filter(
      (lesson) => lesson.module === module && lessonVisibleOnPlan(lesson, access.planKey === 'business'),
    );
    if (!lessons.length) {
      throw err(400, 'no_lessons', 'That topic has no lessons on this plan.');
    }
    const dueDate = dueDateFromBody(body, access.business);
    const targetUser = await userForStaffRow(pool(), target);
    const actorName = access.isOwner ? await ownerPublicName(pool(), access.business) : me?.full_name || req.user.email;
    const label = MODULE_LABELS[module] || module;
    const { assignment } = await createOrExtendAssignment(pool(), access.business, {
      assigneeRow: target,
      assigneeKey: target.id,
      assigneeUserId: targetUser?.id ?? null,
      assigneeName: target.full_name || '',
      assigneeLevel: targetLevel,
      module,
      lessonIds: lessons.map((l) => l.id),
      source: 'manual',
      assignedBy: {
        userId: req.user.id,
        staffId: access.isOwner ? null : me?.id ?? null,
        name: actorName,
      },
      dueDate,
      bellDetail: `New training for you: ${label}, assigned by ${actorName}.${dueDate ? ` Please finish by ${dueDate}.` : ''}`,
    });
    const completedSet = await completedLessonIds(pool(), access.business.id, target.id);
    const today = todayLocal(access.business);
    return res.status(201).json({ assignment: withOverdue(publicAssignment(assignment, completedSet), today) });
  }));

  router.patch(`${base}/assignments/:id`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    if (level === 'staff') throw err(403, 'forbidden', 'Only the owner and managers can change a deadline.');
    const assignment = await assignmentOr404(access.business.id, req.params.id);
    requireAssignRights(level, assignment);
    const completedSet = await completedLessonIds(pool(), access.business.id, assignment.assignee_key);
    const pub = publicAssignment(assignment, completedSet);
    if (pub.status === 'completed') throw err(400, 'already_completed', 'That training is already finished.');
    const clear = (req.body || {}).due_date === null && (req.body || {}).due_in_days === undefined;
    const dueDate = clear ? null : dueDateFromBody(req.body || {}, access.business);
    await pool().query(
      'UPDATE training_assignments SET due_date = $2, updated_at = NOW() WHERE id = $1',
      [assignment.id, dueDate],
    );
    assignment.due_date = dueDate;
    const today = todayLocal(access.business);
    return res.json({ assignment: withOverdue(publicAssignment(assignment, completedSet), today) });
  }));

  router.post(`${base}/assignments/:id/warn`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    if (level === 'staff') throw err(403, 'forbidden', 'Only the owner and managers can send a training warning.');
    const assignment = await assignmentOr404(access.business.id, req.params.id);
    requireAssignRights(level, assignment);
    const completedSet = await completedLessonIds(pool(), access.business.id, assignment.assignee_key);
    const pub = publicAssignment(assignment, completedSet);
    if (pub.status === 'completed') {
      throw err(400, 'already_completed', 'That training is already finished — there is nothing to warn about.');
    }
    const today = todayLocal(access.business);
    if (!pub.due_date) {
      throw err(400, 'no_deadline', 'This training has no deadline, so it cannot be overdue.');
    }
    if (pub.due_date >= today) {
      throw err(400, 'not_overdue', 'The deadline has not passed yet.');
    }
    if (!assignment.assignee_user_id) {
      throw err(400, 'no_account', 'That person has no app account yet, so there is nowhere to send the warning.');
    }
    await pool().query(
      'UPDATE training_assignments SET warning_sent_at = NOW(), updated_at = NOW() WHERE id = $1',
      [assignment.id],
    );
    assignment.warning_sent_at = new Date().toISOString();
    const actorName = access.isOwner ? await ownerPublicName(pool(), access.business) : me?.full_name || req.user.email;
    await ringBell(pool(), access.business, {
      recipientUserId: assignment.assignee_user_id,
      recipientStaffId: assignment.assignee_staff_id,
      recipientRole: assignment.assignee_level,
      actorStaffId: access.isOwner ? null : me?.id ?? null,
      actorName,
      event: 'training_warning',
      detail: `Training warning: your ${MODULE_LABELS[assignment.module] || assignment.module} training was due ${pub.due_date} and is not finished yet.`,
      refId: assignment.id,
    });
    return res.json({ assignment: withOverdue(publicAssignment(assignment, completedSet), today) });
  }));

  return router;
}
