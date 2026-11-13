/**
 * T17 — Rewards & incentives (Rewards phase).
 *
 * The owner's design (Nov 9, 2026): the manager — or the owner,
 * who oversees the manager — gives rewards to team members for
 * doing a good job: a percent off in store, a gift card to
 * anywhere, or any incentive the giver describes. BUSINESS PLAN
 * ONLY (her correction: "business, not business plus").
 *
 * Covered: owner→manager and owner→staff issuance; manager→staff
 * issuance; manager→manager and manager→self refused; staff giving
 * refused; Essentials plan gate on read AND write; code uniqueness
 * across many issues in one business; redeem happy path +
 * double-redeem refused + voided-cannot-redeem; void hierarchy;
 * recipient bell; scoping; grace read-only; plans copy; and the
 * white-label reward slip (business name only, zero app branding).
 * Real Express app over HTTP against pg-mem, same as every phase.
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
import { buildRewardSlipText } from '../../src/lib/rewards.js';
import { PLANS, COMPARISON_ROWS } from '../../src/lib/plans.js';

after(close);
beforeEach(() => resetRateLimits());

const RW = (bid) => `/api/businesses/${bid}/workforce/rewards`;
const WF = (bid) => `/api/businesses/${bid}/workforce`;
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

// ---- Fixtures -------------------------------------------------------------

/** Insert a trusted active staff row (created by the owner), then register its user. */
async function addTeamMember(business, ownerId, email, { manager = false, name } = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, '[]', 'active', $7)`,
    [
      id,
      business.id,
      name || (manager ? 'Manny Manager' : 'Sam Staff'),
      email,
      manager ? 'preset-manager' : 'preset-sales',
      manager ? 'Manager' : 'Sales clerk',
      ownerId,
    ],
  );
  const account = await registerVerifiedUser(email);
  return { staffId: id, email, cookie: account.cookie, user: account.user };
}

/** Owner + business on the Business plan, with a manager and a staff member. */
async function businessSetup(emailPrefix) {
  const setup = await ownerWithBusiness(`${emailPrefix}@example.com`, 'Reward Shop');
  await setPlan(setup.business.id, 'business', setup.user.id);
  const manager = await addTeamMember(setup.business, setup.user.id, `${emailPrefix}-mgr@example.com`, { manager: true });
  const staff = await addTeamMember(setup.business, setup.user.id, `${emailPrefix}-staff@example.com`);
  return { ...setup, manager, staff };
}

async function give(cookie, bid, body) {
  return req(RW(bid), { method: 'POST', body, cookie });
}

// ---- Issuance: owner gives to anyone ---------------------------------------

test('owner gives to a manager (gift card) and to staff (percent off); the recipient bell rings', async () => {
  const { cookie: ownerCookie, business, manager, staff } = await businessSetup('rw-owner');

  const toManager = await give(ownerCookie, business.id, {
    recipient_staff_id: manager.staffId,
    kind: 'gift_card',
    title: 'Thank you for covering the weekend',
    amount: 25,
    currency: 'USD',
  });
  assert.equal(toManager.status, 201);
  assert.equal(toManager.json.reward.kind, 'gift_card');
  assert.equal(toManager.json.reward.amount, 25);
  assert.equal(toManager.json.reward.currency, 'USD');
  assert.equal(toManager.json.reward.giver_role, 'owner');
  assert.equal(toManager.json.reward.status, 'active');
  assert.match(toManager.json.reward.code, CODE_RE);

  const toStaff = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId,
    kind: 'percent_off',
    title: 'Great week',
    percent_value: 10,
  });
  assert.equal(toStaff.status, 201);
  assert.equal(toStaff.json.reward.percent_value, 10);

  const custom = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId,
    kind: 'custom',
    title: 'Your pick',
    detail: 'A free coffee from the place next door, on us',
  });
  assert.equal(custom.status, 201);
  assert.equal(custom.json.reward.detail, 'A free coffee from the place next door, on us');

  // The recipients' bells rang with the reward event.
  const managerInbox = await req(`${WF(business.id)}/notifications`, { cookie: manager.cookie });
  assert.ok(
    managerInbox.json.notifications.some(
      (n) => n.event === 'reward_received' && n.entry_id === toManager.json.reward.id,
    ),
    'manager bell carries the reward',
  );
  const staffInbox = await req(`${WF(business.id)}/notifications`, { cookie: staff.cookie });
  assert.ok(
    staffInbox.json.notifications.some((n) => n.event === 'reward_received' && /Great week/.test(n.detail)),
    'staff bell names the reward',
  );
});

test('issuance validation: bad kind, bad percent, missing custom detail, unknown recipient', async () => {
  const { cookie: ownerCookie, business, staff } = await businessSetup('rw-valid');

  const badKind = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'cash', title: 'Nope',
  });
  assert.equal(badKind.status, 400);

  const badPercent = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'percent_off', title: 'Nope', percent_value: 150,
  });
  assert.equal(badPercent.status, 400);

  const noDetail = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'custom', title: 'Mystery',
  });
  assert.equal(noDetail.status, 400);

  const ghost = await give(ownerCookie, business.id, {
    recipient_staff_id: crypto.randomUUID(), kind: 'percent_off', title: 'Ghost', percent_value: 5,
  });
  assert.equal(ghost.status, 404);
});

// ---- Issuance: manager boundaries -------------------------------------------

test('manager gives to staff; manager→manager, manager→self and staff giving are refused', async () => {
  const { business, manager, staff } = await businessSetup('rw-mgr');
  const otherManagerSetup = await addTeamMember(business, (await pool.query(
    'SELECT owner_id FROM businesses WHERE id = $1', [business.id],
  )).rows[0].owner_id, 'rw-mgr-mgr2@example.com', { manager: true, name: 'Second Manager' });

  const toStaff = await give(manager.cookie, business.id, {
    recipient_staff_id: staff.staffId,
    kind: 'percent_off',
    title: 'Handled the rush beautifully',
    percent_value: 15,
  });
  assert.equal(toStaff.status, 201);
  assert.equal(toStaff.json.reward.giver_role, 'manager');

  const toManager = await give(manager.cookie, business.id, {
    recipient_staff_id: otherManagerSetup.staffId,
    kind: 'percent_off',
    title: 'For you',
    percent_value: 10,
  });
  assert.equal(toManager.status, 403, 'a manager cannot reward another manager');

  const toSelf = await give(manager.cookie, business.id, {
    recipient_staff_id: manager.staffId,
    kind: 'gift_card',
    title: 'For me',
    amount: 10,
  });
  assert.equal(toSelf.status, 403, 'a manager cannot reward themselves');

  const byStaff = await give(staff.cookie, business.id, {
    recipient_staff_id: staff.staffId,
    kind: 'percent_off',
    title: 'Self serve',
    percent_value: 50,
  });
  assert.equal(byStaff.status, 403, 'staff never give rewards');
});

// ---- Plan gate -----------------------------------------------------------------

test('Essentials: read, write and redeem all refuse with plan_gated', async () => {
  const setup = await ownerWithBusiness('rw-ess@example.com', 'Essentials Shop');
  await setPlan(setup.business.id, 'essentials', setup.user.id);
  const staff = await addTeamMember(setup.business, setup.user.id, 'rw-ess-staff@example.com');

  const read = await req(RW(setup.business.id), { cookie: setup.cookie });
  assert.equal(read.status, 403);
  assert.equal(read.json.error, 'plan_gated');

  const write = await give(setup.cookie, setup.business.id, {
    recipient_staff_id: staff.staffId, kind: 'percent_off', title: 'Nope', percent_value: 10,
  });
  assert.equal(write.status, 403);
  assert.equal(write.json.error, 'plan_gated');

  const redeem = await req(`${RW(setup.business.id)}/redeem`, {
    method: 'POST', body: { code: 'ABCD-2345' }, cookie: setup.cookie,
  });
  assert.equal(redeem.status, 403);
  assert.equal(redeem.json.error, 'plan_gated');
});

// ---- Codes -----------------------------------------------------------------------

test('codes never collide across many issues in one business', async () => {
  const { cookie: ownerCookie, business, staff } = await businessSetup('rw-codes');
  const codes = new Set();
  for (let i = 0; i < 40; i += 1) {
    const res = await give(ownerCookie, business.id, {
      recipient_staff_id: staff.staffId,
      kind: 'percent_off',
      title: `Reward ${i}`,
      percent_value: 5,
    });
    assert.equal(res.status, 201);
    assert.match(res.json.reward.code, CODE_RE);
    codes.add(res.json.reward.code);
  }
  assert.equal(codes.size, 40);
  const { rows } = await pool.query(
    'SELECT COUNT(DISTINCT code)::int AS n FROM rewards WHERE business_id = $1',
    [business.id],
  );
  assert.equal(rows[0].n, 40);
});

// ---- Redeem ------------------------------------------------------------------------

test('redeem by code: happy path, double-redeem refused, voided cannot redeem, unknown code 404', async () => {
  const { cookie: ownerCookie, business, manager, staff } = await businessSetup('rw-redeem');

  const issued = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'percent_off', title: 'Ten off', percent_value: 10,
  });
  const code = issued.json.reward.code;

  // Staff cannot redeem; the manager at the till can — even typed loosely.
  const byStaff = await req(`${RW(business.id)}/redeem`, {
    method: 'POST', body: { code }, cookie: staff.cookie,
  });
  assert.equal(byStaff.status, 403);

  const redeemed = await req(`${RW(business.id)}/redeem`, {
    method: 'POST', body: { code: code.toLowerCase().replace('-', ' ') }, cookie: manager.cookie,
  });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.json.reward.status, 'redeemed');
  assert.ok(redeemed.json.reward.redeemed_at);
  assert.equal(redeemed.json.reward.redeemed_by_role, 'manager');

  const again = await req(`${RW(business.id)}/redeem`, {
    method: 'POST', body: { code }, cookie: ownerCookie,
  });
  assert.equal(again.status, 400);
  assert.equal(again.json.error, 'already_redeemed');

  const second = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'gift_card', title: 'Card', amount: 10,
  });
  const voided = await req(`${RW(business.id)}/${second.json.reward.id}/void`, {
    method: 'POST', body: {}, cookie: ownerCookie,
  });
  assert.equal(voided.status, 200);
  const redeemVoided = await req(`${RW(business.id)}/redeem`, {
    method: 'POST', body: { code: second.json.reward.code }, cookie: ownerCookie,
  });
  assert.equal(redeemVoided.status, 400);
  assert.equal(redeemVoided.json.error, 'reward_void');

  const unknown = await req(`${RW(business.id)}/redeem`, {
    method: 'POST', body: { code: 'ZZZZ-9999' }, cookie: ownerCookie,
  });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.json.error, 'code_not_found');
});

// ---- Void hierarchy -------------------------------------------------------------------

test('void hierarchy: owner voids a manager\u2019s gift; a manager cannot void the owner\u2019s; a manager voids their own', async () => {
  const { cookie: ownerCookie, business, manager, staff } = await businessSetup('rw-void');

  const managersGift = await give(manager.cookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'percent_off', title: 'From the manager', percent_value: 10,
  });
  const ownerVoids = await req(`${RW(business.id)}/${managersGift.json.reward.id}/void`, {
    method: 'POST', body: {}, cookie: ownerCookie,
  });
  assert.equal(ownerVoids.status, 200);
  assert.equal(ownerVoids.json.reward.status, 'void');
  assert.equal(ownerVoids.json.reward.voided_by_role, 'owner');

  const ownersGift = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'percent_off', title: 'From the owner', percent_value: 10,
  });
  const managerVoids = await req(`${RW(business.id)}/${ownersGift.json.reward.id}/void`, {
    method: 'POST', body: {}, cookie: manager.cookie,
  });
  assert.equal(managerVoids.status, 403, 'a manager cannot void the owner\u2019s gift');

  const ownGift = await give(manager.cookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'custom', title: 'Oops', detail: 'Wrong person — redoing',
  });
  const managerVoidsOwn = await req(`${RW(business.id)}/${ownGift.json.reward.id}/void`, {
    method: 'POST', body: {}, cookie: manager.cookie,
  });
  assert.equal(managerVoidsOwn.status, 200);

  const staffVoids = await req(`${RW(business.id)}/${ownersGift.json.reward.id}/void`, {
    method: 'POST', body: {}, cookie: staff.cookie,
  });
  assert.equal(staffVoids.status, 403);
});

// ---- Scoping ----------------------------------------------------------------------------

test('scoping: owner sees all; a manager sees gave + received only; staff see only their own', async () => {
  const { cookie: ownerCookie, business, manager, staff } = await businessSetup('rw-scope');
  const secondStaff = await addTeamMember(business, (await pool.query(
    'SELECT owner_id FROM businesses WHERE id = $1', [business.id],
  )).rows[0].owner_id, 'rw-scope-staff2@example.com', { name: 'Second Staff' });

  await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'percent_off', title: 'Owner to staff', percent_value: 10,
  });
  await give(ownerCookie, business.id, {
    recipient_staff_id: manager.staffId, kind: 'gift_card', title: 'Owner to manager', amount: 20,
  });
  await give(manager.cookie, business.id, {
    recipient_staff_id: secondStaff.staffId, kind: 'percent_off', title: 'Manager to staff2', percent_value: 5,
  });

  const ownerList = await req(RW(business.id), { cookie: ownerCookie });
  assert.equal(ownerList.status, 200);
  assert.equal(ownerList.json.rewards.length, 3, 'the owner oversees every reward');

  const managerList = await req(RW(business.id), { cookie: manager.cookie });
  const managerTitles = managerList.json.rewards.map((r) => r.title).sort();
  assert.deepEqual(managerTitles, ['Manager to staff2', 'Owner to manager'],
    'a manager sees what they gave + what they received — not the owner\u2019s gift to staff');

  const staffList = await req(RW(business.id), { cookie: staff.cookie });
  assert.equal(staffList.json.rewards.length, 1);
  assert.equal(staffList.json.rewards[0].title, 'Owner to staff');

  const staff2List = await req(RW(business.id), { cookie: secondStaff.cookie });
  assert.equal(staff2List.json.rewards.length, 1);
  assert.equal(staff2List.json.rewards[0].title, 'Manager to staff2');
});

// ---- Grace ---------------------------------------------------------------------------------

test('grace-period business: rewards refuse like every module — grace is products-only', async () => {
  const { cookie: ownerCookie, business, staff } = await businessSetup('rw-grace');
  const issued = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'percent_off', title: 'Before grace', percent_value: 10,
  });
  assert.equal(issued.status, 201);

  await pool.query(
    `UPDATE entitlements SET status = 'canceled', period_ends_at = NOW() - INTERVAL '1 day'
     WHERE business_id = $1`,
    [business.id],
  );

  // Access gate (2026-11-13): the grace view is the products-only
  // migration view — no other module stays readable, rewards included.
  const read = await req(RW(business.id), { cookie: ownerCookie });
  assert.equal(read.status, 403);
  assert.equal(read.json.error, 'grace_read_only');
  const write = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'percent_off', title: 'During grace', percent_value: 10,
  });
  assert.equal(write.status, 403);
  assert.equal(write.json.error, 'grace_read_only');
});

// ---- Plans copy + slip ------------------------------------------------------------------------

test('plans copy: Business presents staff rewards; Essentials and Mobile do not', () => {
  assert.ok(PLANS.business.includes.some((line) => /rewards/i.test(line)), 'Business includes list names rewards');
  assert.ok(!PLANS.essentials.includes.some((line) => /rewards/i.test(line)), 'Essentials stays truthful');
  const row = COMPARISON_ROWS.find((r) => /rewards/i.test(r.label));
  assert.ok(row, 'a comparison row names rewards');
  assert.equal(row.business, true);
  assert.equal(row.essentials, false);
  assert.equal(row.mobile, false);
});

test('reward slip: carries only the business name — zero app branding', async () => {
  const { cookie: ownerCookie, business, staff } = await businessSetup('rw-slip');
  const issued = await give(ownerCookie, business.id, {
    recipient_staff_id: staff.staffId, kind: 'percent_off', title: 'Great week', percent_value: 10,
  });
  const reward = issued.json.reward;
  const slip = buildRewardSlipText('Reward Shop', reward, {
    valueLine: '10% off in store',
  });
  assert.ok(slip.includes('Reward Shop'), 'the business name is on the slip');
  assert.ok(slip.includes('Great week'));
  assert.ok(slip.includes(reward.code), 'the code is on the slip');
  assert.ok(slip.includes('Sam Staff'), 'the recipient is on the slip');
  assert.doesNotMatch(slip, /stockhaven|luminous/i, 'no app branding anywhere on the slip');
});
