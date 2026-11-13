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
 */
import crypto from 'node:crypto';
import { parseJsonArray, presetRoleById } from './authz.js';
import { permissionsForPlan } from './plans.js';
import {
  MODULE_BY_PERMISSION,
  MODULE_LABELS,
  lessonsForModuleAtLevel,
} from './trainingCatalog.js';
import { personLevel } from './workforceRoutes.js';

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
export async function trainingFlagForMemberChange(pool, { business, planKey, before, after, actor }) {
  try {
    if (!before || !after) return;
    if (!['active', 'invited'].includes(after.status || 'active')) return;
    const customRoles = await customRolesFor(pool, business.id);
    const beforePerms = new Set(effectivePermissions(before, customRoles, planKey));
    const afterPerms = effectivePermissions(after, customRoles, planKey);
    const added = afterPerms.filter((perm) => !beforePerms.has(perm));
    if (!added.length) return;
    await assignForAddedPermissions(pool, business, after, added, actor);
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
      await assignForAddedPermissions(pool, business, member, added, actor);
    }
  } catch (error) {
    console.error('[twin] training flag (role change) failed:', error);
  }
}

async function assignForAddedPermissions(pool, business, memberRow, addedPerms, actor) {
  const level = personLevel(memberRow);
  const modules = [...new Set(addedPerms.flatMap((perm) => MODULE_BY_PERMISSION[perm] || []))];
  if (!modules.length) return;
  const user = await userForStaffRow(pool, memberRow);
  const assignedBy = {
    userId: actor?.userId ?? null,
    staffId: actor?.staffId ?? null,
    name: actor?.name || '',
  };
  for (const module of modules) {
    const lessons = lessonsForModuleAtLevel(module, level);
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
