/**
 * Training core — the database side of the Training phase, shared
 * by the training routes (server/trainingRoutes.js) and the
 * role-grant hooks wired into the entity writes
 * (server/entities.js).
 *
 * THE OWNER'S TRAINING FLAG: when a person's role or permissions
 * GROW, the new parts of the app arrive with lessons attached. The
 * hooks below compare the person's EFFECTIVE permission set before
 * and after a StaffMember or StaffRole write — effective meaning
 * the stored list when one is set, otherwise the role's list,
 * exactly as resolveAccess (server/authz.js) computes it, plan
 * filter included — and for every permission that is genuinely new
 * they create (or extend) a training assignment for the modules
 * that permission opens up, and ring the person's bell. Shrinks and
 * no-change writes assign nothing.
 *
 * The hooks NEVER throw into the write that triggered them: a
 * training hiccup must not fail a role edit. Failures are logged.
 *
 * THE JOIN SEED (owner ruling, Nov 15, 2026): a person does not
 * wait for a role change to meet their training. The moment a
 * StaffMember row is created — and again when an invited row is
 * accepted at sign-in, healing rows written before the seed
 * existed — seedRoleTrainingForMember assigns the member's OWN
 * track: every module with lessons at their level, plan-filtered.
 * A promotion that lifts their LEVEL (staff -> manager) re-seeds
 * at the new level. Automatic doors stay at the person's own
 * level, always; widening beyond it is the owner's hand through
 * the manual Assign box, never an automatic door's business.
 */
import crypto from 'node:crypto';
import { parseJsonArray, presetRoleById } from './authz.js';
import { permissionsForPlan } from './plans.js';
import {
  MODULE_BY_PERMISSION,
  MODULE_LABELS,
  TRAINING_LESSONS,
  TRAINING_MODULES,
  lessonsForModuleAtLevel,
  lessonVisibleOnPlan,
} from './trainingCatalog.js';
import { personLevel } from './workforceRoutes.js';
import { lessonInScope, scopedLessonIds } from './trainingScope.js';

export const OWNER_PERSON_KEY = 'owner';

export function personKeyForRow(row) {
  return row ? row.id : OWNER_PERSON_KEY;
}

export async function userForStaffRow(pool, row) {
  if (!row) return null;
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [row.email],
  );
  return rows[0] ?? null;
}

