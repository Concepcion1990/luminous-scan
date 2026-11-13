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
 * Training is on BOTH plans — no plan gate anywhere here.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import { businessTimezone, localParts, personLevel } from './workforceRoutes.js';
import {
  MODULE_LABELS,
  TRAINING_LESSONS,
  TRAINING_MODULES,
  lessonById,
  lessonsForModuleAtLevel,
  visibleTracksForLevel,
} from './trainingCatalog.js';
import {
  OWNER_PERSON_KEY,
  assignmentsForPerson,
  completedLessonIds,
  completedLessons,
  createOrExtendAssignment,
  publicAssignment,
  ringBell,
  userForStaffRow,
} from './trainingCore.js';

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
    return res.json({
      is_owner: access.isOwner,
      level,
      my_key: myKey(access),
      my_name: access.isOwner ? 'Owner' : access.staffRow?.full_name || req.user.email,
      plan: access.planKey,
      today,
      tracks: visibleTracksForLevel(level),
      completed_lesson_ids: completions.map((row) => row.lesson_id),
      completions,
      assignments: await myAssignments(access, today),
    });
  }));

  router.post(`${base}/lessons/:lessonId/complete`, asyncHandler(async (req, res) => {
    const { access, level } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const lesson = lessonById(req.params.lessonId);
    if (!lesson) throw err(404, 'not_found', 'That lesson does not exist.');
    if (!visibleTracksForLevel(level).includes(lesson.track)) {
      throw err(403, 'forbidden', 'That lesson is not part of your training.');
    }
    const key = myKey(access);
    const existing = await pool().query(
      'SELECT id FROM training_progress WHERE business_id = $1 AND person_key = $2 AND lesson_id = $3 LIMIT 1',
      [access.business.id, key, lesson.id],
    );
    if (!existing.rows[0]) {
      await pool().query(
        `INSERT INTO training_progress (id, business_id, person_key, person_user_id, person_name, lesson_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          crypto.randomUUID(), access.business.id, key, req.user.id,
          access.isOwner ? 'Owner' : access.staffRow?.full_name || '', lesson.id,
        ],
      );
    }
    const today = todayLocal(access.business);
    const completed = await completedLessonIds(pool(), access.business.id, key);
    return res.json({
      ok: true,
      completed_lesson_ids: [...completed],
      assignments: await myAssignments(access, today),
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
      const total = TRAINING_LESSONS.filter((l) => tracks.includes(l.track)).length;
      const completedSet = await completedLessonIds(pool(), access.business.id, row.id);
      const assignments = (await assignmentsForPerson(pool(), access.business.id, row.id)).map((row2) =>
        withOverdue(row2, today),
      );
      peopleOut.push({
        staff_id: row.id,
        full_name: row.full_name,
        email: row.email,
        role_name: row.role_name || '',
        level: personLvl,
        lessons_total: total,
        lessons_done: [...completedSet].filter((id) => {
          const l = lessonById(id);
          return l && tracks.includes(l.track);
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
    const lessons = lessonsForModuleAtLevel(module, targetLevel);
    if (!lessons.length) {
      throw err(400, 'no_lessons', 'That topic has no lessons for this person\u2019s role.');
    }
    const dueDate = dueDateFromBody(body, access.business);
    const targetUser = await userForStaffRow(pool(), target);
    const actorName = access.isOwner ? 'Owner' : me?.full_name || req.user.email;
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
    const actorName = access.isOwner ? 'Owner' : me?.full_name || req.user.email;
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
