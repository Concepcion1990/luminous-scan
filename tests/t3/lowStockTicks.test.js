/**
 * T3 — The two Business low-stock owner ticks (owner rulings,
 * Nov 20, 2026, ~5:20 PM / ~5:55 PM MST, confirmed with a ❤️).
 *
 * On Business, low stock becomes owner-handed-out per member via
 * TWO sibling ticks in the grant family (314/317/318/320/322):
 *
 *   alerts.view      — the low-stock ALERT surfaces (Needs
 *                      attention box, Low stock page + doors +
 *                      route, LOW badges, low counts, the alerts
 *                      endpoints) show to a non-owner only when
 *                      ticked. Client gates live with the 327
 *                      sweep pins (tests/t6/lowStockSweep.test.js);
 *                      the server half is pinned here.
 *   products.reorder — the "Reorder at" box STAYS VISIBLE to
 *                      everyone on Business, but a non-owner may
 *                      SAVE a change to reorder_point only when
 *                      ticked. Enforced at the server: product
 *                      create, product update (which is also the
 *                      Bulk edit write path). A save that does
 *                      not change reorder_point proceeds under
 *                      the normal edit right; a create born with
 *                      a non-default point counts as setting it.
 *
 * Both ticks: stored in the member's permissions array (no
 * migration — the column already carries the grant family),
 * carried by NO role preset, off by default, the owner holds
 * both inherently. Neither exists on Essentials: the reorder
 * gate is Business-only server-side and the enrollment block
 * is plan-gated client-side, so an Essentials member's stored
 * reorder_point values ride through untouched (327's law).
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

const REORDER_MESSAGE =
  'Only the owner, or a team member the owner has allowed to change reorder points, can change a reorder point.';
const ALERTS_MESSAGE =
  'Only the owner, or a team member the owner has allowed to see low-stock alerts, can see low-stock alerts.';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** Invite a member with a preset role, activate their account, and
 * give them a full-week schedule so the shift window lets their
 * session work (owner ruling, Nov 19, 2026). */
