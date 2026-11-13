/**
 * Training phase — role-scoped tracks, lesson completion, manual
 * assignments with optional deadlines, the overdue-warning rules,
 * team progress, and the role-grant training flag (the owner's
 * rule: when a person's role or permissions GROW, lessons for the
 * new parts of the app are assigned and their bell rings — and
 * nothing is assigned when nothing grew).
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
  setPlan,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

const TR = (bid) => `/api/businesses/${bid}/training`;
const WF = (bid) => `/api/businesses/${bid}/workforce`;

const SALES_PERMS = [
  'products.view', 'scan.use', 'orders.manage', 'returns.manage',
  'listings.manage', 'reports.view', 'print.use',
];

// ---- Fixtures -------------------------------------------------------------

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

async function inbox(cookie, bid) {
  const res = await req(`${WF(bid)}/notifications`, { cookie });
  assert.equal(res.status, 200);
  return res.json.notifications;
}
function hasEvent(notifications, event, pattern) {
  return notifications.some((n) => n.event === event && (!pattern || pattern.test(n.detail)));
}

function datePlus(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function completeAll(cookie, bid, lessonIds) {
  for (const id of lessonIds) {
    const res = await req(`${TR(bid)}/lessons/${id}/complete`, { method: 'POST', body: {}, cookie });
    assert.equal(res.status, 200, `complete ${id}`);
  }
}

// ---- Catalog agreement (client vs server vs locale) ------------------------

test('catalogs agree: client, server and the English locale carry the same lessons', async () => {
  const client = await import('../../src/lib/trainingCatalog.js');
  const server = await import('../../server/trainingCatalog.js');
  const { en } = await import('../../src/lib/locales/en.js');
  const shape = (lessons) => lessons.map(({ id, track, module, steps }) => ({ id, track, module, steps }));
  assert.deepEqual(shape(client.TRAINING_LESSONS), shape(server.TRAINING_LESSONS));
  assert.deepEqual(client.TRAINING_MODULES, server.TRAINING_MODULES);
  const counts = { staff: 0, manager: 0, owner: 0 };
  for (const lesson of server.TRAINING_LESSONS) {
    counts[lesson.track] += 1;
    assert.equal(typeof en[`training.lessons.${lesson.id}.title`], 'string', `${lesson.id} title`);
    for (let i = 1; i <= lesson.steps; i += 1) {
      assert.equal(typeof en[`training.lessons.${lesson.id}.step${i}`], 'string', `${lesson.id} step ${i}`);
    }
    assert.equal(typeof en[`training.module.${lesson.module}`], 'string', `${lesson.module} label`);
  }
  assert.ok(counts.staff > 0 && counts.manager > 0 && counts.owner > 0, 'all three tracks have lessons');
  // Every mapped permission teaches a module that actually has lessons.
  for (const [perm, modules] of Object.entries(server.MODULE_BY_PERMISSION)) {
    for (const mod of modules) {
      assert.ok(
        server.TRAINING_LESSONS.some((l) => l.module === mod),
        `${perm} -> ${mod} has lessons`,
      );
    }
  }
});

// ---- Track visibility + completion ----------------------------------------

test('tracks are role-scoped: staff see staff only, managers add theirs, the owner sees all three', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('train-vis@example.com');
  const manager = await addTeamMember(business, owner.id, 'train-vis-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'train-vis-staff@example.com');

  assert.deepEqual((await state(staff.cookie, business.id)).tracks, ['staff']);
  assert.deepEqual((await state(manager.cookie, business.id)).tracks, ['manager', 'staff']);
  assert.deepEqual((await state(ownerCookie, business.id)).tracks, ['owner', 'manager', 'staff']);
});

test('completion: a person completes lessons in their own tracks and is refused outside them', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('train-done@example.com');
  const manager = await addTeamMember(business, owner.id, 'train-done-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'train-done-staff@example.com');

  const ok = await req(`${TR(business.id)}/lessons/clock-basics/complete`, { method: 'POST', body: {}, cookie: staff.cookie });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.completed_lesson_ids.includes('clock-basics'));
  // Idempotent: completing twice keeps one record.
  const again = await req(`${TR(business.id)}/lessons/clock-basics/complete`, { method: 'POST', body: {}, cookie: staff.cookie });
  assert.equal(again.status, 200);
  assert.equal(again.json.completed_lesson_ids.filter((id) => id === 'clock-basics').length, 1);
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM training_progress WHERE business_id = $1 AND lesson_id = 'clock-basics'",
    [business.id],
  );
  assert.equal(rows[0].n, 1);

  // Staff cannot complete manager or owner lessons; the owner can complete owner lessons.
  assert.equal((await req(`${TR(business.id)}/lessons/mgr-schedules/complete`, { method: 'POST', body: {}, cookie: staff.cookie })).status, 403);
  assert.equal((await req(`${TR(business.id)}/lessons/owner-setup/complete`, { method: 'POST', body: {}, cookie: staff.cookie })).status, 403);
  assert.equal((await req(`${TR(business.id)}/lessons/no-such-lesson/complete`, { method: 'POST', body: {}, cookie: staff.cookie })).status, 404);
  assert.equal((await req(`${TR(business.id)}/lessons/mgr-schedules/complete`, { method: 'POST', body: {}, cookie: manager.cookie })).status, 200);
  assert.equal((await req(`${TR(business.id)}/lessons/owner-setup/complete`, { method: 'POST', body: {}, cookie: ownerCookie })).status, 200);
  // ...and the state carries the completion stamp.
  const mine = await state(staff.cookie, business.id);
  assert.ok(mine.completions.some((c) => c.lesson_id === 'clock-basics' && c.completed_at));
});

// ---- Manual assignments + hierarchy ----------------------------------------

test('assignments: owner trains anyone, a manager trains staff only, staff train nobody', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('train-assign@example.com');
  const manager = await addTeamMember(business, owner.id, 'train-assign-mgr@example.com', { manager: true });
  const manager2 = await addTeamMember(business, owner.id, 'train-assign-mgr2@example.com', { manager: true, name: 'Marta Manager' });
  const staff = await addTeamMember(business, owner.id, 'train-assign-staff@example.com');

  const byOwner = await req(`${TR(business.id)}/assignments`, {
    method: 'POST',
    body: { staff_member_id: manager.staffId, module: 'payroll' },
    cookie: ownerCookie,
  });
  assert.equal(byOwner.status, 201);
  assert.equal(byOwner.json.assignment.source, 'manual');
  assert.equal(byOwner.json.assignment.due_date, null, 'no deadline when none is given');
  assert.ok(byOwner.json.assignment.lesson_ids.length > 0);
  // The manager was belled.
  assert.ok(hasEvent(await inbox(manager.cookie, business.id), 'training_assigned', /Payroll/));

  const mgrToStaff = await req(`${TR(business.id)}/assignments`, {
    method: 'POST',
    body: { staff_member_id: staff.staffId, module: 'scanner' },
    cookie: manager.cookie,
  });
  assert.equal(mgrToStaff.status, 201);

  const mgrToMgr = await req(`${TR(business.id)}/assignments`, {
    method: 'POST',
    body: { staff_member_id: manager2.staffId, module: 'scanner' },
    cookie: manager.cookie,
  });
  assert.equal(mgrToMgr.status, 403, "a manager cannot assign the manager's training — that is the owner's");

  const byStaff = await req(`${TR(business.id)}/assignments`, {
    method: 'POST',
    body: { staff_member_id: staff.staffId, module: 'scanner' },
    cookie: staff.cookie,
  });
  assert.equal(byStaff.status, 403);

  // The assignment lands on the person's own Training state.
  const staffState = await state(staff.cookie, business.id);
  assert.ok(staffState.assignments.some((a) => a.module === 'scanner' && a.status === 'assigned'));
});

test('deadlines: due_in_days lands on the business-local date, PATCH can move and clear it', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('train-due@example.com');
  const staff = await addTeamMember(business, owner.id, 'train-due-staff@example.com');

  const created = await req(`${TR(business.id)}/assignments`, {
    method: 'POST',
    body: { staff_member_id: staff.staffId, module: 'orders', due_in_days: 7 },
    cookie: ownerCookie,
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.assignment.due_date, datePlus(7));
  const id = created.json.assignment.id;

  const moved = await req(`${TR(business.id)}/assignments/${id}`, {
    method: 'PATCH',
    body: { due_in_days: 30 },
    cookie: ownerCookie,
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.assignment.due_date, datePlus(30));

  const cleared = await req(`${TR(business.id)}/assignments/${id}`, {
    method: 'PATCH',
    body: { due_date: null },
    cookie: ownerCookie,
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.assignment.due_date, null);
});

// ---- Warnings ---------------------------------------------------------------

test('warnings: only when a deadline passed unfinished, and only from the right person', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('train-warn@example.com');
  const manager = await addTeamMember(business, owner.id, 'train-warn-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'train-warn-staff@example.com');

  const mkAssignment = async (staffId, body) => {
    const res = await req(`${TR(business.id)}/assignments`, {
      method: 'POST',
      body: { staff_member_id: staffId, ...body },
      cookie: ownerCookie,
    });
    assert.equal(res.status, 201);
    return res.json.assignment;
  };

  // No deadline -> cannot warn.
  const noDeadline = await mkAssignment(staff.staffId, { module: 'orders' });
  const warnNoDeadline = await req(`${TR(business.id)}/assignments/${noDeadline.id}/warn`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(warnNoDeadline.status, 400);
  assert.equal(warnNoDeadline.json.error, 'no_deadline');

  // Future deadline -> not overdue yet.
  const future = await mkAssignment(staff.staffId, { module: 'returns', due_in_days: 5 });
  const warnFuture = await req(`${TR(business.id)}/assignments/${future.id}/warn`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(warnFuture.status, 400);
  assert.equal(warnFuture.json.error, 'not_overdue');

  // Overdue staff assignment: staff cannot warn; the manager can; the bell lands.
  const overdue = await mkAssignment(staff.staffId, { module: 'listings', due_date: datePlus(-1) });
  assert.equal(
    (await req(`${TR(business.id)}/assignments/${overdue.id}/warn`, { method: 'POST', body: {}, cookie: staff.cookie })).status,
    403,
  );
  const warned = await req(`${TR(business.id)}/assignments/${overdue.id}/warn`, { method: 'POST', body: {}, cookie: manager.cookie });
  assert.equal(warned.status, 200);
  assert.ok(warned.json.assignment.warning_sent_at);
  assert.ok(hasEvent(await inbox(staff.cookie, business.id), 'training_warning', /Listings/));

  // Overdue MANAGER assignment: the manager cannot warn on it — the owner can.
  const mgrOverdue = await mkAssignment(manager.staffId, { module: 'payroll', due_date: datePlus(-2) });
  assert.equal(
    (await req(`${TR(business.id)}/assignments/${mgrOverdue.id}/warn`, { method: 'POST', body: {}, cookie: manager.cookie })).status,
    403,
  );
  const ownerWarned = await req(`${TR(business.id)}/assignments/${mgrOverdue.id}/warn`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(ownerWarned.status, 200);
  assert.ok(hasEvent(await inbox(manager.cookie, business.id), 'training_warning', /Payroll/));

  // Finished training cannot be warned about: complete every scanner
  // lesson for the staff member, then try to warn on their (now
  // complete) overdue scanner assignment.
  const scannerOverdue = await mkAssignment(staff.staffId, { module: 'scanner', due_date: datePlus(-1) });
  await completeAll(staff.cookie, business.id, scannerOverdue.lesson_ids);
  const staffState = await state(staff.cookie, business.id);
  const finished = staffState.assignments.find((a) => a.id === scannerOverdue.id);
  assert.equal(finished.status, 'completed');
  const warnDone = await req(`${TR(business.id)}/assignments/${scannerOverdue.id}/warn`, { method: 'POST', body: {}, cookie: ownerCookie });
  assert.equal(warnDone.status, 400);
  assert.equal(warnDone.json.error, 'already_completed');
});

// ---- Team progress ------------------------------------------------------------

test('team progress: the owner sees everyone, a manager sees staff only, staff are refused', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('train-team@example.com');
  const manager = await addTeamMember(business, owner.id, 'train-team-mgr@example.com', { manager: true });
  const staff = await addTeamMember(business, owner.id, 'train-team-staff@example.com');

  await completeAll(staff.cookie, business.id, ['clock-basics', 'schedule-yours']);

  assert.equal((await req(`${TR(business.id)}/team`, { cookie: staff.cookie })).status, 403);

  const mgrTeam = await req(`${TR(business.id)}/team`, { cookie: manager.cookie });
  assert.equal(mgrTeam.status, 200);
  assert.deepEqual(mgrTeam.json.people.map((p) => p.staff_id), [staff.staffId], 'managers see staff only');

  const ownerTeam = await req(`${TR(business.id)}/team`, { cookie: ownerCookie });
  assert.equal(ownerTeam.status, 200);
  const ids = ownerTeam.json.people.map((p) => p.staff_id).sort();
  assert.deepEqual(ids, [manager.staffId, staff.staffId].sort(), 'the owner sees managers and staff');
  const staffRow = ownerTeam.json.people.find((p) => p.staff_id === staff.staffId);
  assert.equal(staffRow.lessons_done, 2, 'completions show up in team progress');
  assert.ok(staffRow.lessons_total > 2);
});

// ---- The role-grant training flag ---------------------------------------------

test('role grant flag: growing a member\u2019s permissions assigns the new modules and rings them — a no-change edit does not', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('train-flag@example.com');
  const staff = await addTeamMember(business, owner.id, 'train-flag-staff@example.com');

  // Baseline: the sales role holds no counts.run, and nothing is assigned.
  let staffState = await state(staff.cookie, business.id);
  assert.equal(staffState.assignments.length, 0);

  // A rename changes nothing about permissions -> no assignment.
  const renamed = await req(`/api/entities/StaffMember/${staff.staffId}`, {
    method: 'PATCH',
    body: { full_name: 'Sam Staff Jr.' },
    cookie: ownerCookie,
  });
  assert.equal(renamed.status, 200);
  staffState = await state(staff.cookie, business.id);
  assert.equal(staffState.assignments.length, 0, 'a no-change edit assigns nothing');

  // Grow: the sales permission set + counts.run.
  const grown = await req(`/api/entities/StaffMember/${staff.staffId}`, {
    method: 'PATCH',
    body: { permissions: [...SALES_PERMS, 'counts.run'] },
    cookie: ownerCookie,
  });
  assert.equal(grown.status, 200);
  staffState = await state(staff.cookie, business.id);
  const countsAssignment = staffState.assignments.find((a) => a.module === 'counts');
  assert.ok(countsAssignment, 'the counts lessons were assigned');
  assert.equal(countsAssignment.source, 'role_grant');
  assert.deepEqual(countsAssignment.lesson_ids, ['counts-run']);
  assert.equal(countsAssignment.due_date, null, 'role-grant assignments carry no deadline');
  assert.ok(hasEvent(await inbox(staff.cookie, business.id), 'training_assigned', /Stock counts/));

  // Re-sending the SAME permission set grows nothing -> no second assignment, no extension.
  const resent = await req(`/api/entities/StaffMember/${staff.staffId}`, {
    method: 'PATCH',
    body: { permissions: [...SALES_PERMS, 'counts.run'] },
    cookie: ownerCookie,
  });
  assert.equal(resent.status, 200);
  staffState = await state(staff.cookie, business.id);
  assert.equal(staffState.assignments.filter((a) => a.module === 'counts').length, 1);

  // Shrinking (dropping counts.run again) assigns nothing either.
  const shrunk = await req(`/api/entities/StaffMember/${staff.staffId}`, {
    method: 'PATCH',
    body: { permissions: [...SALES_PERMS] },
    cookie: ownerCookie,
  });
  assert.equal(shrunk.status, 200);
  staffState = await state(staff.cookie, business.id);
  assert.equal(staffState.assignments.length, 1, 'shrinks never assign training');
});

test('role grant flag: changing a member\u2019s ROLE to a bigger role assigns the difference', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('train-flagrole@example.com');
  // A viewer: products.view + reports.view + print.use only.
  const staff = await addTeamMember(business, owner.id, 'train-flagrole-staff@example.com', {
    name: 'Val Viewer',
    roleId: 'preset-viewer',
  });

  const promoted = await req(`/api/entities/StaffMember/${staff.staffId}`, {
    method: 'PATCH',
    body: { role_id: 'preset-sales', role_name: 'Sales clerk' },
    cookie: ownerCookie,
  });
  assert.equal(promoted.status, 200);
  const staffState = await state(staff.cookie, business.id);
  const modules = staffState.assignments.map((a) => a.module).sort();
  // Sales adds scan.use (scanner + movements), orders, returns, listings.
  assert.deepEqual(modules, ['listings', 'movements', 'orders', 'returns', 'scanner']);
  assert.ok(staffState.assignments.every((a) => a.source === 'role_grant'));
});

test('role grant flag: expanding a custom ROLE assigns its role-only members (Business plan)', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('train-flagcustom@example.com');
  await setPlan(business.id, 'business', owner.id);

  const roleRes = await req('/api/entities/StaffRole', {
    method: 'POST',
    body: { business_id: business.id, name: 'Counter help', permissions: ['products.view'] },
    cookie: ownerCookie,
  });
  assert.equal(roleRes.status, 201);
  const role = roleRes.json;

  const member = await addTeamMember(business, owner.id, 'train-flagcustom-staff@example.com', {
    name: 'Cory Counter',
    roleId: role.id,
  });
  // A second member on the same role but with their OWN stored list —
  // they do not live under the role, so the role's growth is not theirs.
  const ownList = await addTeamMember(business, owner.id, 'train-flagcustom-own@example.com', {
    name: 'Ola Ownlist',
    roleId: role.id,
    permissions: JSON.stringify(['products.view', 'counts.run']),
  });

  const expanded = await req(`/api/entities/StaffRole/${role.id}`, {
    method: 'PATCH',
    body: { permissions: ['products.view', 'counts.run'] },
    cookie: ownerCookie,
  });
  assert.equal(expanded.status, 200);

  const memberState = await state(member.cookie, business.id);
  assert.ok(
    memberState.assignments.some((a) => a.module === 'counts' && a.source === 'role_grant'),
    'the role-only member was flagged',
  );
  const ownState = await state(ownList.cookie, business.id);
  assert.equal(ownState.assignments.length, 0, 'a member with their own stored list is not flagged by role growth');
});
