/**
 * T36 — Passenger 2 (owner's ruling, Nov 21, 2026, ~1:36 PM MST):
 * one-store auto-assignment of a staff member's store, ESSENTIALS
 * ONLY. On Essentials a member is born assigned to the business's
 * one store — no picking, no "No store" chip; the assignment
 * target is the store-level location only (a shelf pick resolves
 * to its store); Business keeps the manual pick exactly as
 * before. Plus the source pins for Passenger 1 (the photo
 * approval card stacking) and Passenger 3 (the sender's own
 * photo beside their own sent messages).
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  pool,
  req,
  close,
  resetRateLimits,
  ownerWithBusiness,
  setEntitlement,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function locationsOf(businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM locations WHERE business_id = $1 ORDER BY created_at ASC',
    [businessId],
  );
  return rows;
}

async function invite(owner, businessId, { email, name = 'Sam Staff', locationId = undefined, locationName = undefined }) {
  const body = {
    business_id: businessId,
    full_name: name,
    email,
    role_id: 'preset-sales',
    role_name: 'Sales clerk',
  };
  if (locationId !== undefined) body.location_id = locationId;
  if (locationName !== undefined) body.location_name = locationName;
  const res = await req('/api/entities/StaffMember', {
    method: 'POST', body, cookie: owner.cookie,
  });
  assert.equal(res.status, 201, res.text);
  return res.json;
}

async function storedMember(id) {
  const { rows } = await pool.query('SELECT * FROM staff_members WHERE id = $1', [id]);
  return rows[0];
}

async function listMembers(owner, businessId) {
  const res = await req('/api/entities/StaffMember/query', {
    method: 'POST', body: { filter: { business_id: businessId } }, cookie: owner.cookie,
  });
  assert.equal(res.status, 200, res.text);
  return res.json.items || res.json;
}

test('Essentials: a member added with no pick is born assigned to the one store', async () => {
  const owner = await ownerWithBusiness('ess-nopick@example.com');
  await setEntitlement(owner.business.id, { plan: 'essentials', status: 'active' });
  const [store] = await locationsOf(owner.business.id);
  assert.ok(store, 'the business has its seeded store');
  const member = await invite(owner, owner.business.id, { email: 'ess-nopick-staff@example.com' });
  assert.equal(member.location_id, store.id);
  assert.equal(member.location_name, store.name);
  const stored = await storedMember(member.id);
  assert.equal(stored.location_id, store.id);
});

test('Essentials: a shelf pick resolves to its store, never the shelf', async () => {
  const owner = await ownerWithBusiness('ess-shelf@example.com');
  await setEntitlement(owner.business.id, { plan: 'essentials', status: 'active' });
  const [store] = await locationsOf(owner.business.id);
  const shelfRes = await req(`/api/businesses/${owner.business.id}/locations`, {
    method: 'POST',
    body: { location: { name: 'Back shelf', kind: 'shelf', parent_id: store.id } },
    cookie: owner.cookie,
  });
  assert.equal(shelfRes.status, 201, shelfRes.text);
  const shelf = shelfRes.json.location;
  const member = await invite(owner, owner.business.id, {
    email: 'ess-shelf-staff@example.com', locationId: shelf.id, locationName: shelf.name,
  });
  assert.equal(member.location_id, store.id);
  assert.equal(member.location_name, store.name);
});

test('Essentials: an existing member with an empty pick reads as assigned', async () => {
  const owner = await ownerWithBusiness('ess-legacy@example.com');
  await setEntitlement(owner.business.id, { plan: 'essentials', status: 'active' });
  const [store] = await locationsOf(owner.business.id);
  // A legacy row written before the ruling: no store stored.
  const member = await invite(owner, owner.business.id, { email: 'ess-legacy-staff@example.com' });
  await pool.query('UPDATE staff_members SET location_id = NULL, location_name = \'\' WHERE id = $1', [member.id]);
  const listed = await listMembers(owner, owner.business.id);
  const row = listed.find((m) => m.id === member.id);
  assert.equal(row.location_id, store.id);
  assert.equal(row.location_name, store.name);
  const one = await req(`/api/entities/StaffMember/${member.id}`, {
    cookie: owner.cookie,
  });
  assert.equal(one.status, 200, one.text);
  assert.equal(one.json.location_id, store.id);
});

test('Business: the manual pick is exactly as before', async () => {
  const owner = await ownerWithBusiness('biz-manual@example.com');
  await setEntitlement(owner.business.id, { plan: 'business', status: 'active' });
  const [store] = await locationsOf(owner.business.id);
  // No pick stays empty on Business.
  const noPick = await invite(owner, owner.business.id, { email: 'biz-nopick@example.com' });
  assert.ok(!noPick.location_id);
  const stored = await storedMember(noPick.id);
  assert.ok(!stored.location_id);
  // A store pick is kept as picked.
  const picked = await invite(owner, owner.business.id, {
    email: 'biz-picked@example.com', locationId: store.id, locationName: store.name,
  });
  assert.equal(picked.location_id, store.id);
  // A legacy empty pick reads back empty on Business too.
  const listed = await listMembers(owner, owner.business.id);
  const row = listed.find((m) => m.id === noPick.id);
  assert.ok(!row.location_id);
});

test('Passenger 1 pin: the photo approval card stacks below phone width', () => {
  const src = fs.readFileSync(new URL('../../src/components/business/PhotoApprovalsCard.jsx', import.meta.url), 'utf8');
  assert.match(src, /flex-col/);
  assert.match(src, /sm:flex-row/);
  assert.match(src, /w-full/);
  assert.match(src, /sm:w-auto/);
});

test('Passenger 2 pin: the member dialog picker offers store-level locations only', () => {
  const src = fs.readFileSync(new URL('../../src/components/staff/StaffMemberDialog.jsx', import.meta.url), 'utf8');
  assert.match(src, /isOperatingSite\(location\)/);
});

test('Passenger 3 pin: own sent bubbles render the sender avatar', () => {
  const src = fs.readFileSync(new URL('../../src/pages/Workforce.jsx', import.meta.url), 'utf8');
  assert.match(src, /message\.mine && sender/);
});
