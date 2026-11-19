/**
 * Staff entry — the workspace front door (owner catch, Nov 15, 2026).
 *
 * The SPA's workspace list (GET /api/businesses), the set-active
 * door and the switch door all read business_memberships, but the
 * only production insert was business creation (the owner): an
 * invited staff member's row flipped Active at sign-in and their
 * training seeded, yet no membership ever materialized — they
 * signed in to an empty workspace list and landed on the public
 * plans page with no way in. ensureStaffMemberships (server/
 * staff.js) now keeps the invariant on every sign-in: a 'member'
 * membership exists for exactly the businesses where the person
 * holds an ACTIVE staff row — materialized at activation, healed
 * for rows that were already Active, and deleted when the staff
 * row is removed or no longer active. Removal also deletes the
 * membership in the delete transaction itself.
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
  login,
  cookieFrom,
  ownerWithBusiness,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function inviteMember(ownerCookie, business, { email, name = 'Sam Staff' }) {
  const res = await req('/api/entities/StaffMember', {
    method: 'POST',
    cookie: ownerCookie,
    body: {
      business_id: business.id,
      full_name: name,
      email,
      role_id: 'preset-sales',
      role_name: 'Sales clerk',
    },
  });
  assert.equal(res.status, 201, res.text);
  return res.json;
}

async function membershipsFor(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM business_memberships WHERE user_id = $1 ORDER BY created_at ASC',
    [userId],
  );
  return rows;
}

async function listAs(cookie) {
  const res = await req('/api/businesses', { cookie });
  assert.equal(res.status, 200, res.text);
  return res.json;
}

async function loginCookie(email, password = 'CorrectHorse123') {
  const res = await login(email, password);
  assert.equal(res.status, 200, res.text);
  return cookieFrom(res.setCookie);
}

test('an invited staff member lands inside the workspace at sign-in', async () => {
  const owner = await ownerWithBusiness('entry1-owner@example.com', 'Entry One', { plan: 'essentials' });
  await inviteMember(owner.cookie, owner.business, { email: 'entry1-staff@example.com' });

  const staff = await registerVerifiedUser('entry1-staff@example.com');

  const row = (await pool.query(
    'SELECT status FROM staff_members WHERE business_id = $1', [owner.business.id],
  )).rows[0];
  assert.equal(row.status, 'active', 'the invite flipped Active at sign-in');

  const mine = await membershipsFor(staff.user.id);
  assert.equal(mine.length, 1, 'exactly one membership materialized');
  assert.equal(mine[0].business_id, owner.business.id);
  assert.equal(mine[0].role, 'member');

  const list = await listAs(staff.cookie);
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, owner.business.id, 'the workspace is in their list');

  // The switch door accepts them too.
  const switched = await req(`/api/businesses/${owner.business.id}/switch`, {
    method: 'POST', cookie: staff.cookie, body: {},
  });
  assert.equal(switched.status, 200, switched.text);

  // The shift window (owner's ruling, Nov 19, 2026): once the
  // member's active business is this shop, sign-in is bracketed
  // by their posted schedule — no schedule, no window. The owner
  // posts a full-week schedule, and only then does the re-login
  // below exercise the membership invariant.
  const staffRow = (await pool.query(
    'SELECT id FROM staff_members WHERE business_id = $1', [owner.business.id],
  )).rows[0];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')`,
      [crypto.randomUUID(), owner.business.id, staffRow.id, weekday],
    );
  }

  // Idempotent: further sign-ins never stack a second membership.
  const again = await loginCookie('entry1-staff@example.com');
  const relisted = await listAs(again);
  assert.equal(relisted.total, 1);
  assert.equal((await membershipsFor(staff.user.id)).length, 1);
});

test('a staff row already Active before the fix heals at the next sign-in', async () => {
  const owner = await ownerWithBusiness('entry2-owner@example.com', 'Entry Two', { plan: 'essentials' });
  // The pre-fix state, written the way production rows were: the
  // person has an account and an Active staff row, but no membership.
  const person = await registerVerifiedUser('entry2-staff@example.com');
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'Pat Pre', 'entry2-staff@example.com', 'user', 'preset-sales', 'Sales clerk', '[]', 'active', $3)`,
    [crypto.randomUUID(), owner.business.id, owner.user.id],
  );
  assert.equal((await membershipsFor(person.user.id)).length, 0, 'pre-fix: no membership');
  assert.equal((await listAs(person.cookie)).total, 0, 'pre-fix: empty workspace list');

  const cookie = await loginCookie('entry2-staff@example.com');
  const list = await listAs(cookie);
  assert.equal(list.total, 1, 'the sign-in healed the missing membership');
  assert.equal(list.items[0].id, owner.business.id);
  const mine = await membershipsFor(person.user.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].role, 'member');
});

test('owner flows are unchanged by the staff membership sync', async () => {
  const owner = await ownerWithBusiness('entry3-owner@example.com', 'Entry Three', { plan: 'essentials' });
  await inviteMember(owner.cookie, owner.business, { email: 'entry3-staff@example.com' });
  await registerVerifiedUser('entry3-staff@example.com');

  const list = await listAs(owner.cookie);
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, owner.business.id);
  const mine = await membershipsFor(owner.user.id);
  assert.equal(mine.length, 1, 'the owner still holds exactly their owner membership');
  assert.equal(mine[0].role, 'owner');
});

test('a removed staff member does NOT regain entry', async () => {
  const owner = await ownerWithBusiness('entry4-owner@example.com', 'Entry Four', { plan: 'essentials' });
  const member = await inviteMember(owner.cookie, owner.business, { email: 'entry4-staff@example.com' });
  const staff = await registerVerifiedUser('entry4-staff@example.com');
  assert.equal((await listAs(staff.cookie)).total, 1, 'inside before removal');

  const removed = await req(`/api/entities/StaffMember/${member.id}`, {
    method: 'DELETE', cookie: owner.cookie,
  });
  assert.equal(removed.status, 200, removed.text);

  assert.equal(
    (await membershipsFor(staff.user.id)).length, 0,
    'the membership left with the staff row, in the same transaction',
  );
  assert.equal((await listAs(staff.cookie)).total, 0, 'the workspace leaves their list at once');

  // A fresh sign-in cannot resurrect it: no ACTIVE staff row exists.
  const cookie = await loginCookie('entry4-staff@example.com');
  assert.equal((await listAs(cookie)).total, 0, 'still outside after signing in again');
  assert.equal((await membershipsFor(staff.user.id)).length, 0);
});

test('a suspended staff member loses the workspace link at their next sign-in', async () => {
  const owner = await ownerWithBusiness('entry5-owner@example.com', 'Entry Five', { plan: 'essentials' });
  const member = await inviteMember(owner.cookie, owner.business, { email: 'entry5-staff@example.com' });
  const staff = await registerVerifiedUser('entry5-staff@example.com');
  assert.equal((await membershipsFor(staff.user.id)).length, 1);

  await req(`/api/entities/StaffMember/${member.id}`, {
    method: 'PATCH', cookie: owner.cookie, body: { status: 'suspended' },
  });
  const cookie = await loginCookie('entry5-staff@example.com');
  assert.equal((await listAs(cookie)).total, 0, 'suspension drops the workspace from their list');
  assert.equal((await membershipsFor(staff.user.id)).length, 0);
});