/** One workforce bell, same row shape as every other team event. */
export async function ringBell(pool, business, {
  recipientUserId,
  recipientStaffId = null,
  recipientRole = 'staff',
  actorStaffId = null,
  actorName = '',
  event,
  detail,
  refId = null,
}) {
  if (!recipientUserId) return;
  await pool.query(
    `INSERT INTO workforce_notifications
       (id, business_id, recipient_user_id, recipient_staff_id, recipient_role, actor_staff_id, actor_name, event, detail, entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      crypto.randomUUID(), business.id, recipientUserId, recipientStaffId, recipientRole,
      actorStaffId, actorName, event, detail, refId,
    ],
  );
}

/** The person's finished lesson ids, as a Set. */
export async function completedLessonIds(pool, businessId, personKey) {
  const { rows } = await pool.query(
    'SELECT lesson_id FROM training_progress WHERE business_id = $1 AND person_key = $2',
    [businessId, personKey],
  );
  return new Set(rows.map((row) => row.lesson_id));
}

/** The person's finished lessons with when each was finished. */
export async function completedLessons(pool, businessId, personKey) {
  const { rows } = await pool.query(
    'SELECT lesson_id, completed_at FROM training_progress WHERE business_id = $1 AND person_key = $2 ORDER BY completed_at ASC',
    [businessId, personKey],
  );
  return rows;
}

function parseLessonIds(raw) {
  return parseJsonArray(raw);
}

/** YYYY-MM-DD out of a DATE value, string or Date (same helper as workforce). */
function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** An assignment is complete when every lesson in it is finished. */
export function assignmentComplete(assignment, completedSet) {
  const ids = parseLessonIds(assignment.lesson_ids);
  return ids.length > 0 && ids.every((id) => completedSet.has(id));
}

export function publicAssignment(assignment, completedSet) {
  const complete = assignmentComplete(assignment, completedSet);
  return {
    id: assignment.id,
    assignee_key: assignment.assignee_key,
    assignee_staff_id: assignment.assignee_staff_id,
    assignee_name: assignment.assignee_name,
    assignee_level: assignment.assignee_level,
    module: assignment.module,
    lesson_ids: parseLessonIds(assignment.lesson_ids),
    source: assignment.source,
    assigned_by_name: assignment.assigned_by_name,
    due_date: dateOnly(assignment.due_date),
    status: complete ? 'completed' : 'assigned',
    completed_at: complete ? assignment.completed_at : null,
    warning_sent_at: assignment.warning_sent_at,
    created_at: assignment.created_at,
  };
}

/** Persist the completion cache when an assignment just became complete. */
async function refreshAssignmentStatus(pool, assignment, completedSet) {
  if (assignment.status !== 'completed' && assignmentComplete(assignment, completedSet)) {
    await pool.query(
      "UPDATE training_assignments SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1",
      [assignment.id],
    );
    assignment.status = 'completed';
    assignment.completed_at = new Date().toISOString();
  }
  return assignment;
}

export async function assignmentsForPerson(pool, businessId, personKey) {
  const { rows } = await pool.query(
    'SELECT * FROM training_assignments WHERE business_id = $1 AND assignee_key = $2 ORDER BY created_at DESC',
    [businessId, personKey],
  );
  const completedSet = await completedLessonIds(pool, businessId, personKey);
  const out = [];
  for (const row of rows) out.push(publicAssignment(await refreshAssignmentStatus(pool, row, completedSet), completedSet));
  return out;
}

/**
 * Create an assignment, or extend the still-open assignment for the
 * same person + module + source with any lessons it does not yet
 * carry (a second role grant in the same module tops the first one
 * up instead of stacking duplicates).
 */
export async function createOrExtendAssignment(pool, business, {
  assigneeRow = null,
  assigneeKey,
  assigneeUserId = null,
  assigneeName = '',
  assigneeLevel = 'staff',
  module,
  lessonIds,
  source = 'manual',
  assignedBy = { userId: null, staffId: null, name: '' },
  dueDate = null,
  bellDetail = null,
}) {
  const { rows: existing } = await pool.query(
    `SELECT * FROM training_assignments
      WHERE business_id = $1 AND assignee_key = $2 AND module = $3 AND source = $4 AND status = 'assigned'
      ORDER BY created_at DESC`,
    [business.id, assigneeKey, module, source],
  );
  const completedSet = await completedLessonIds(pool, business.id, assigneeKey);
  for (const candidate of existing) {
    if (assignmentComplete(candidate, completedSet)) {
      await refreshAssignmentStatus(pool, candidate, completedSet);
      continue;
    }
    const current = parseLessonIds(candidate.lesson_ids);
    const merged = [...new Set([...current, ...lessonIds])];
    const extended = merged.length !== current.length;
    if (extended) {
      await pool.query(
        'UPDATE training_assignments SET lesson_ids = $2, updated_at = NOW() WHERE id = $1',
        [candidate.id, JSON.stringify(merged)],
      );
      candidate.lesson_ids = JSON.stringify(merged);
      if (bellDetail) await ringAssignmentBell(pool, business, candidate, assigneeRow, assignedBy, bellDetail);
    }
    return { assignment: candidate, created: false, extended };
  }
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO training_assignments
       (id, business_id, assignee_key, assignee_staff_id, assignee_user_id, assignee_name, assignee_level,
        module, lesson_ids, source, assigned_by_user_id, assigned_by_staff_id, assigned_by_name, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      id, business.id, assigneeKey, assigneeRow?.id ?? null, assigneeUserId, assigneeName, assigneeLevel,
      module, JSON.stringify(lessonIds), source,
      assignedBy.userId, assignedBy.staffId, assignedBy.name, dueDate,
    ],
  );
  const assignment = rows[0];
  if (bellDetail) {
    await ringAssignmentBell(pool, business, assignment, assigneeRow, assignedBy, bellDetail);
  }
  return { assignment, created: true, extended: false };
}

async function ringAssignmentBell(pool, business, assignment, assigneeRow, assignedBy, detail) {
  await ringBell(pool, business, {
    recipientUserId: assignment.assignee_user_id,
    recipientStaffId: assigneeRow?.id ?? assignment.assignee_staff_id,
    recipientRole: assignment.assignee_level,
    actorStaffId: assignedBy.staffId,
    actorName: assignedBy.name,
    event: 'training_assigned',
    detail,
    refId: assignment.id,
  });
}

// ---- Effective permissions (mirrors resolveAccess) ---------------------

export async function customRolesFor(pool, businessId) {
  const { rows } = await pool.query('SELECT * FROM staff_roles WHERE business_id = $1', [businessId]);
  return rows;
}

export function permissionsOfRole(roleId, customRoles, planKey) {
  const preset = presetRoleById(roleId);
  if (preset) return permissionsForPlan(planKey, preset.permissions);
  const custom = (customRoles || []).find((role) => role.id === roleId);
  if (custom) return permissionsForPlan(planKey, parseJsonArray(custom.permissions));
  return [];
}

/** The permission set a staff row actually lives under. */
export function effectivePermissions(row, customRoles, planKey) {
  const stored = parseJsonArray(row?.permissions);
  if (stored.length) return permissionsForPlan(planKey, stored);
  return permissionsOfRole(row?.role_id, customRoles, planKey);
}

// ---- The role-grant hooks ------------------------------------------------

/**
 * After a StaffMember row is written: if the person's effective
 * permissions GREW, assign the new modules' lessons and ring them.
 * `before` / `after` are public-shaped rows (permissions already
 * parsed) or raw rows — parseJsonArray handles both.
 */
const LEVEL_RANK = { staff: 0, manager: 1, owner: 2 };

export async function trainingFlagForMemberChange(pool, { business, planKey, before, after, actor }) {
  try {
    if (!before || !after) return;
    if (!['active', 'invited'].includes(after.status || 'active')) return;
    // A promotion that lifts the person's LEVEL hands them the new
    // role whole: seed the full own-track set at the new level (it
    // covers every module a permission top-up would reach, plus
    // the modules no permission maps to). Same-level growth keeps
    // the narrower difference-only door below.
    if ((LEVEL_RANK[personLevel(after)] ?? 0) > (LEVEL_RANK[personLevel(before)] ?? 0)) {
      await seedRoleTrainingForMember(pool, business, after, { actor, planKey });
      return;
    }
    const customRoles = await customRolesFor(pool, business.id);
    const beforePerms = new Set(effectivePermissions(before, customRoles, planKey));
    const afterPerms = effectivePermissions(after, customRoles, planKey);
    const added = afterPerms.filter((perm) => !beforePerms.has(perm));
    if (!added.length) return;
    await assignForAddedPermissions(pool, business, after, added, actor, planKey);
  } catch (error) {
    console.error('[twin] training flag (member change) failed:', error);
  }
}

/**
 * After a StaffRole is written: role-only members (no stored
 * permission list of their own) live under the role's list, so a
 * role expansion expands them too.
 */
export async function trainingFlagForRoleChange(pool, { business, planKey, before, after, actor }) {
  try {
    if (!before || !after || before.id !== after.id) return;
    const beforePerms = new Set(permissionsForPlan(planKey, parseJsonArray(before.permissions)));
    const added = permissionsForPlan(planKey, parseJsonArray(after.permissions)).filter(
      (perm) => !beforePerms.has(perm),
    );
    if (!added.length) return;
    const { rows: members } = await pool.query(
      "SELECT * FROM staff_members WHERE business_id = $1 AND role_id = $2 AND status IN ('active', 'invited')",
      [business.id, after.id],
    );
    for (const member of members) {
      // Members with their own stored list do not live under the role.
      if (parseJsonArray(member.permissions).length) continue;
      await assignForAddedPermissions(pool, business, member, added, actor, planKey);
    }
  } catch (error) {
    console.error('[twin] training flag (role change) failed:', error);
  }
}

async function assignForAddedPermissions(pool, business, memberRow, addedPerms, actor, planKey) {
  const level = personLevel(memberRow);
  const modules = [...new Set(addedPerms.flatMap((perm) => MODULE_BY_PERMISSION[perm] || []))];
  if (!modules.length) return;
  const isBusiness = planKey === 'business';
  // Scoping (Nov 20, 2026): a growth assigns the module's lessons
  // only where the person's doors AFTER the change actually open
  // them — a tick brings its training, and nothing else rides
  // along. Core lessons of the module ride too (they are the
  // person's already; merging is idempotent).
  const customRoles = await customRolesFor(pool, business.id);
  const permissions = effectivePermissions(memberRow, customRoles, planKey);
  const user = await userForStaffRow(pool, memberRow);
  const assignedBy = {
    userId: actor?.userId ?? null,
    staffId: actor?.staffId ?? null,
    name: actor?.name || '',
  };
  for (const module of modules) {
    const lessons = lessonsForModuleAtLevel(module, level)
      .filter((lesson) => lessonVisibleOnPlan(lesson, isBusiness))
      .filter((lesson) => lessonInScope(lesson, { level, permissions }));
    if (!lessons.length) continue;
    await createOrExtendAssignment(pool, business, {
      assigneeRow: memberRow,
      assigneeKey: memberRow.id,
      assigneeUserId: user?.id ?? null,
      assigneeName: memberRow.full_name || '',
      assigneeLevel: level,
      module,
      lessonIds: lessons.map((lesson) => lesson.id),
      source: 'role_grant',
      assignedBy,
      bellDetail: `New training for you: ${MODULE_LABELS[module] || module} — added because your role grew.`,
    });
  }
}

// ---- Completion, the assigned union, and the ONE all-done bell -----------

/** Every lesson id ever assigned to this person (any source),
 *  plan-visible only — history on a hidden plan lesson stays
 *  stored and simply never enters the count. */
export async function assignedLessonUnion(pool, businessId, personKey, isBusiness) {
  const { rows } = await pool.query(
    'SELECT lesson_ids FROM training_assignments WHERE business_id = $1 AND assignee_key = $2',
    [businessId, personKey],
  );
  const out = new Set();
  for (const row of rows) {
    for (const id of parseLessonIds(row.lesson_ids)) {
      const lesson = TRAINING_LESSONS.find((l) => l.id === id);
      if (lesson && lessonVisibleOnPlan(lesson, isBusiness)) out.add(id);
    }
  }
  return out;
}

/** The person's full training obligation: everything assigned to
 *  them plus everything their doors scope to them. */
export async function trainingObligation(pool, business, memberRow, planKey) {
  const isBusiness = planKey === 'business';
  const assigned = await assignedLessonUnion(pool, business.id, memberRow.id, isBusiness);
  const customRoles = await customRolesFor(pool, business.id);
  const permissions = effectivePermissions(memberRow, customRoles, planKey);
  const level = personLevel(memberRow);
  const scoped = scopedLessonIds({ level, permissions, isBusiness });
  return new Set([...assigned, ...scoped]);
}

/**
 * Is this person's training genuinely finished? Used by the
 * Workforce "First training" task's Done gate and by the
 * all-done bell. An owner-ticked policy/terms quiz training with
 * questions written counts too: it is finished when the person's
 * latest attempt stands passed (an attempt awaiting the owner's
 * review of a typed answer stands passed — the training closed;
 * only a send-back reopens it).
 */
export async function trainingCompleteForPerson(pool, business, memberRow, planKey) {
  const obligation = await trainingObligation(pool, business, memberRow, planKey);
  const completed = await completedLessonIds(pool, business.id, memberRow.id);
  for (const id of obligation) {
    if (!completed.has(id)) return false;
  }
  const permissions = parseJsonArray(memberRow.permissions);
  const ticks = [
    ['training.policiesQuiz', 'policies'],
    ['training.termsQuiz', 'terms'],
  ];
  for (const [tick, docKind] of ticks) {
    if (!permissions.includes(tick)) continue;
    const { rows: questions } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM policy_questions WHERE business_id = $1 AND doc_kind = $2',
      [business.id, docKind],
    );
    if (!questions[0]?.n) continue; // no questions written = the reading is the training
    const { rows: attempts } = await pool.query(
      `SELECT status FROM policy_quiz_attempts
        WHERE business_id = $1 AND person_key = $2 AND doc_kind = $3
        ORDER BY created_at DESC LIMIT 1`,
      [business.id, memberRow.id, docKind],
    );
    if (!attempts[0] || attempts[0].status !== 'passed') return false;
  }
  return true;
}

/**
 * The ONE notification (owner ruling, Nov 20, 2026): when a
 * member finishes ALL of their training, the owner's bell rings
 * exactly once — never per lesson. Exactly-once is an existence
 * check on the bell row itself (event 'training_all_done',
 * entry_id = the person's key), so re-fires, retries and later
 * top-up assignments never ring it twice. Never throws.
 */
export async function maybeRingAllTrainingDone(pool, business, memberRow, planKey) {
  try {
    if (!memberRow || !business?.owner_id) return false;
    const { rows: existing } = await pool.query(
      `SELECT id FROM workforce_notifications
        WHERE business_id = $1 AND event = 'training_all_done' AND entry_id = $2 LIMIT 1`,
      [business.id, memberRow.id],
    );
    if (existing.length) return false;
    const obligation = await trainingObligation(pool, business, memberRow, planKey);
    if (!obligation.size) return false;
    if (!(await trainingCompleteForPerson(pool, business, memberRow, planKey))) return false;
    await ringBell(pool, business, {
      recipientUserId: business.owner_id,
      recipientStaffId: null,
      recipientRole: 'owner',
      actorStaffId: memberRow.id,
      actorName: memberRow.full_name || '',
      event: 'training_all_done',
      detail: `${memberRow.full_name || 'A team member'} has finished all of their training.`,
      refId: memberRow.id,
    });
    return true;
  } catch (error) {
    console.error('[twin] training all-done bell failed:', error);
    return false;
  }
}

/** Record a lesson completion (idempotent), then check the
 *  all-done bell for staff-row people. Returns true when a new
 *  progress row was written. */
export async function recordLessonCompletion(pool, business, {
  personKey, personUserId = null, personName = '', lessonId, memberRow = null, planKey = 'essentials',
}) {
  const existing = await pool.query(
    'SELECT id FROM training_progress WHERE business_id = $1 AND person_key = $2 AND lesson_id = $3 LIMIT 1',
    [business.id, personKey, lessonId],
  );
  let created = false;
  if (!existing.rows[0]) {
    await pool.query(
      `INSERT INTO training_progress (id, business_id, person_key, person_user_id, person_name, lesson_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [crypto.randomUUID(), business.id, personKey, personUserId, personName, lessonId],
    );
    created = true;
  }
  if (memberRow) await maybeRingAllTrainingDone(pool, business, memberRow, planKey);
  return created;
}

