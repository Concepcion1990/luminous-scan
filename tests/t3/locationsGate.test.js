/**
 * T3 — The add-a-location tick (owner ruling, Nov 19, 2026).
 *
 * Before this build, adding a location rode the locations.manage
 * role permission: a preset Manager or Stock clerk could create
 * one on their role alone. Her ruling: adding a location is the
 * OWNER'S job — and an enrollment tick (locations.create, the
 * release-314 grant pattern: stored in the member's permissions
 * array, carried by NO role, off by default, managers included)
 * is how the owner hands it to a chosen member.
 *
 * The split this pins: CREATE follows owner-or-tick on BOTH
 * server doors (the entity door and the client's
 * /businesses/:bid/locations route, which funnel through the
 * one guardCreate). EDITING a location stays locations.manage
 * work exactly as before — a locations.manage holder without
 * the tick can still edit, but can no longer add.
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
  seededLocation,
} from './helpers.js';
import { PRESET_ROLES } from '../../server/authz.js';

after(close);
beforeEach(() => resetRateLimits());

const GATE_MESSAGE =
  'Only the owner, or a team member the owner has allowed to add locations, can add a location.';

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
  return { ...account, memberId: row.id };
}

/** Give or take the locations.create tick on a member's stored
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
    ? [...new Set([...permissions, 'locations.create'])]
    : permissions.filter((key) => key !== 'locations.create');
  await pool.query('UPDATE staff_members SET permissions = $1 WHERE business_id = $2 AND id = $3', [
    JSON.stringify(next),
    businessId,
    memberId,
  ]);
}

let seq = 0;
/** Create a nested shelf under the seeded store — a location
 * create that never touches the plan's site cap. */
async function createShelf(cookie, businessId, parentId, viaRoute = false) {
  seq += 1;
  const values = {
    name: `Gate Shelf ${seq}`,
    kind: 'shelf',
    parent_id: parentId,
  };
  if (viaRoute) {
    return req(`/api/businesses/${businessId}/locations`, {
      method: 'POST',
      cookie,
      body: { location: values },
    });
  }
  return req('/api/entities/Location', {
    method: 'POST',
    cookie,
    body: { business_id: businessId, ...values },
  });
}

async function locationCount(businessId) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM locations WHERE business_id = $1', [
    businessId,
  ]);
  return rows[0].n;
}

