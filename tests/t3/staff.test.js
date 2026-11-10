/**
 * T3 staff — invites, the Essentials 3-seat cap, Business-only
 * permission stripping, the PR #63 provenance rule (attacker rows
 * grant nothing), staff-read-by-email, owner delete of any row, and
 * invite activation on sign-in. Real Express app over HTTP against
 * pg-mem.
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
  ownerWithBusiness,
  createProducts,
  setPlan,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

async function invite(cookie, businessId, member) {
  return req(`/api/businesses/${businessId}/staff`, {
    method: 'POST',
    body: { business_id: businessId, member },
    cookie,
  });
}

function member(i, overrides = {}) {
  return {
    full_name: `Staff ${i}`,
    email: `staff${i}@example.com`,
    role_id: 'preset-sales',
    role_name: 'Sales clerk',
    permissions: ['products.view', 'scan.use', 'orders.manage'],
    status: 'invited',
    ...overrides,
  };
}

test('invite creates a staff row owned by the inviter, with a seat held', async () => {
  const { cookie, business, user } = await ownerWithBusiness('staff-invite@example.com');
  const res = await invite(cookie, business.id, member(1));
  assert.equal(res.status, 201);
  assert.equal(res.json.member.email, 'staff1@example.com');
  assert.equal(res.json.member.status, 'invited');
  assert.equal(res.json.member.created_by_id, user.id);
  assert.ok(res.json.member.invited_at);
});

test('Essentials cap: the 4th additional staff member is refused (403 staff_limit)', async () => {
  const { cookie, business } = await ownerWithBusiness('staff-cap@example.com');
  for (let i = 1; i <= 3; i += 1) {
    const res = await invite(cookie, business.id, member(i));
    assert.equal(res.status, 201, `seat ${i} should fit`);
  }
  const fourth = await invite(cookie, business.id, member(4));
  assert.equal(fourth.status, 403);
  assert.equal(fourth.json.error, 'staff_limit');
  assert.equal(fourth.json.limit, 3);
  assert.equal(fourth.json.used, 3);
  // A suspended row does not hold a seat.
  const rows = await pool.query("SELECT id FROM staff_members WHERE business_id = $1 AND status = 'invited' LIMIT 1", [business.id]);
  await req(`/api/businesses/${business.id}/staff/${rows.rows[0].id}`, {
    method: 'PATCH',
    body: { status: 'suspended' },
    cookie,
  });
  const retry = await invite(cookie, business.id, member(4));
  assert.equal(retry.status, 201);
});

test('Business plan has no staff cap; custom roles are Business-only', async () => {
  const { cookie, business, user } = await ownerWithBusiness('staff-biz@example.com');
  await setPlan(business.id, 'business', user.id);
  for (let i = 1; i <= 5; i += 1) {
    const res = await invite(cookie, business.id, member(i));
    assert.equal(res.status, 201);
  }
  const role = await req(`/api/businesses/${business.id}/roles`, {
    method: 'POST',
    body: { role: { name: 'Packer', permissions: ['products.view', 'orders.manage'] } },
    cookie,
  });
  assert.equal(role.status, 201);
  assert.equal(role.json.role.name, 'Packer');

  const ess = await ownerWithBusiness('staff-ess-role@example.com');
  const denied = await req(`/api/businesses/${ess.business.id}/roles`, {
    method: 'POST',
    body: { role: { name: 'Packer', permissions: ['products.view'] } },
    cookie: ess.cookie,
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error, 'custom_roles_business_only');
});

test('Essentials invite strips Business-only permissions instead of refusing the seat', async () => {
  const { cookie, business } = await ownerWithBusiness('staff-strip@example.com');
  const res = await invite(cookie, business.id, member(1, {
    permissions: ['products.view', 'builds.manage', 'suppliers.manage', 'scan.use'],
  }));
  assert.equal(res.status, 201);
  assert.deepEqual(res.json.member.permissions, ['products.view', 'scan.use']);
});

test('staff-read-by-email: an invited member reads only their own row', async () => {
  const owner = await ownerWithBusiness('staff-read-owner@example.com');
  await invite(owner.cookie, owner.business.id, member(1, { email: 'reader@example.com' }));
  await invite(owner.cookie, owner.business.id, member(2, { email: 'other-staff@example.com' }));

  // The invited member registers with the invited email and signs in.
  const staffUser = await registerVerifiedUser('reader@example.com');
  // Their row is now Active (activation on sign-in).
  const me = await req(`/api/businesses/${owner.business.id}/staff/me`, {
    method: 'GET',
    cookie: staffUser.cookie,
  });
  assert.equal(me.status, 200);
  assert.equal(me.json.email, 'reader@example.com');
  assert.equal(me.json.status, 'active');

  const list = await req(`/api/businesses/${owner.business.id}/staff`, {
    method: 'GET',
    cookie: staffUser.cookie,
  });
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1, 'a staff member sees only their own row');
  assert.equal(list.json.items[0].email, 'reader@example.com');

  // The owner sees both rows.
  const ownerList = await req(`/api/businesses/${owner.business.id}/staff`, {
    method: 'GET',
    cookie: owner.cookie,
  });
  assert.equal(ownerList.json.items.length, 2);
});

test('provenance attack: an attacker-created staff row grants nothing', async () => {
  const owner = await ownerWithBusiness('staff-prov-owner@example.com');
  const attacker = await registerVerifiedUser('attacker@example.com');
  // The attacker forges a StaffMember row directly in the database
  // with themselves as creator (simulating a row that did not come
  // from the owner's invite path).
  const forgedId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members
       (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id, created_by)
     VALUES ($1,$2,$3,$4,'user','preset-manager','Manager','["products.view","products.edit","staff.manage"]','active',$5,$6)`,
    [forgedId, owner.business.id, 'Attacker', 'attacker@example.com', attacker.user.id, 'attacker@example.com'],
  );
  // The attacker cannot read the business's products through it.
  const products = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: owner.business.id } },
    cookie: attacker.cookie,
  });
  assert.equal(products.json.items.length, 0);
  const create = await req('/api/entities/Product', {
    method: 'POST',
    body: { business_id: owner.business.id, name: 'Forged product' },
    cookie: attacker.cookie,
  });
  assert.equal(create.status, 403);
  // And the attacker cannot even read their own forged row as staff:
  // the row is untrusted, so the staff list is closed to them.
  const list = await req(`/api/businesses/${owner.business.id}/staff`, {
    method: 'GET',
    cookie: attacker.cookie,
  });
  assert.equal(list.status, 403);
});

test('owner deletes an attacker-created staff row (PR #63 follow-up (b))', async () => {
  const owner = await ownerWithBusiness('staff-del-owner@example.com');
  const attacker = await registerVerifiedUser('attacker2@example.com');
  const forgedId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members
       (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id, created_by)
     VALUES ($1,$2,$3,$4,'user','preset-viewer','Viewer','["products.view"]','active',$5,$6)`,
    [forgedId, owner.business.id, 'Attacker', 'attacker2@example.com', attacker.user.id, 'attacker2@example.com'],
  );
  const deleted = await req(`/api/businesses/${owner.business.id}/staff/${forgedId}`, {
    method: 'DELETE',
    cookie: owner.cookie,
  });
  assert.equal(deleted.status, 200);
  const gone = await pool.query('SELECT id FROM staff_members WHERE id = $1', [forgedId]);
  assert.equal(gone.rows.length, 0);
  // A staff member may NOT delete another staff row.
  const victim = await invite(owner.cookie, owner.business.id, member(1, { email: 'victim@example.com' }));
  const staffUser = await registerVerifiedUser('victim@example.com');
  const denied = await req(`/api/businesses/${owner.business.id}/staff/${victim.json.member.id}`, {
    method: 'DELETE',
    cookie: staffUser.cookie,
  });
  assert.equal(denied.status, 403);
});

test('a staff member with only products.view cannot create products', async () => {
  const owner = await ownerWithBusiness('staff-perm-owner@example.com');
  await invite(owner.cookie, owner.business.id, member(1, {
    email: 'viewer@example.com',
    role_id: 'preset-viewer',
    permissions: ['products.view', 'reports.view', 'print.use'],
  }));
  const staffUser = await registerVerifiedUser('viewer@example.com');
  const create = await req('/api/entities/Product', {
    method: 'POST',
    body: { business_id: owner.business.id, name: 'Not allowed' },
    cookie: staffUser.cookie,
  });
  assert.equal(create.status, 403);
  // ...but they CAN read the catalog.
  await createProducts(owner.cookie, owner.business.id, [{ name: 'Visible', sku: 'VIS-1' }]);
  const list = await req('/api/entities/Product/query', {
    method: 'POST',
    body: { filter: { business_id: owner.business.id } },
    cookie: staffUser.cookie,
  });
  assert.equal(list.json.items.length, 1);
});

test('invite requires a name and email, and refuses a duplicate email', async () => {
  const { cookie, business } = await ownerWithBusiness('staff-valid@example.com');
  const noEmail = await invite(cookie, business.id, { full_name: 'No Email' });
  assert.equal(noEmail.status, 400);
  await invite(cookie, business.id, member(1));
  const dup = await invite(cookie, business.id, member(1));
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, 'staff_exists');
});

test('staff login activates the invited row (no separate accept step)', async () => {
  const owner = await ownerWithBusiness('staff-activate@example.com');
  await invite(owner.cookie, owner.business.id, member(1, { email: 'joiner@example.com' }));
  const before = await pool.query(
    "SELECT status FROM staff_members WHERE business_id = $1 AND email = $2",
    [owner.business.id, 'joiner@example.com'],
  );
  assert.equal(before.rows[0].status, 'invited');
  const staffUser = await registerVerifiedUser('joiner@example.com');
  const after = await pool.query(
    "SELECT status, joined_at FROM staff_members WHERE business_id = $1 AND email = $2",
    [owner.business.id, 'joiner@example.com'],
  );
  assert.equal(after.rows[0].status, 'active');
  assert.ok(after.rows[0].joined_at);
  // And a later plain login keeps it active (no flip back).
  const relogin = await login('joiner@example.com', 'CorrectHorse123');
  assert.equal(relogin.status, 200);
  void staffUser;
});