// ---- The join seed --------------------------------------------------------

/**
 * Set a member's own-role training in place: one assignment per
 * module, holding the lessons at the member's level that their
 * REAL doors open (owner ruling, Nov 20, 2026 — "nobody trains
 * on what they don't have"): the core lessons everyone carries,
 * plus every lesson whose permission door the person's role or
 * the owner's ticks actually give them, plan-filtered. Nothing
 * above their level, nothing from the other plan, nothing behind
 * a door they do not hold. Fired when a StaffMember row is
 * created, again when an invited row is accepted at sign-in, and
 * when a promotion lifts the member's level. Idempotent by
 * construction: assignments merge through
 * createOrExtendAssignment under the shared 'role_grant' source,
 * so a re-fire adds no rows, stacks no duplicates, and never
 * resurrects a module the member already finished. Like the
 * hooks above, it NEVER throws into its caller.
 */
export async function seedRoleTrainingForMember(pool, business, memberRow, { actor = null, planKey } = {}) {
  const summary = { created: 0, extended: 0 };
  try {
    if (!memberRow) return summary;
    if (!['active', 'invited'].includes(memberRow.status || 'active')) return summary;
    const level = personLevel(memberRow);
    const isBusiness = planKey === 'business';
    const customRoles = await customRolesFor(pool, business.id);
    const permissions = effectivePermissions(memberRow, customRoles, planKey);
    const user = await userForStaffRow(pool, memberRow);
    const assignedBy = {
      userId: actor?.userId ?? null,
      staffId: actor?.staffId ?? null,
      name: actor?.name || '',
    };
    for (const module of TRAINING_MODULES) {
      const lessons = lessonsForModuleAtLevel(module, level)
        .filter((lesson) => lessonVisibleOnPlan(lesson, isBusiness))
        .filter((lesson) => lessonInScope(lesson, { level, permissions }));
      if (!lessons.length) continue;
      const result = await createOrExtendAssignment(pool, business, {
        assigneeRow: memberRow,
        assigneeKey: memberRow.id,
        assigneeUserId: user?.id ?? null,
        assigneeName: memberRow.full_name || '',
        assigneeLevel: level,
        module,
        lessonIds: lessons.map((lesson) => lesson.id),
        source: 'role_grant',
        assignedBy,
        bellDetail: `New training for you: ${MODULE_LABELS[module] || module} — part of your role's training, ready when you are.`,
      });
      if (result.created) summary.created += 1;
      if (result.extended) summary.extended += 1;
    }
  } catch (error) {
    console.error('[twin] training seed (join) failed:', error);
  }
  return summary;
}