test('an unticked preset Manager is REFUSED on both create doors — locations.manage no longer adds (the behavior change)', async () => {
  const owner = await ownerWithBusiness('locgate-manager-owner@example.com');
  const manager = await actor(owner, {
    email: 'locgate-manager@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  const seeded = await seededLocation(owner.cookie, owner.business.id);
  const before = await locationCount(owner.business.id);

  const entityDoor = await createShelf(manager.cookie, owner.business.id, seeded.id);
  assert.equal(entityDoor.status, 403, entityDoor.text);
  assert.equal(entityDoor.json.error, 'locations_create_not_granted');
  assert.equal(entityDoor.json.message, GATE_MESSAGE);

  const routeDoor = await createShelf(manager.cookie, owner.business.id, seeded.id, true);
  assert.equal(routeDoor.status, 403, routeDoor.text);
  assert.equal(routeDoor.json.error, 'locations_create_not_granted');

  assert.equal(await locationCount(owner.business.id), before, 'no location was created');
});

test('a ticked Manager creates on both doors', async () => {
  const owner = await ownerWithBusiness('locgate-ticked-manager-owner@example.com');
  const manager = await actor(owner, {
    email: 'locgate-ticked-manager@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  const seeded = await seededLocation(owner.cookie, owner.business.id);
  await setGrant(owner.business.id, manager.memberId, true);

  const entityDoor = await createShelf(manager.cookie, owner.business.id, seeded.id);
  assert.equal(entityDoor.status, 201, entityDoor.text);
  assert.equal(entityDoor.json.name.startsWith('Gate Shelf'), true);

  const routeDoor = await createShelf(manager.cookie, owner.business.id, seeded.id, true);
  assert.equal(routeDoor.status, 201, routeDoor.text);
  assert.equal(routeDoor.json.location.name.startsWith('Gate Shelf'), true);
});

test('a ticked staff member creates — the tick alone suffices, no locations.manage needed', async () => {
  const owner = await ownerWithBusiness('locgate-staff-owner@example.com');
  const sales = await actor(owner, {
    email: 'locgate-staff@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  const seeded = await seededLocation(owner.cookie, owner.business.id);

  const refused = await createShelf(sales.cookie, owner.business.id, seeded.id);
  assert.equal(refused.status, 403, refused.text);
  assert.equal(refused.json.error, 'locations_create_not_granted');

  await setGrant(owner.business.id, sales.memberId, true);
  const created = await createShelf(sales.cookie, owner.business.id, seeded.id);
  assert.equal(created.status, 201, created.text);
});

test('the owner creates with no tick anywhere', async () => {
  const owner = await ownerWithBusiness('locgate-owner@example.com');
  const seeded = await seededLocation(owner.cookie, owner.business.id);
  const created = await createShelf(owner.cookie, owner.business.id, seeded.id);
  assert.equal(created.status, 201, created.text);
});

test('tick removed → refused again', async () => {
  const owner = await ownerWithBusiness('locgate-revoked-owner@example.com');
  const manager = await actor(owner, {
    email: 'locgate-revoked@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  const seeded = await seededLocation(owner.cookie, owner.business.id);
  await setGrant(owner.business.id, manager.memberId, true);
  const ok = await createShelf(manager.cookie, owner.business.id, seeded.id);
  assert.equal(ok.status, 201, ok.text);

  await setGrant(owner.business.id, manager.memberId, false);
  const refused = await createShelf(manager.cookie, owner.business.id, seeded.id);
  assert.equal(refused.status, 403, refused.text);
  assert.equal(refused.json.error, 'locations_create_not_granted');
});

test('the split: a locations.manage holder WITHOUT the tick can still EDIT a location', async () => {
  const owner = await ownerWithBusiness('locgate-edit-owner@example.com');
  const manager = await actor(owner, {
    email: 'locgate-edit@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  const seeded = await seededLocation(owner.cookie, owner.business.id);

  const edited = await req(`/api/entities/Location/${seeded.id}`, {
    method: 'PATCH',
    cookie: manager.cookie,
    body: { name: 'Renamed By Manager' },
  });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.json.name, 'Renamed By Manager');
});

test('the gate holds on the Business plan too', async () => {
  const owner = await ownerWithBusiness('locgate-business-owner@example.com', 'Test Shop', { plan: 'business' });
  const manager = await actor(owner, {
    email: 'locgate-business@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  const seeded = await seededLocation(owner.cookie, owner.business.id);
  const refused = await createShelf(manager.cookie, owner.business.id, seeded.id);
  assert.equal(refused.status, 403, refused.text);
  await setGrant(owner.business.id, manager.memberId, true);
  const created = await createShelf(manager.cookie, owner.business.id, seeded.id);
  assert.equal(created.status, 201, created.text);
});

// ---- Source pins: the tick, the doors and the rider ----

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the tick lives in the member dialog as its own grant state, beside the other grant families', () => {
  const dialog = read('../../src/components/staff/StaffMemberDialog.jsx');
  assert.match(dialog, /LOCATIONS_GRANTS\.map/, 'the dialog renders the locations grants');
  assert.match(dialog, /locations_grants/, 'the dialog keeps the locations grants as their own form state');
  assert.match(dialog, /isLocationsGrant/, 'the dialog splits the locations grants out of the stored array');
  const staff = read('../../src/lib/staff.js');
  assert.match(staff, /key: 'locations\.create'/, 'the grant key is locations.create');
  assert.match(staff, /isMemberGrant[\s\S]*isLocationsGrant/, 'the picker can never wipe the locations grant');
});

test('the server gate sits in guardCreate with the facts-only refusal, and the client registers it', () => {
  const entities = read('../../server/entities.js');
  assert.match(entities, /locations_create_not_granted/, 'the create gate refuses with its own code');
  assert.match(entities, /LOCATIONS_CREATE_MESSAGE/, 'the gate carries the facts-only message');
  const apiErrors = read('../../src/lib/apiErrors.js');
  assert.match(apiErrors, /apiErrors\.locationsCreateReserved/, 'the refusal renders in the reader\u2019s language');
});

test('the doors follow the tick: Locations page, add-inside buttons and the inline form', () => {
  const page = read('../../src/pages/Locations.jsx');
  assert.match(page, /can\('locations\.create'\)/, 'the Locations page reads the grant for the signed-in person');
  assert.match(page, /canAddLocation \? openNew : null/, 'the add-inside handler is offered only to a person who may add');
  const card = read('../../src/components/locations/LocationTreeCard.jsx');
  assert.match(card, /onAddChild &&/, 'the card renders its add-inside button only when offered');
  const rows = read('../../src/components/locations/LocationChildRows.jsx');
  assert.match(rows, /onAddChild &&/, 'the child rows render their add-inside button only when offered');
  const inline = read('../../src/components/locations/AddLocationInline.jsx');
  assert.match(inline, /can\('locations\.create'\)/, 'the inline form renders only for the owner or a tick-holder');
});

test('the green-strips rider: both theme-color declarations are her cream, the green is gone', () => {
  const html = read('../../index.html');
  assert.match(html, /<meta name="theme-color" content="#E8DFD4" \/>/, 'the meta theme-color is her cream');
  assert.doesNotMatch(html, /0f3d31/i, 'the leftover green is gone from index.html');
  const manifest = JSON.parse(read('../../public/manifest.webmanifest'));
  assert.equal(manifest.theme_color, '#E8DFD4', 'the manifest theme_color is her cream');
  assert.equal(manifest.background_color, '#E8DFD4', 'the manifest background_color was already her cream and stays');
});
