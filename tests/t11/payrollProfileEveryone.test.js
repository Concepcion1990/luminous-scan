/**
 * Release 337 (rider) — the Payroll "Your details on file" card
 * for EVERYONE, owner down to viewer (owner ruling, Nov 21, 2026).
 *
 * Release 336 fed the card from the caller's staff row, which
 * left two people out: the OWNER (no staff row — their card now
 * reads their own account record, migration 036, and is the one
 * card its owner may edit, through PUT /payroll/my-details) and
 * the VIEWER (a staff-level member whose own view must reach
 * their own card + stubs and nothing of anyone else's). The
 * privacy invariant is unchanged: every payload below carries
 * the caller's own details only.
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

after(close);
beforeEach(() => resetRateLimits());

const WF = (bid) => `/api/businesses/${bid}/workforce`;

async function addTeamMember(business, ownerId, email, { roleId = 'preset-sales', roleName = 'Sales clerk', name, address } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id, personal_address)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, '[]', 'active', $7, $8)`,
    [id, business.id, name || 'Sam Staff', email, roleId, roleName, ownerId, address || ''],
  );
  const account = await registerVerifiedUser(email);
  return { staffId: id, email, cookie: account.cookie, user: account.user };
}

test('owner card: fed from the owner account, editable only by the owner, persists', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('rider337-owner@example.com');

  const before = await req(`${WF(business.id)}/payroll/context`, { cookie: ownerCookie });
  assert.equal(before.json.me_profile.owner, true);
  assert.equal(before.json.me_profile.full_name, '');
  assert.equal(before.json.me_profile.personal_address, '');

  const saved = await req(`${WF(business.id)}/payroll/my-details`, {
    method: 'PUT',
    body: { full_name: 'Connie Owner', personal_address: '1 Plaza Way\nSanta Fe, NM 87501' },
    cookie: ownerCookie,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.me_profile.full_name, 'Connie Owner');
  assert.equal(saved.json.me_profile.personal_address, '1 Plaza Way\nSanta Fe, NM 87501');
  assert.equal(saved.json.me_profile.owner, true);

  const afterRead = await req(`${WF(business.id)}/payroll/context`, { cookie: ownerCookie });
  assert.equal(afterRead.json.me_profile.full_name, 'Connie Owner');
  assert.equal(afterRead.json.me_profile.personal_address, '1 Plaza Way\nSanta Fe, NM 87501');

  // The name written here is the account's owner name (release
  // 335's display_name) — one value, every surface.
  const row = await pool.query('SELECT display_name, personal_address FROM users WHERE id = $1', [owner.id]);
  assert.equal(row.rows[0].display_name, 'Connie Owner');
  assert.equal(row.rows[0].personal_address, '1 Plaza Way\nSanta Fe, NM 87501');
});

test('owner card edit: members and managers are refused; oversize values are refused', async () => {
  const { cookie: ownerCookie, business, user: owner } = await ownerWithBusiness('rider337-gate@example.com');
  const staff = await addTeamMember(business, owner.id, 'rider337-gate-staff@example.com');
  const manager = await addTeamMember(business, owner.id, 'rider337-gate-mgr@example.com', { roleId: 'preset-manager', roleName: 'Manager', name: 'Manny Manager' });

  for (const who of [staff, manager]) {
    const res = await req(`${WF(business.id)}/payroll/my-details`, {
      method: 'PUT',
      body: { full_name: 'Nope', personal_address: 'Nope Street' },
      cookie: who.cookie,
    });
    assert.equal(res.status, 403);
    assert.match(JSON.stringify(res.json), /Only the business owner can update these details\./);
  }

  const longName = await req(`${WF(business.id)}/payroll/my-details`, {
    method: 'PUT',
    body: { full_name: 'x'.repeat(81), personal_address: '' },
    cookie: ownerCookie,
  });
  assert.equal(longName.status, 400);

  const longAddress = await req(`${WF(business.id)}/payroll/my-details`, {
    method: 'PUT',
    body: { full_name: 'Fine', personal_address: 'x'.repeat(1001) },
    cookie: ownerCookie,
  });
  assert.equal(longAddress.status, 400);

  // Nothing was written by any of the refused calls.
  const ctx = await req(`${WF(business.id)}/payroll/context`, { cookie: ownerCookie });
  assert.equal(ctx.json.me_profile.full_name, '');
  assert.equal(ctx.json.me_profile.personal_address, '');
});

test('viewer card: a viewer-level member sees their own card and stubs — and nobody else\u2019s data', async () => {
  const { business, user: owner } = await ownerWithBusiness('rider337-viewer@example.com');
  const viewer = await addTeamMember(business, owner.id, 'rider337-viewer-member@example.com', {
    roleId: 'preset-viewer', roleName: 'Viewer', name: 'Vera Viewer', address: '7 Viewer Lane',
  });
  await addTeamMember(business, owner.id, 'rider337-viewer-other@example.com', {
    name: 'Ollie Other', address: '99 Secret Road',
  });

  const ctx = await req(`${WF(business.id)}/payroll/context`, { cookie: viewer.cookie });
  assert.equal(ctx.status, 200);
  assert.equal(ctx.json.level, 'staff');
  assert.equal(ctx.json.me_profile.full_name, 'Vera Viewer');
  assert.equal(ctx.json.me_profile.personal_address, '7 Viewer Lane');
  assert.ok(!ctx.json.me_profile.owner, 'a member card is not the owner variant');
  assert.ok(!JSON.stringify(ctx.json).includes('Secret Road'), 'no other member\u2019s address in the context payload');

  // The pay-profiles read scopes to the viewer's own row only.
  const profiles = await req(`${WF(business.id)}/payroll/profiles`, { cookie: viewer.cookie });
  assert.equal(profiles.status, 200);
  assert.equal(profiles.json.profiles.length, 1);
  assert.equal(profiles.json.profiles[0].person.id, viewer.staffId);
  assert.ok(!JSON.stringify(profiles.json).includes('Secret Road'));

  // Own stubs read answers (empty here — the door itself is the point).
  const stubs = await req(`${WF(business.id)}/payroll/my-stubs`, { cookie: viewer.cookie });
  assert.equal(stubs.status, 200);
  assert.deepEqual(stubs.json.stubs, []);

  // Management doors stay shut for the viewer.
  const config = await req(`${WF(business.id)}/payroll/config`, { cookie: viewer.cookie });
  assert.equal(config.status, 403);
  const runs = await req(`${WF(business.id)}/payroll/runs`, { cookie: viewer.cookie });
  assert.equal(runs.status, 403);
});