async function actor(owner, { email, roleId, roleName }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST', cookie: owner['cookie'],
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

/** Give or take a grant tick on a member's stored permissions —
 * the same array the enrollment dialog edits. A member invited
 * without an explicit array stores an EMPTY one and the server
 * falls back to their role; the dialog instead always saves the
 * full set, so materialize the role's permissions first, exactly
 * as a dialog save would leave them. */
async function setGrant(businessId, memberId, key, granted) {
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
    ? [...new Set([...permissions, key])]
    : permissions.filter((k) => k !== key);
  await pool.query('UPDATE staff_members SET permissions = $1 WHERE business_id = $2 AND id = $3', [
    JSON.stringify(next),
    businessId,
    memberId,
  ]);
}

let seq = 0;
async function createProduct(cookie, businessId, values = {}) {
  seq += 1;
  return req('/api/entities/Product', {
    method: 'POST',
    cookie,
    body: { business_id: businessId, name: `Tick Widget ${seq}`, sku: `TW-${seq}`, ...values },
  });
}

test('the two ticks join the grant family: staff.js carries them, no preset does', () => {
  const staff = read('src/lib/staff.js');
  assert.match(staff, /export const LOW_STOCK_GRANTS = \[/);
  assert.match(staff, /key: 'alerts\.view', get label\(\) \{ return t\('staffLib\.perm\.alertsView'\); \}/);
  assert.match(staff, /key: 'products\.reorder', get label\(\) \{ return t\('staffLib\.perm\.productsReorder'\); \}/);
  assert.match(staff, /export function isLowStockGrant\(key\)/);
  assert.match(staff, /isLowStockGrant\(key\)/, 'isMemberGrant sweeps the low-stock ticks out of the role picker');
  for (const role of PRESET_ROLES) {
    assert.ok(!role.permissions.includes('alerts.view'), `${role.id} preset must not carry alerts.view`);
    assert.ok(!role.permissions.includes('products.reorder'), `${role.id} preset must not carry products.reorder`);
  }
});

test('the enrollment dialog renders the pair plan-gated, as their own grant state', () => {
  const dialog = read('src/components/staff/StaffMemberDialog.jsx');
  assert.match(dialog, /LOW_STOCK_GRANTS\.map/, 'the dialog renders the low-stock grants');
  assert.match(dialog, /lowstock_grants/, 'the dialog keeps the low-stock grants as their own form state');
  assert.match(dialog, /isLowStockGrant/, 'the dialog splits the low-stock grants out of the stored array');
  assert.match(dialog, /\{!entitlementLoading && !isEssentials && \(/, 'the block never renders on Essentials');
  assert.match(dialog, /t\('staffLib\.area\.lowStockAccess'\)/);
  assert.match(dialog, /t\('staff\.memberDialog\.lowStockAccessHint'\)/);
});

test('the doors follow the tick: nav grant, Layout filter, PlanRedirect perm, App routes', () => {
  const nav = read('src/components/layout/navGroups.js');
  assert.match(nav, /\{ to: '\/low-stock', label: 'Low stock', labelKey: 'nav\.lowStock', icon: TriangleAlert, perm: 'reports\.view', feature: 'alerts', grant: 'alerts\.view' \}/);
  assert.match(nav, /\{ to: '\/alerts', label: 'Alerts', labelKey: 'nav\.alerts', icon: BellRing, perm: 'reports\.view', feature: 'alerts', grant: 'alerts\.view' \}/);
  const layout = read('src/components/Layout.jsx');
  assert.match(layout, /\(!item\.grant \|\| can\(item\.grant\)\)/, 'Layout hides a granted door from an unticked member');
  const redirect = read('src/components/plan/PlanRedirect.jsx');
  assert.match(redirect, /function PlanRedirect\(\{ feature, perm, children \}\)/, 'PlanRedirect takes the optional per-person layer');
  assert.match(redirect, /if \(perm && !canStaff\(perm\)\) return <Navigate to="\/" replace \/>;/, 'an unticked member bounces quietly, like the wrong plan');
  const app = read('src/App.jsx');
  assert.match(app, /<PlanRedirect feature="alerts" perm="alerts\.view">\s*<Alerts \/>/);
  assert.match(app, /<PlanRedirect feature="alerts" perm="alerts\.view">\s*<LowStock \/>/);
});

test('the refusal wordings exist on the server and map to locale keys', () => {
  const entities = read('server/entities.js');
  assert.match(entities, new RegExp(REORDER_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(entities, new RegExp(ALERTS_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const apiErrors = read('src/lib/apiErrors.js');
  assert.match(apiErrors, /"apiErrors\.reorderChangeReserved"/);
  assert.match(apiErrors, /"apiErrors\.alertsViewReserved"/);
});

test('Business: an unticked manager cannot set or change a reorder point; the owner can', async () => {
  const owner = await ownerWithBusiness('tick-owner@example.com', 'Test Shop', { plan: 'business' });
  const manager = await actor(owner, {
    email: 'tick-mgr@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });

  // Born with a non-default point counts as setting it.
  const bornSet = await createProduct(manager.cookie, owner.business.id, { reorder_point: 5 });
  assert.equal(bornSet.status, 403, bornSet.text);
  assert.match(bornSet.text, /reorder_change_not_granted/);
  assert.match(bornSet.text, /can change a reorder point/);

  // Born at the default is ordinary create work.
  const bornDefault = await createProduct(manager.cookie, owner.business.id, {});
  assert.equal(bornDefault.status, 201, bornDefault.text);
  const product = bornDefault.json;
  const productId = product.id;

  // A save that leaves the point alone proceeds under the edit right.
  const renamed = await req(`/api/entities/Product/${productId}`, {
    method: 'PATCH',
    cookie: manager['cookie'],
    body: { name: 'Renamed by the manager' },
  });
  assert.equal(renamed.status, 200, renamed.text);

  // Changing the point is refused, facts only.
  const change = await req(`/api/entities/Product/${productId}`, {
    method: 'PATCH',
    cookie: manager['cookie'],
    body: { reorder_point: 7 },
  });
  assert.equal(change.status, 403, change.text);
  assert.match(change.text, /reorder_change_not_granted/);

  // Writing the SAME point back is not a change.
  const same = await req(`/api/entities/Product/${productId}`, {
    method: 'PATCH',
    cookie: manager['cookie'],
    body: { reorder_point: 0 },
  });
  assert.equal(same.status, 200, same.text);

  // The owner sets and changes freely.
  const ownerBorn = await createProduct(owner.cookie, owner.business.id, { reorder_point: 4 });
  assert.equal(ownerBorn.status, 201, ownerBorn.text);
  const ownerProduct = ownerBorn.json;
  const ownerChange = await req(`/api/entities/Product/${ownerProduct.id}`, {
    method: 'PATCH',
    cookie: owner['cookie'],
    body: { reorder_point: 9 },
  });
  assert.equal(ownerChange.status, 200, ownerChange.text);
});

test('Business: the reorder tick hands the save over; unticking takes it back', async () => {
  const owner = await ownerWithBusiness('tick-owner2@example.com', 'Test Shop', { plan: 'business' });
  const manager = await actor(owner, {
    email: 'tick-mgr2@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  const born = await createProduct(manager.cookie, owner.business.id, {});
  const product = born.json;

  await setGrant(owner.business.id, manager.memberId, 'products.reorder', true);
  const change = await req(`/api/entities/Product/${product.id}`, {
    method: 'PATCH',
    cookie: manager['cookie'],
    body: { reorder_point: 6 },
  });
  assert.equal(change.status, 200, change.text);
  const bornSet = await createProduct(manager.cookie, owner.business.id, { reorder_point: 3 });
  assert.equal(bornSet.status, 201, bornSet.text);

  await setGrant(owner.business.id, manager.memberId, 'products.reorder', false);
  const refused = await req(`/api/entities/Product/${product.id}`, {
    method: 'PATCH',
    cookie: manager['cookie'],
    body: { reorder_point: 8 },
  });
  assert.equal(refused.status, 403, refused.text);
});

test('Business: the alerts endpoints answer only the owner or a ticked member', async () => {
  const owner = await ownerWithBusiness('tick-owner3@example.com', 'Test Shop', { plan: 'business' });
  const clerk = await actor(owner, {
    email: 'tick-clerk@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });
  const bid = owner.business.id;

  const ownerRead = await req(`/api/businesses/${bid}/alerts`, { cookie: owner['cookie'] });
  assert.equal(ownerRead.status, 200, ownerRead.text);

  const unticked = await req(`/api/businesses/${bid}/alerts`, { cookie: clerk['cookie'] });
  assert.equal(unticked.status, 403, unticked.text);
  assert.match(unticked.text, /alerts_view_not_granted/);
  assert.match(unticked.text, /can see low-stock alerts/);

  const untickedEval = await req(`/api/businesses/${bid}/alerts/evaluate`, {
    method: 'POST',
    cookie: clerk['cookie'],
    body: {},
  });
  assert.equal(untickedEval.status, 403, untickedEval.text);

  await setGrant(bid, clerk.memberId, 'alerts.view', true);
  const ticked = await req(`/api/businesses/${bid}/alerts`, { cookie: clerk['cookie'] });
  assert.equal(ticked.status, 200, ticked.text);
});

test('Essentials: the reorder gate does not exist — stored points ride through for everyone', async () => {
  const owner = await ownerWithBusiness('tick-owner4@example.com', 'Test Shop', { plan: 'essentials' });
  const manager = await actor(owner, {
    email: 'tick-ess-mgr@example.com',
    roleId: 'preset-manager',
    roleName: 'Manager',
  });
  // 327's law: values are saved on Essentials, simply unseen —
  // the tick gate must not refuse an Essentials save.
  const born = await createProduct(manager.cookie, owner.business.id, { reorder_point: 10 });
  assert.equal(born.status, 201, born.text);
  const product = born.json;
  assert.equal(Number(product.reorder_point), 10);
  const change = await req(`/api/entities/Product/${product.id}`, {
    method: 'PATCH',
    cookie: manager['cookie'],
    body: { reorder_point: 12 },
  });
  assert.equal(change.status, 200, change.text);
});
