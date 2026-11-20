/**
 * T3 — The staff roster tick (owner ruling, Nov 19, 2026,
 * answering the release-314 record §17 flag).
 *
 * Release 314 left every non-owner's StaffMember reads scoped
 * to their OWN row — a manager holding the hiring permission
 * opened the Staff page and saw only their own card. Her
 * ruling: whether a manager sees the whole roster is the
 * OWNER'S choice, made per manager. The tick (staff.roster,
 * the release-314 grant pattern: stored in the member's
 * permissions array, carried by NO role, off by default) is
 * how the owner hands it out.
 *
 * The split this pins: a ticked MANAGER reads the full roster
 * (list and single reads) — read-only. Everything else stays
 * exactly where it was: member edits still take staff.manage,
 * the personal address/phone strip still applies to a roster
 * holder without staff.manage, and pay never rides the member
 * row at all. The tick follows the release-314 manager-level
 * composition: stored on a staff member, it stays inert.
 * Unticked, a manager's view is exactly the §17 wall.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
} from './helpers.js';
import { PRESET_ROLES } from '../../server/authz.js';

after(close);
beforeEach(() => resetRateLimits());

/** Invite a member with a preset role, activate their account, and
 * give them a full-week schedule so the shift window lets their
 * session work (the window brackets sign-in once the active
 * business is set — owner ruling, Nov 19, 2026). */
async function actor(owner, { email, roleId, roleName }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST',
    cookie: owner['cookie'],
    body: {
      business_id: owner.business.id,
      full_name: roleName,
      email,
      role_id: roleId,
      role_name: roleName,
    },
  });
  assert.equal(invite.status, 201, invite.text);
  const account = await registerVerifiedUser(email);
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [
    owner.business.id,
    account.user.id,
  ]);
  const row = (
    await pool.query('SELECT id FROM staff_members WHERE business_id = $1 AND email = $2', [
      owner.business.id,
      email,
    ])
  ).rows[0];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')`,
      [crypto.randomUUID(), owner.business.id, row.id, weekday],
    );
  }
  return { ...account, memberId: row.id, email };
}

/** Give or take the staff.roster tick on a member's stored
 * permissions — the same array the enrollment dialog edits. A
 * member invited without an explicit array stores an EMPTY one
 * and the server falls back to their role; the dialog instead
 * always saves the full set, so materialize the role's
 * permissions first, exactly as a dialog save would leave them. */
async function setGrant(businessId, memberId, granted) {
  const row = (
    await pool.query('SELECT permissions, role_id FROM staff_members WHERE id = $1', [memberId])
  ).rows[0];
  let permissions = [];
  try {
    permissions = JSON.parse(row.permissions || '[]');
  } catch {
    permissions = [];
  }
  if (!permissions.length) {
    const preset = PRESET_ROLES.find((role) => role.id === row.role_id);
    permissions = preset ? [...preset.permissions] : [];
  }
  const next = granted
    ? [...new Set([...permissions, 'staff.roster'])]
    : permissions.filter((key) => key !== 'staff.roster');
  await pool.query('UPDATE staff_members SET permissions = $1 WHERE business_id = $2 AND id = $3', [
    JSON.stringify(next),
    businessId,
    memberId,
  ]);
}

async function roster(cookie, businessId) {
  const res = await req('/api/entities/StaffMember/query', {
    method: 'POST',
    cookie,
    body: { filter: { business_id: businessId } },
  });
  assert.equal(res.status, 200, res.text);
  return res.json.items;
}

