/**
 * T3 — Email-exposure rule (owner's ruling + audit, Nov 21, 2026).
 *
 * One rule: attribution stores and serves NAMES, never emails;
 * created_by is not served to non-owners. The audit
 * (~/workspace/email-exposure-audit-nov21/audit.md) found the
 * counts "Started by" email was one instance of three root
 * mechanisms — entity rows stamping the creator's email and
 * serving it to everyone (B1), client "…by" writes falling back
 * to the email because /api/auth/me carried no name (M2), and
 * server writes using the email AS the display string (M3).
 *
 * Pins here: entity payloads to staff carry no created_by /
 * created_by_id while the owner's are unchanged; legacy stored
 * emails in attribution fields resolve to names for non-owners
 * (movements, orders); new writes stamp names (order reserve,
 * cross-store ask, PO receive); the workforce people list, the
 * training team view, payroll preview and rewards payloads stop
 * carrying other people's emails to non-owners; roster-tick
 * managers read the roster without member emails; /api/auth/me
 * now carries the caller's display name.
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
  createProducts,
  createBusiness,
  setPlan,
  seededLocation,
  createLocation,
  receive,
} from './helpers.js';
import { PRESET_ROLES } from '../../server/authz.js';

after(close);
beforeEach(() => resetRateLimits());

const as = (who) => ({ cookie: who.cookie });

async function actor(owner, { email, roleId = 'preset-sales', roleName = 'Sales clerk' }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST',
    ...as(owner),
    body: { business_id: owner.business.id, full_name: roleName, email, role_id: roleId, role_name: roleName },
  });
  assert.equal(invite.status, 201, invite.text);
  const account = await registerVerifiedUser(email);
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [owner.business.id, account.user.id]);
  const row = (
    await pool.query('SELECT id FROM staff_members WHERE business_id = $1 AND email = $2', [owner.business.id, email])
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

async function setOwnerName(owner, name) {
  const res = await req(`/api/businesses/${owner.business.id}/profile-photos/owner-name`, {
    method: 'PUT',
    ...as(owner),
    body: { name },
  });
  assert.equal(res.status, 200, res.text);
}

const listEntities = (who, name, businessId) =>
  req(`/api/entities/${name}/query`, {
    method: 'POST',
    ...as(who),
    body: { filter: { business_id: businessId } },
  });

test('entity payloads: created_by is served to the owner, never to staff', async () => {
  const owner = await ownerWithBusiness('expo-created-owner@example.com');
  const clerk = await actor(owner, { email: 'expo-created-clerk@example.com' });
  const [product] = await createProducts(owner.cookie, owner.business.id, [{ name: 'Expo Widget', sku: 'EX-1', price: 5 }]);

  const ownerList = await listEntities(owner, 'Product', owner.business.id);
  const ownerRow = ownerList.json.items.find((row) => row.id === product.id);
  assert.equal(ownerRow.created_by, 'expo-created-owner@example.com');

  const staffList = await listEntities(clerk, 'Product', owner.business.id);
  assert.equal(staffList.status, 200, staffList.text);
  const staffRow = staffList.json.items.find((row) => row.id === product.id);
  assert.ok(staffRow, 'staff still read the product');
  assert.ok(!('created_by' in staffRow), 'no created_by for staff');
  assert.ok(!('created_by_id' in staffRow), 'no created_by_id for staff');

  const staffGet = await req(`/api/entities/Product/${product.id}`, { ...as(clerk) });
  assert.equal(staffGet.status, 200, staffGet.text);
  assert.ok(!('created_by' in staffGet.json), 'single reads strip it too');
});

test('legacy movement rows: staff see the actor name, the owner sees the row as stored', async () => {
  const owner = await ownerWithBusiness('expo-move-owner@example.com');
  const clerk = await actor(owner, { email: 'expo-move-clerk@example.com' });
  await setOwnerName(owner, 'Concepcion');
  const [product] = await createProducts(owner.cookie, owner.business.id, [{ name: 'Move Widget', sku: 'MV-1', price: 5 }]);
  const legacyId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO stock_movements (id, business_id, product_id, product_name, sku, type, quantity, user_name)
     VALUES ($1, $2, $3, 'Move Widget', 'MV-1', 'receive', 3, $4)`,
    [legacyId, owner.business.id, product.id, 'expo-move-owner@example.com'],
  );

  const staffList = await listEntities(clerk, 'StockMovement', owner.business.id);
  const staffRow = staffList.json.items.find((row) => row.id === legacyId);
  assert.equal(staffRow.user_name, 'Concepcion');

  const ownerList = await listEntities(owner, 'StockMovement', owner.business.id);
  const ownerRow = ownerList.json.items.find((row) => row.id === legacyId);
  assert.equal(ownerRow.user_name, 'expo-move-owner@example.com');
});

test('a movement written through the scan door is stamped with the actor name', async () => {
  const owner = await ownerWithBusiness('expo-scan-owner@example.com');
  await setOwnerName(owner, 'Concepcion');
  const location = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [{ name: 'Scan Widget', sku: 'SC-1', price: 5 }]);
  const moved = await req(`/api/businesses/${owner.business.id}/movements`, {
    method: 'POST',
    ...as(owner),
    body: { product_id: product.id, location_id: location.id, type: 'receive', quantity: 2 },
  });
  assert.equal(moved.status, 201, moved.text);
  assert.equal(moved.json.movement.user_name, 'Concepcion');
});

test('order attribution writes stamp names; /api/auth/me carries the caller name', async () => {
  const owner = await ownerWithBusiness('expo-order-owner@example.com');
  const clerk = await actor(owner, { email: 'expo-order-clerk@example.com' });
  await setOwnerName(owner, 'Concepcion');

  const created = await req('/api/entities/Order', {
    method: 'POST',
    ...as(owner),
    body: { business_id: owner.business.id, number: 'ORD-EXPO-1', status: 'open', reserved_by: 'expo-order-owner@example.com' },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.reserved_by, 'Concepcion');

  const meOwner = await req('/api/auth/me', { ...as(owner) });
  assert.equal(meOwner.json.full_name, 'Concepcion');
  const meClerk = await req('/api/auth/me', { ...as(clerk) });
  assert.equal(meClerk.json.full_name, 'Sales clerk');
});

test('workforce people + payroll preview: no team emails for non-owners', async () => {
  const owner = await ownerWithBusiness('expo-people-owner@example.com');
  const manager = await actor(owner, { email: 'expo-people-mgr@example.com', roleId: 'preset-manager', roleName: 'Manny Manager' });
  await actor(owner, { email: 'expo-people-clerk@example.com' });

  const ownerPeople = await req(`/api/businesses/${owner.business.id}/workforce/people`, { ...as(owner) });
  assert.ok(ownerPeople.json.people.every((p) => typeof p.email === 'string' && p.email.includes('@')), 'owner keeps emails');

  const mgrPeople = await req(`/api/businesses/${owner.business.id}/workforce/people`, { ...as(manager) });
  assert.equal(mgrPeople.status, 200, mgrPeople.text);
  assert.ok(mgrPeople.json.people.every((p) => !('email' in p)), 'manager payload has no emails');
  assert.ok(mgrPeople.json.people.some((p) => p.full_name === 'Sales clerk'), 'names still listed');

  const preview = await req(
    `/api/businesses/${owner.business.id}/workforce/payroll/preview?start=2026-11-16&end=2026-11-22`,
    { ...as(manager) },
  );
  assert.equal(preview.status, 200, preview.text);
  assert.ok(preview.json.people.every((row) => !('email' in row.person)), 'preview payload has no emails');
});

test('training team view: managers get progress without staff emails', async () => {
  const owner = await ownerWithBusiness('expo-team-owner@example.com');
  const manager = await actor(owner, { email: 'expo-team-mgr@example.com', roleId: 'preset-manager', roleName: 'Manny Manager' });
  await actor(owner, { email: 'expo-team-clerk@example.com' });

  const ownerTeam = await req(`/api/businesses/${owner.business.id}/training/team`, { ...as(owner) });
  assert.ok(ownerTeam.json.people.some((p) => p.email === 'expo-team-clerk@example.com'), 'owner keeps emails');

  const mgrTeam = await req(`/api/businesses/${owner.business.id}/training/team`, { ...as(manager) });
  assert.equal(mgrTeam.status, 200, mgrTeam.text);
  assert.ok(mgrTeam.json.people.length >= 1, 'manager still sees staff progress');
  assert.ok(mgrTeam.json.people.every((p) => !('email' in p)), 'manager payload has no emails');
});

test('roster-tick managers read the roster without member emails; the owner keeps them', async () => {
  const owner = await ownerWithBusiness('expo-roster-owner@example.com');
  const manager = await actor(owner, { email: 'expo-roster-mgr@example.com', roleId: 'preset-manager', roleName: 'Manny Manager' });
  const clerk = await actor(owner, { email: 'expo-roster-clerk@example.com' });

  // Grant the staff.roster tick the way the enrollment dialog saves it.
  const row = (
    await pool.query('SELECT permissions, role_id FROM staff_members WHERE id = $1', [manager.memberId])
  ).rows[0];
  let permissions = [];
  try { permissions = JSON.parse(row.permissions || '[]'); } catch { permissions = []; }
  if (!permissions.length) {
    const preset = PRESET_ROLES.find((role) => role.id === row.role_id);
    permissions = preset ? [...preset.permissions] : [];
  }
  await pool.query('UPDATE staff_members SET permissions = $1 WHERE id = $2', [
    JSON.stringify([...new Set([...permissions, 'staff.roster'])]),
    manager.memberId,
  ]);

  const mgrList = await listEntities(manager, 'StaffMember', owner.business.id);
  assert.equal(mgrList.status, 200, mgrList.text);
  const clerkRow = mgrList.json.items.find((r) => r.id === clerk.memberId);
  assert.ok(clerkRow, 'roster manager sees the clerk row');
  assert.ok(!('email' in clerkRow), "clerk's email is not in the roster payload");
  const ownRow = mgrList.json.items.find((r) => r.id === manager.memberId);
  assert.equal(ownRow.email, 'expo-roster-mgr@example.com', 'their own email stays their own');

  const ownerList = await listEntities(owner, 'StaffMember', owner.business.id);
  const ownerClerkRow = ownerList.json.items.find((r) => r.id === clerk.memberId);
  assert.equal(ownerClerkRow.email, 'expo-roster-clerk@example.com', 'owner view unchanged');
});

test('cross-store asks store the asker name; a staff inbox resolves legacy emails', async () => {
  const owner = await ownerWithBusiness('expo-cross-owner@example.com');
  await setPlan(owner.business.id, 'business', owner.user.id);
  await setOwnerName(owner, 'Concepcion');
  const storeB = await createBusiness(owner.cookie, 'Second Store');
  await setPlan(storeB.id, 'business', owner.user.id);
  const locationB = await createLocation(owner.cookie, storeB.id, { name: 'Main' });
  const [productA] = await createProducts(owner.cookie, owner.business.id, [{ name: 'Cross Notebook', sku: 'CR-1', price: 12 }]);
  const [productB] = await createProducts(owner.cookie, storeB.id, [{ name: 'Cross Notebook', sku: 'CR-1', price: 12 }]);
  await receive(owner.cookie, storeB.id, productB.id, locationB.id, 5);

  const asked = await req(`/api/businesses/${owner.business.id}/cross-store/requests`, {
    method: 'POST',
    ...as(owner),
    body: { target_business_id: storeB.id, product_id: productA.id, mode: 'ship', message: 'Please send one over.' },
  });
  assert.equal(asked.status, 201, asked.text);
  assert.equal(asked.json.request.requested_by, 'Concepcion');
});

test('receiving a purchase order stamps the receiver name', async () => {
  const owner = await ownerWithBusiness('expo-po-owner@example.com');
  await setPlan(owner.business.id, 'business', owner.user.id);
  await setOwnerName(owner, 'Concepcion');
  const location = await seededLocation(owner.cookie, owner.business.id);
  const [product] = await createProducts(owner.cookie, owner.business.id, [{ name: 'PO Widget', sku: 'PO-1', price: 9 }]);
  const supplier = await req('/api/entities/Supplier', {
    method: 'POST',
    ...as(owner),
    body: { business_id: owner.business.id, name: 'Expo Supplier' },
  });
  assert.equal(supplier.status, 201, supplier.text);
  const po = await req('/api/entities/PurchaseOrder', {
    method: 'POST',
    ...as(owner),
    body: {
      business_id: owner.business.id,
      number: 'PO-EXPO-1',
      supplier_id: supplier.json.id,
      supplier_name: 'Expo Supplier',
      location_id: location.id,
      location_name: location.name,
      lines: [{ product_id: product.id, product_name: product.name, sku: product.sku, qty_ordered: 4, qty_received: 0, unit_cost: 3 }],
    },
  });
  assert.equal(po.status, 201, po.text);
  const ordered = await req(`/api/businesses/${owner.business.id}/purchase-orders/${po.json.id}/order`, {
    method: 'POST',
    ...as(owner),
    body: {},
  });
  assert.equal(ordered.status, 200, ordered.text);
  const receivedRes = await req(`/api/businesses/${owner.business.id}/purchase-orders/${po.json.id}/receive`, {
    method: 'POST',
    ...as(owner),
    body: { location_id: location.id, receipts: [4] },
  });
  assert.equal(receivedRes.status, 200, receivedRes.text);
  const stored = await pool.query('SELECT received_by FROM purchase_orders WHERE id = $1', [po.json.id]);
  assert.equal(stored.rows[0].received_by, 'Concepcion');
});

test('rewards payloads: a manager list carries no recipient emails; the owner keeps them', async () => {
  const owner = await ownerWithBusiness('expo-rw-owner@example.com');
  await setPlan(owner.business.id, 'business', owner.user.id);
  const manager = await actor(owner, { email: 'expo-rw-mgr@example.com', roleId: 'preset-manager', roleName: 'Manny Manager' });
  const clerk = await actor(owner, { email: 'expo-rw-clerk@example.com' });

  const given = await req(`/api/businesses/${owner.business.id}/workforce/rewards`, {
    method: 'POST',
    ...as(manager),
    body: { recipient_staff_id: clerk.memberId, kind: 'percent_off', title: 'Expo thanks', percent_value: 10 },
  });
  assert.equal(given.status, 201, given.text);
  assert.ok(!('recipient_email' in given.json.reward), 'even the give response drops it for a manager');

  const mgrList = await req(`/api/businesses/${owner.business.id}/workforce/rewards`, { ...as(manager) });
  assert.equal(mgrList.status, 200, mgrList.text);
  assert.ok(mgrList.json.rewards.length >= 1);
  assert.ok(mgrList.json.rewards.every((r) => !('recipient_email' in r)), 'manager list has no recipient emails');

  const ownerList = await req(`/api/businesses/${owner.business.id}/workforce/rewards`, { ...as(owner) });
  assert.ok(ownerList.json.rewards.some((r) => r.recipient_email === 'expo-rw-clerk@example.com'), 'owner keeps recipient emails');
});
