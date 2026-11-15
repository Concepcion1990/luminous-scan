/**
 * T6 — Boss authority (owner's doctrine, Nov 14, 2026): "From now
 * on, admin is actually owner. Everywhere on the app."
 *
 * The legacy 'admin' badge and the business owner are ONE authority.
 * src/lib/bossAuthority.js is the single definition; every boss-gate
 * that used to check `user?.role === 'admin'` — a word no part of
 * the twin ever assigns (the server's publicUser carries no role),
 * which left every one of those doors dead for real owners — now
 * checks isBoss. The billing danger zone (a grandfathered Business
 * row) keeps its exact behavior: it counts for that business's boss
 * and for nobody else, so complimentary Business can never leak to
 * ordinary users, and the publisher — who owns her grandfathered
 * business — keeps her access whole.
 *
 * The workforce layer's own `app_role === 'admin'` (a staff member's
 * designation) is a different animal and is deliberately NOT part of
 * this definition; the last pins prove the sweep left it alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBoss } from '../../src/lib/bossAuthority.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const OWNER = { id: 'user-owner', email: 'owner@example.com' };
const STAFF = { id: 'user-staff', email: 'staff@example.com' };
const BADGE = { id: 'user-legacy', email: 'legacy@example.com', role: 'admin' };
const BUSINESS = { id: 'biz-1', owner_id: 'user-owner', created_by_id: 'user-owner' };

test('boss: the legacy badge passes on its own (half a)', () => {
  assert.equal(isBoss(BADGE, BUSINESS), true);
  assert.equal(isBoss(BADGE, null), true, 'the badge never needed a business record');
  assert.equal(isBoss(BADGE, { id: 'biz-2', owner_id: 'someone-else', created_by_id: 'someone-else' }), true);
});

test('boss: the owner passes by owner_id and by created_by_id (half b)', () => {
  assert.equal(isBoss(OWNER, BUSINESS), true);
  assert.equal(isBoss(OWNER, { id: 'biz-1', owner_id: 'user-owner', created_by_id: 'a-previous-keeper' }), true);
  assert.equal(isBoss(OWNER, { id: 'biz-1', owner_id: 'a-previous-keeper', created_by_id: 'user-owner' }), true);
});

test('boss: staff and strangers never pass — the definition never widens', () => {
  assert.equal(isBoss(STAFF, BUSINESS), false);
  assert.equal(isBoss({ id: 'user-manager', email: 'mgr@example.com' }, BUSINESS), false);
  assert.equal(isBoss({ email: 'noid@example.com' }, BUSINESS), false, 'no id, no boss');
  assert.equal(isBoss(null, BUSINESS), false);
  assert.equal(isBoss(undefined, BUSINESS), false);
  assert.equal(isBoss(OWNER, null), false, 'the owner half needs the business in scope');
  assert.equal(isBoss(OWNER, { id: 'biz-2', owner_id: 'user-staff', created_by_id: 'user-staff' }), false,
    'owning a DIFFERENT business does not make you this one\'s boss');
});

test('boss: the publisher email alone is not the boss check (her door is ownership)', () => {
  const publisherLoginElsewhere = { id: 'user-publisher', email: 'cperezcarrillo.1990@gmail.com' };
  assert.equal(isBoss(publisherLoginElsewhere, BUSINESS), false,
    'isBoss does no email matching — the grandfathered business is hers by owner_id');
  assert.equal(isBoss(publisherLoginElsewhere, { id: '6aeaec9b141cfe26e5a411be', owner_id: 'user-publisher', created_by_id: 'user-publisher' }), true);
});

test('gates: every former badge check now goes through the shared definition', () => {
  const products = read('src/pages/Products.jsx');
  assert.ok(products.includes("onDelete={isBoss(user, record) ? requestRemove : undefined}"),
    'Products Delete is offered to the boss');
  const categories = read('src/pages/Categories.jsx');
  assert.equal(categories.split('isBoss(user, record) && (').length - 1, 2,
    'both Categories delete buttons (category + tag) are boss-gated');
  const staff = read('src/pages/Staff.jsx');
  assert.ok(staff.includes('const isAdmin = isBoss(user, record);'), 'Staff isAdmin is the boss check');
  const access = read('src/hooks/useStaffAccess.js');
  assert.ok(access.includes('const isAdmin = isBoss(user, record);'), 'useStaffAccess boss is the shared check');
  const notFound = read('src/lib/PageNotFound.jsx');
  assert.ok(notFound.includes('isBoss(authData.user, businessRecord)'), 'the 404 Admin Note is boss-gated');
});

test('gates: no page still checks the dead badge directly', () => {
  for (const path of [
    'src/pages/Products.jsx',
    'src/pages/Categories.jsx',
    'src/pages/Staff.jsx',
    'src/hooks/useStaffAccess.js',
    'src/lib/PageNotFound.jsx',
    'src/components/plan/SubscriptionAccessRoute.jsx',
    'src/lib/entitlements.js',
  ]) {
    assert.ok(!read(path).includes("role === 'admin'"), `${path} must not check the badge itself`);
    assert.ok(!read(path).includes("role !== 'admin'"), `${path} must not check the badge itself`);
  }
});

test('danger zone: the grandfathered row counts only for its own boss', () => {
  const entitlements = read('src/lib/entitlements.js');
  assert.ok(entitlements.includes('export function effectivePlanKey(record, user, businessRecord = null)'),
    'effectivePlanKey takes the business record');
  assert.ok(entitlements.includes('!isBoss(user, businessRecord)) return DEFAULT_PLAN;'),
    'a grandfathered Business row falls to the default for anyone but the boss');
  assert.ok(entitlements.includes('resolveEntitlement(record, user = null, businessRecord = null)'),
    'resolveEntitlement threads the record through');
  const route = read('src/components/plan/SubscriptionAccessRoute.jsx');
  assert.ok(route.includes("(status === 'grandfathered' && isBoss(user, businessRecord) && planKey === 'business')"),
    'the workspace door opens for the grandfathered boss exactly as the badge wording intended');
  const hook = read('src/hooks/useEntitlements.js');
  assert.ok(hook.includes('resolveEntitlement(query.data, user, businessRecord)'),
    'useEntitlements resolves with the active business record');
});

test('workforce vocabulary untouched: app_role admin is not the account badge', () => {
  const card = read('src/components/staff/StaffMemberCard.jsx');
  assert.ok(card.includes("member.app_role === 'admin'"), 'the Administrator pill still keys off the member record');
  const dialog = read('src/components/staff/StaffMemberDialog.jsx');
  assert.ok(dialog.includes("form.app_role === 'admin'"), 'the dialog hint still keys off the member form');
});