/** An owner, a preset Manager and a preset Sales clerk. */
async function cast(suffix, plan = 'essentials') {
  const owner = await ownerWithBusiness(`roster-owner-${suffix}@example.com`, 'Roster Shop', { plan });
  const manager = await actor(owner, {
    email: `roster-manager-${suffix}@example.com`,
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  const clerk = await actor(owner, {
    email: `roster-clerk-${suffix}@example.com`,
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  return { owner, manager, clerk };
}

test('an unticked manager reads exactly their own row — the §17 wall stands', async () => {
  const { owner, manager, clerk } = await cast('wall');
  const rows = await roster(manager.cookie, owner.business.id);
  assert.equal(rows.length, 1, 'the unticked manager sees one row');
  assert.equal(rows[0].id, manager.memberId, 'and it is their own');
  const single = await req(`/api/entities/StaffMember/${clerk.memberId}`, { cookie: manager['cookie'] });
  assert.equal(single.status, 403, 'a single read of a teammate is refused');
  assert.match(single.text, /You can only read your own staff record/);
});

test('a ticked manager reads the full roster — list and single reads', async () => {
  const { owner, manager, clerk } = await cast('full');
  await setGrant(owner.business.id, manager.memberId, true);
  const rows = await roster(manager.cookie, owner.business.id);
  const ids = rows.map((row) => row.id).sort();
  assert.deepEqual(ids, [clerk.memberId, manager.memberId].sort(), 'the whole roster, both members');
  const single = await req(`/api/entities/StaffMember/${clerk.memberId}`, { cookie: manager['cookie'] });
  assert.equal(single.status, 200, single.text);
  assert.equal(single.json.id, clerk.memberId);
});

test('a ticked manager still cannot EDIT anyone — writes stay behind staff.manage', async () => {
  const { owner, manager, clerk } = await cast('writes');
  await setGrant(owner.business.id, manager.memberId, true);
  const patch = await req(`/api/entities/StaffMember/${clerk.memberId}`, {
    method: 'PATCH',
    cookie: manager['cookie'],
    body: { full_name: 'Renamed By Manager' },
  });
  assert.equal(patch.status, 403, patch.text);
  assert.match(patch.text, /You do not have permission to do that here/);
  const create = await req('/api/entities/StaffMember', {
    method: 'POST',
    cookie: manager['cookie'],
    body: {
      business_id: owner.business.id,
      full_name: 'Sneaky Hire',
      email: `roster-sneak@example.com`,
      role_id: 'preset-sales',
      role_name: 'Sales clerk',
    },
  });
  assert.equal(create.status, 403, 'enrolling stays behind staff.manage too');
});

test('the field gates hold for a ticked manager: personal address and phone stay stripped, pay never rides the row', async () => {
  const { owner, manager, clerk } = await cast('fields');
  await pool.query(
    'UPDATE staff_members SET personal_address = $1, personal_phone = $2 WHERE id = $3',
    ['1 Private Lane, Santa Fe, NM', '555-0100', clerk.memberId],
  );
  await setGrant(owner.business.id, manager.memberId, true);
  const managerRows = await roster(manager.cookie, owner.business.id);
  const clerksCard = managerRows.find((row) => row.id === clerk.memberId);
  assert.ok(clerksCard, 'the ticked manager sees the clerk\u2019s card');
  assert.ok(!('personal_address' in clerksCard), 'personal address is NOT exposed to the roster holder');
  assert.ok(!('personal_phone' in clerksCard), 'personal phone is NOT exposed to the roster holder');
  assert.ok(!('hourly_rate' in clerksCard) && !('annual_salary' in clerksCard), 'pay never rides the member row');
  const ownerRows = await roster(owner.cookie, owner.business.id);
  const ownersView = ownerRows.find((row) => row.id === clerk.memberId);
  assert.equal(ownersView.personal_address, '1 Private Lane, Santa Fe, NM', 'the owner still sees the contact fields');
  assert.equal(ownersView.personal_phone, '555-0100');
});

test('the tick is manager-level: stored on a sales clerk, it stays inert', async () => {
  const { owner, manager, clerk } = await cast('level');
  await setGrant(owner.business.id, clerk.memberId, true);
  const rows = await roster(clerk.cookie, owner.business.id);
  assert.equal(rows.length, 1, 'a staff member with the tick stored still sees only their own row');
  assert.equal(rows[0].id, clerk.memberId);
  const single = await req(`/api/entities/StaffMember/${manager.memberId}`, { cookie: clerk['cookie'] });
  assert.equal(single.status, 403, 'and cannot read a teammate');
});

test('untick → back to the own card only', async () => {
  const { owner, manager } = await cast('untick');
  await setGrant(owner.business.id, manager.memberId, true);
  assert.equal((await roster(manager.cookie, owner.business.id)).length, 2, 'ticked: the full roster');
  await setGrant(owner.business.id, manager.memberId, false);
  const rows = await roster(manager.cookie, owner.business.id);
  assert.equal(rows.length, 1, 'unticked: the wall is back');
  assert.equal(rows[0].id, manager.memberId);
});

test('the roster holds on the Business plan too', async () => {
  const { owner, manager } = await cast('business', 'business');
  assert.equal((await roster(manager.cookie, owner.business.id)).length, 1, 'unticked: own row only');
  await setGrant(owner.business.id, manager.memberId, true);
  assert.equal((await roster(manager.cookie, owner.business.id)).length, 2, 'ticked: the full roster');
});

// ---- Source pins: the tick, the server split and the doors ----

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the tick lives in the member dialog as its own grant state, beside the other grant families', () => {
  const dialog = read('../../src/components/staff/StaffMemberDialog.jsx');
  assert.match(dialog, /ROSTER_GRANTS\.map/, 'the dialog renders the roster grants');
  assert.match(dialog, /roster_grants/, 'the dialog keeps the roster grants as their own form state');
  assert.match(dialog, /isRosterGrant/, 'the dialog splits the roster grants out of the stored array');
  const staff = read('../../src/lib/staff.js');
  assert.match(staff, /key: 'staff\.roster'/, 'the grant key is staff.roster');
  assert.match(staff, /isMemberGrant[\s\S]*isRosterGrant/, 'the picker can never wipe the roster grant');
});

test('the server split sits in the entity reads, manager-level, and the contact strip is untouched', () => {
  const entities = read('../../server/entities.js');
  assert.match(entities, /function canSeeRoster\(access\)/, 'the roster helper exists');
  assert.match(entities, /access\.can\('staff\.roster'\)/, 'the helper reads the tick');
  assert.match(entities, /memberLevel\(access\.staffRow\) === 'manager'/, 'the helper enforces manager level');
  assert.match(entities, /!access\.isOwner && !canSeeRoster\(access\)/, 'both read paths scope through the helper');
  assert.match(entities, /function stripStaffContact\(row\)/, 'the contact strip still stands');
});

test('the Staff door follows the tick and the page renders read-only for a roster holder', () => {
  const nav = read('../../src/components/layout/navGroups.js');
  assert.match(nav, /anyPerm: \['staff\.roster'\]/, 'the Staff nav item carries the roster alternative');
  const layout = read('../../src/components/Layout.jsx');
  assert.match(layout, /\(item\.anyPerm \|\| \[\]\)\.some/, 'Layout honors anyPerm on the nav list');
  assert.match(layout, /doorOpens\(current\)/, 'and on the route gate');
  const page = read('../../src/pages/Staff.jsx');
  assert.match(page, /canManageStaff = isAdmin \|\| can\('staff\.manage'\)/, 'manage furniture follows boss-or-staff.manage');
  assert.match(page, /readOnly=\{!canManageStaff\}/, 'member cards render read-only for a roster holder');
  const card = read('../../src/components/staff/StaffMemberCard.jsx');
  assert.match(card, /!readOnly &&/, 'the card hides its action row when read-only');
  const roleCard = read('../../src/components/staff/StaffRoleCard.jsx');
  assert.match(roleCard, /!builtIn && onEdit && onDelete/, 'role cards render edit/delete only when handlers are offered');
});

test('the new strings are in English first', () => {
  const en = read('../../src/lib/locales/en.js');
  assert.match(en, /"staffLib\.perm\.staffRoster": "See the full staff roster"/, 'the tick label');
  assert.match(en, /"staffLib\.area\.staffAccess": "Staff roster"/, 'the block label');
  assert.match(en, /"staff\.memberDialog\.staffAccessHint": "Managers only/, 'the hint opens with the family wording');
  assert.match(
    en,
    /"training\.lessons\.mgr-staff-permissions\.step1": "If the owner has given you the staff roster, open Staff to see the team/,
    'the lesson step speaks in the conditional voice',
  );
});
