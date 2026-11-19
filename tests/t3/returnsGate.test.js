/**
 * T3 — The returns approval gate (owner ruling, Nov 19, 2026).
 *
 * Before this build, approve / complete rode the same
 * returns.manage permission as logging a return: a Sales clerk
 * who logged a return could approve and complete it themselves,
 * immediately — the owner's stop did not exist anywhere.
 *
 * The gate: moving a return INTO `approved` or `completed`
 * belongs to the owner, or to a member the owner granted
 * returns.complete — a per-member enrollment tick (the
 * release-314 pattern: stored in the member's permissions
 * array, carried by NO role, off by default, managers
 * included). Logging, editing and rejecting a return stay
 * returns.manage work exactly as before. A return is also BORN
 * waiting: a non-grant create that asks for approved/completed
 * starts at 'new'.
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

const GATE_MESSAGE =
  'Only the owner, or a team member the owner has allowed to complete refunds and exchanges, can approve and finish a return.';

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

/** Give or take the returns.complete tick on a member's stored
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
    ? [...new Set([...permissions, 'returns.complete'])]
    : permissions.filter((key) => key !== 'returns.complete');
  await pool.query('UPDATE staff_members SET permissions = $1 WHERE business_id = $2 AND id = $3', [
    JSON.stringify(next),
    businessId,
    memberId,
  ]);
}

let seq = 0;
async function createReturn(cookie, businessId, values = {}) {
  seq += 1;
  return req('/api/entities/Return', {
    method: 'POST',
    cookie,
    body: {
      business_id: businessId,
      number: `RET-GATE-${seq}`,
      kind: 'return',
      status: 'new',
      lines: [{ product_id: '', product_name: 'Widget', sku: 'W-1', quantity: 1, condition: 'sellable', restock: false, unit_price: 5 }],
      refund_amount: 5,
      ...values,
    },
  });
}

async function moveReturn(cookie, id, patch) {
  return req(`/api/entities/Return/${id}`, { method: 'PATCH', cookie, body: patch });
}

async function savedReturn(cookie, businessId, id) {
  const res = await req('/api/entities/Return/query', {
    method: 'POST',
    cookie,
    body: { filter: { business_id: businessId } },
  });
  assert.equal(res.status, 200, res.text);
  return res.json.items.find((row) => row.id === id);
}

test('staff without the grant: creates a return, but approval and completion refuse and the return stays waiting', async () => {
  const owner = await ownerWithBusiness('gate-sales-owner@example.com');
  const sales = await actor(owner, {
    email: 'gate-sales@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });

  const created = await createReturn(sales.cookie, owner.business.id);
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.status, 'new');

  const approve = await moveReturn(sales.cookie, created.json.id, { status: 'approved' });
  assert.equal(approve.status, 403, approve.text);
  assert.equal(approve.json.error, 'returns_complete_not_granted');
  assert.equal(approve.json.message, GATE_MESSAGE);

  const complete = await moveReturn(sales.cookie, created.json.id, { status: 'completed' });
  assert.equal(complete.status, 403, complete.text);
  assert.equal(complete.json.error, 'returns_complete_not_granted');

  const saved = await savedReturn(owner.cookie, owner.business.id, created.json.id);
  assert.equal(saved.status, 'new', 'the return never moved — it is still waiting for approval');
});

test('a manager holds returns.manage but NOT the grant by default — approval refuses until the owner ticks it', async () => {
  const owner = await ownerWithBusiness('gate-manager-owner@example.com');
  const manager = await actor(owner, {
    email: 'gate-manager@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });

  const created = await createReturn(manager.cookie, owner.business.id);
  assert.equal(created.status, 201, created.text);

  const refused = await moveReturn(manager.cookie, created.json.id, { status: 'approved' });
  assert.equal(refused.status, 403, refused.text);
  assert.equal(refused.json.error, 'returns_complete_not_granted');

  await setGrant(owner.business.id, manager.memberId, true);
  const approved = await moveReturn(manager.cookie, created.json.id, {
    status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: 'Manny Manager',
  });
  assert.equal(approved.status, 200, approved.text);
  assert.equal(approved.json.status, 'approved');

  const completed = await moveReturn(manager.cookie, created.json.id, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    completed_by: 'Manny Manager',
  });
  assert.equal(completed.status, 200, completed.text);
  assert.equal(completed.json.status, 'completed');
});

test('staff WITH the grant completes a return end to end', async () => {
  const owner = await ownerWithBusiness('gate-granted-owner@example.com');
  const sales = await actor(owner, {
    email: 'gate-granted@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  await setGrant(owner.business.id, sales.memberId, true);

  const created = await createReturn(sales.cookie, owner.business.id);
  assert.equal(created.status, 201, created.text);
  const approved = await moveReturn(sales.cookie, created.json.id, { status: 'approved' });
  assert.equal(approved.status, 200, approved.text);
  const completed = await moveReturn(sales.cookie, created.json.id, { status: 'completed' });
  assert.equal(completed.status, 200, completed.text);
  assert.equal(completed.json.status, 'completed');
});

test('the owner approves and completes with no tick anywhere', async () => {
  const owner = await ownerWithBusiness('gate-owner@example.com');
  const created = await createReturn(owner.cookie, owner.business.id);
  assert.equal(created.status, 201, created.text);
  const approved = await moveReturn(owner.cookie, created.json.id, { status: 'approved' });
  assert.equal(approved.status, 200, approved.text);
  const completed = await moveReturn(owner.cookie, created.json.id, { status: 'completed' });
  assert.equal(completed.status, 200, completed.text);
  assert.equal(completed.json.status, 'completed');
});

test('a member whose grant is removed can no longer approve — a return they could approve before refuses', async () => {
  const owner = await ownerWithBusiness('gate-revoked-owner@example.com');
  const manager = await actor(owner, {
    email: 'gate-revoked@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  await setGrant(owner.business.id, manager.memberId, true);

  const first = await createReturn(manager.cookie, owner.business.id);
  const ok = await moveReturn(manager.cookie, first.json.id, { status: 'approved' });
  assert.equal(ok.status, 200, ok.text);

  await setGrant(owner.business.id, manager.memberId, false);
  const second = await createReturn(manager.cookie, owner.business.id);
  const refused = await moveReturn(manager.cookie, second.json.id, { status: 'approved' });
  assert.equal(refused.status, 403, refused.text);
  assert.equal(refused.json.error, 'returns_complete_not_granted');
  const saved = await savedReturn(owner.cookie, owner.business.id, second.json.id);
  assert.equal(saved.status, 'new');
});

test('a return is born waiting: a non-grant create asking for approved or completed starts at new', async () => {
  const owner = await ownerWithBusiness('gate-born-owner@example.com');
  const sales = await actor(owner, {
    email: 'gate-born@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  for (const status of ['approved', 'completed']) {
    const created = await createReturn(sales.cookie, owner.business.id, { status });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.status, 'new', `a ${status} create by a non-grant member starts at new`);
  }
});

test('the gate binds approval and completion only: logging, editing and rejecting stay returns.manage work', async () => {
  const owner = await ownerWithBusiness('gate-scope-owner@example.com');
  const sales = await actor(owner, {
    email: 'gate-scope@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  const created = await createReturn(sales.cookie, owner.business.id);
  assert.equal(created.status, 201, created.text);

  const edited = await moveReturn(sales.cookie, created.json.id, { notes: 'Customer changed their mind at the till.' });
  assert.equal(edited.status, 200, edited.text);

  const rejected = await moveReturn(sales.cookie, created.json.id, { status: 'rejected' });
  assert.equal(rejected.status, 200, rejected.text);
  assert.equal(rejected.json.status, 'rejected');
});

test('the gate holds on the Business plan too', async () => {
  const owner = await ownerWithBusiness('gate-business-owner@example.com', 'Test Shop', { plan: 'business' });
  const sales = await actor(owner, {
    email: 'gate-business@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  const created = await createReturn(sales.cookie, owner.business.id);
  assert.equal(created.status, 201, created.text);
  const refused = await moveReturn(sales.cookie, created.json.id, { status: 'approved' });
  assert.equal(refused.status, 403, refused.text);
  await setGrant(owner.business.id, sales.memberId, true);
  const approved = await moveReturn(sales.cookie, created.json.id, { status: 'approved' });
  assert.equal(approved.status, 200, approved.text);
});

// ---- Source pins: the tick, the card and the lesson ----

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('the tick lives in the member dialog as its own grant state, beside the Settings grants', () => {
  const dialog = read('../../src/components/staff/StaffMemberDialog.jsx');
  assert.match(dialog, /RETURNS_GRANTS\.map/, 'the dialog renders the returns grants');
  assert.match(dialog, /returns_grants/, 'the dialog keeps the returns grants as their own form state');
  assert.match(dialog, /isReturnsGrant/, 'the dialog splits the returns grants out of the stored array');
  const staff = read('../../src/lib/staff.js');
  assert.match(staff, /key: 'returns\.complete'/, 'the grant key is returns.complete');
});

test('the returns card offers Approve / Complete only to a completer, and tells everyone else the return is waiting', () => {
  const card = read('../../src/components/returns/ReturnCard.jsx');
  assert.match(card, /record\.status === 'new' && canComplete/, 'approve renders only for a completer');
  assert.match(card, /record\.status === 'approved' && canComplete/, 'complete renders only for a completer');
  assert.match(card, /returns\.waitingApproval/, 'a new return tells a non-completer it is waiting for approval');
  assert.match(card, /returns\.waitingToFinish/, 'an approved return tells a non-completer who will finish it');
  const page = read('../../src/pages/Returns.jsx');
  assert.match(page, /can\('returns\.complete'\)/, 'the page reads the grant for the signed-in person');
});

test('the returns lesson teaches the gate: a return you start waits to be approved and finished', () => {
  const en = read('../../src/lib/locales/en.js');
  assert.match(
    en,
    /"training\.lessons\.returns-basics\.step4": "The refund amount is worked out on the return — check it with the customer\. A return you start then waits to be approved and finished by the owner/,
    'step 4 names the approval stop',
  );
});
