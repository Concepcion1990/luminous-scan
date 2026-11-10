import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPARISON_ROWS,
  PLANS,
  WELCOME_OPTIONS,
  businessLimitForPlan,
  displayLimit,
  limitFor,
} from './plans.js';

/**
 * Plan limits must always show the plan the customer actually has.
 *
 * LIVE FINDING (2026-11-07): on a fresh Business login, Settings briefly
 * showed "Your businesses — 1 OF 1" with "Essentials allows one business.
 * Business allows up to five businesses per owner." and a disabled Add
 * business button, and the Staff page briefly capped seats at 3. The stored
 * entitlement was Business all along (verified in Base44 and Stripe); only the
 * display was wrong. Root cause: every limit surface derived its numbers
 * from the entitlement row, and while that row was still loading the missing
 * row resolved to restricted Essentials — so a Business account displayed
 * Essentials caps until its own plan arrived.
 *
 * These tests pin the fix: a limit that has not loaded yet is unknown
 * (`null`) — never another plan's cap. The server still enforces the real
 * limit on every write, so a brief unknown window can never grant anything
 * extra. The "5" on the Staff page is the count of built-in roles, never a
 * staff limit.
 */

test('displayLimit: a limit that has not loaded yet is unknown, never a cap', () => {
  assert.equal(displayLimit(3, true), null);
  assert.equal(displayLimit(50, true), null);
  assert.equal(displayLimit(1, true), null);
  // Even an unlimited plan reads as unknown while loading, not as unlimited.
  assert.equal(displayLimit(null, true), null);
});

test('displayLimit: once loaded, the limit is the plan\u2019s own value', () => {
  assert.equal(displayLimit(3, false), 3);
  assert.equal(displayLimit(50, false), 50);
  assert.equal(displayLimit(1, false), 1);
  assert.equal(displayLimit(null, false), null);
});

test('businessLimitForPlan: unknown until the plan rows have loaded', () => {
  assert.equal(businessLimitForPlan('business', false), null);
  assert.equal(businessLimitForPlan('essentials', false), null);
  assert.equal(businessLimitForPlan(null, false), null);
});

test('businessLimitForPlan: Essentials allows one business, Business five', () => {
  assert.equal(businessLimitForPlan('essentials', true), 1);
  assert.equal(businessLimitForPlan('business', true), 5);
});

test('the plan tables themselves still carry the agreed allowances', () => {
  assert.deepEqual(PLANS.essentials.limits, { businesses: 1, sites: 1, products: 50, staff: 3, customRoles: false });
  assert.deepEqual(PLANS.business.limits, { businesses: 5, sites: 5, products: null, staff: null, customRoles: true });
  assert.equal(limitFor('essentials', 'staff'), 3);
  assert.equal(limitFor('business', 'staff'), null);
  assert.equal(limitFor('essentials', 'products'), 50);
  assert.equal(limitFor('business', 'products'), null);
  assert.equal(limitFor('essentials', 'businesses'), 1);
  assert.equal(limitFor('business', 'businesses'), 5);
  assert.equal(limitFor('essentials', 'sites'), 1);
  assert.equal(limitFor('business', 'sites'), 5);
});

test('useBusiness derives the allowance from the loaded plan rows, never before', () => {
  const hook = readFileSync('src/hooks/useBusiness.js', 'utf8');
  // The allowance comes from the pure helper, fed by the oldest plan row.
  assert.match(hook, /businessLimitForPlan\(/);
  assert.match(hook, /effectivePlanKey\(oldestPlan, user\)/);
  // Known only once the plan-row query has settled (or there are no
  // businesses to read rows for); a failed read is unknown too.
  assert.match(hook, /plansKnown = ids\.length === 0 \|\| plansQuery\.isFetched/);
  assert.match(hook, /plansFailed = plansQuery\.isError/);
  assert.match(hook, /plansKnown && !plansFailed/);
  // Unknown allowance means "cannot create yet", never "Essentials says no".
  assert.match(hook, /canCreate: limit != null && businesses\.length < limit/);
  // The hook exposes the loading/error state so screens can wait for it.
  assert.match(hook, /plansLoading: !plansKnown/);
  assert.match(hook, /plansError: plansFailed/);
  assert.match(hook, /refetchPlans: plansQuery\.refetch/);
  // No direct Essentials fallback for the allowance remains in this hook.
  assert.doesNotMatch(hook, /=== 'essentials' \? 1 : MAX_BUSINESSES/);
});

test('BusinessListCard waits for the plan instead of printing Essentials defaults', () => {
  const card = readFileSync('src/components/business/BusinessListCard.jsx', 'utf8');
  assert.match(card, /plansLoading/);
  assert.match(card, /plansError/);
  assert.match(card, /Loading your plan/);
  assert.match(card, /Plan unavailable/);
  assert.match(card, /Try again/);
  assert.match(card, /refetchPlans/);
  // The "N of Y" badge only prints the count once the plan has loaded.
  assert.match(card, /plansLoading\s*\n?\s*\? 'Loading your plan…'/);
  assert.match(card, /: `\$\{businesses\.length\} of \$\{limit\}`/);
  // The Essentials sentence only appears once a real limit is known.
  assert.match(card, /limit != null && !canCreate/);
  // Add business stays disabled until the allowance is known.
  assert.match(card, /disabled=\{!canCreate \|\| isLoading \|\| creating \|\| plansLoading \|\| plansError\}/);
});

test('BusinessSwitcher never prints an unknown business allowance as a number', () => {
  const switcher = readFileSync('src/components/business/BusinessSwitcher.jsx', 'utf8');
  assert.match(switcher, /\{businesses\.length\}\/\{limit \?\? '…'\}/);
  assert.match(switcher, /Your business allowance is still loading/);
  // Singular when the allowance is one: "1 business", never "1 businesses".
  assert.match(switcher, /You can own up to \$\{limit\} business\$\{limit === 1 \? '' : 'es'\} on this login/);
  assert.doesNotMatch(switcher, /\$\{limit\} businesses/);
});

test('Staff gates its seat cap on the loaded entitlement', () => {
  const staff = readFileSync('src/pages/Staff.jsx', 'utf8');
  assert.match(staff, /const \{ limits, isLoading: entitlementLoading, isEssentials \} = useEntitlements\(\);/);
  assert.match(staff, /const staffLimit = displayLimit\(limits\.staff, entitlementLoading\);/);
  // The cap still blocks adding once it is known (server enforces too).
  assert.match(staff, /const seatsFull = staffLimit != null && seatsUsed >= staffLimit;/);
});

test('Staff states the allowance in plain words, so the Roles count is never read as a limit', () => {
  const staff = readFileSync('src/pages/Staff.jsx', 'utf8');
  assert.match(staff, /Unlimited staff on the Business plan\./);
  assert.match(staff, /This plan includes \$\{staffLimit\} additional staff\./);
  // The "5" on the page is the count of built-in roles, labelled as Roles.
  assert.match(staff, /PRESET_ROLES\.length \+ roles\.length/);
  assert.match(staff, />Roles</);
  assert.doesNotMatch(staff, /5 additional staff|5 staff members|up to 5 staff/i);
});

test('Products and Locations gate their caps on the loaded entitlement', () => {
  const products = readFileSync('src/pages/Products.jsx', 'utf8');
  assert.match(products, /const \{ limits, isLoading: entitlementLoading \} = useEntitlements\(\);/);
  assert.match(products, /const productLimit = displayLimit\(limits\.products, entitlementLoading\);/);
  assert.match(products, /const atProductLimit = productLimit != null && activeCount >= productLimit;/);

  const locations = readFileSync('src/pages/Locations.jsx', 'utf8');
  assert.match(locations, /const \{ limits, isLoading: entitlementLoading \} = useEntitlements\(\);/);
  assert.match(locations, /const siteLimit = displayLimit\(limits\.sites, entitlementLoading\);/);
  assert.match(locations, /const atSiteLimit = siteLimit != null && siteCount >= siteLimit;/);
});

test('PlanSummaryCard does not print the Essentials name while the plan loads', () => {
  const card = readFileSync('src/components/plans/PlanSummaryCard.jsx', 'utf8');
  assert.match(card, /const \{ plan, record, isEssentials, isLoading \} = useEntitlements\(\);/);
  assert.match(card, /if \(isLoading\) \{/);
  assert.match(card, /Loading your plan…/);
});

test('LimitBadge renders nothing for an unknown limit', () => {
  const badge = readFileSync('src/components/plan/LimitBadge.jsx', 'utf8');
  assert.match(badge, /if \(limit == null\) return null;/);
});

/**
 * AUDIT FINDING 15: "3 staff" vs "3 additional staff". The code proves
 * the definition — the cap counts StaffMember records with status active
 * or invited, and the owner has no StaffMember record of their own, so
 * the 3 seats sit ON TOP of the owner. "Additional" is the true word
 * everywhere the allowance is stated; the one place that said "three
 * staff" (the Essentials blurb) is fixed to match. The server says the
 * same thing in staffLimitMessage ("This plan includes ${limit}
 * additional staff").
 */
test('the Essentials staff cap is 3 additional staff — the owner holds no seat', () => {
  const limits = readFileSync('base44/shared/planLimits.ts', 'utf8');
  assert.match(limits, /\/\*\* A seat is held by an active member or a pending invitation, never by the owner\. \*\//);
  assert.match(limits, /export async function staffSeatCount\(base44, businessId\) \{/);
  assert.match(limits, /status: \{ \$in: \['active', 'invited'\] \},/);
  assert.match(limits, /export function staffLimitMessage\(limit\) \{/);
  assert.match(limits, /This plan includes \$\{limit\} additional staff\. Free a seat or move to Business for unlimited staff\./);
  const entitlements = readFileSync('src/lib/entitlements.js', 'utf8');
  assert.match(entitlements, /\/\*\* Staff seats: active members plus invitations, which reserve a seat\. \*\//);
  assert.match(entitlements, /status: \{ \$in: \['active', 'invited'\] \},/);
  const staff = readFileSync('src/pages/Staff.jsx', 'utf8');
  assert.match(staff, /never by the owner,\s*\n?\s*\/\/ who has no staff record of their own/);
  // The plan copy says "additional" everywhere it states the allowance.
  assert.equal(PLANS.essentials.blurb, 'One store, fifty products, three additional staff.');
  assert.ok(PLANS.essentials.includes.includes('Up to 3 additional staff'));
  const welcome = WELCOME_OPTIONS.find((option) => option.key === 'essentials');
  assert.ok(welcome.includes.includes('Three additional staff members'));
  assert.deepEqual(
    COMPARISON_ROWS.find((row) => row.label === 'Additional staff'),
    { label: 'Additional staff', mobile: 'Set at launch', essentials: 'Up to three', business: 'Unlimited' }
  );
  assert.match(staff, /This plan includes \$\{staffLimit\} additional staff\./);
  // No bare "three staff" remains in the plan copy.
  assert.doesNotMatch(readFileSync('src/lib/plans.js', 'utf8'), /three staff/i);
  // OPEN: Terms (§2, "three additional staff accounts") already agrees,
  // and the Plans page blurb ("three staff") lives in Plans.jsx, which
  // this PR does not touch — see the PR body.
});

/**
 * FINDING 36: passive low-stock counts are core, alerts are Business.
 * The comparison table now says so in one row, next to the alerts row.
 */
test('the plan comparison says low-stock counts are on every page', () => {
  const row = COMPARISON_ROWS.find((entry) => entry.label === 'Low-stock counts');
  assert.deepEqual(row, {
    label: 'Low-stock counts',
    mobile: 'Set at launch',
    essentials: 'On every page',
    business: 'On every page',
  });
  // Directly above the alerts row, which still says alerts are Business-only.
  const alerts = COMPARISON_ROWS.find((entry) => entry.label === 'Low-stock alerts');
  assert.deepEqual(alerts, { label: 'Low-stock alerts', mobile: false, essentials: false, business: true });
  assert.ok(COMPARISON_ROWS.indexOf(row) < COMPARISON_ROWS.indexOf(alerts));
});

/** AUDIT FINDING 5: the category header printed the money value of each
 * category — stock valuation, a Business-only feature — while the route
 * itself is ungated. Hide the money line on Essentials; keep the units
 * and low counts, which are passive counts (core, by design). The route
 * stays open: gating the whole page would take category browsing away
 * from Essentials. */
test('Inventory by category hides the money line on Essentials', () => {
  const page = readFileSync('src/pages/InventoryCategories.jsx', 'utf8');
  assert.match(page, /const showValue = !entitlementLoading && can\('valuation'\);/);
  assert.match(page, /\{showValue && \(/);
  assert.match(page, /formatMoney\(group\.value, profile\.currency, 2\)/);
  // The money line is the only thing gated: units and low counts stay.
  assert.equal((page.match(/formatMoney\(group\.value, profile\.currency, 2\)/g) || []).length, 1);
  assert.match(page, /\{group\.units\}/);
  assert.match(page, /\{group\.low \? ` · \$\{group\.low\} low` : ''\}/);
  assert.match(page, /with the units each one holds/);
  // The route is NOT PlanGate-locked: the page stays open on Essentials.
  const app = readFileSync('src/App.jsx', 'utf8');
  const categoriesRoute = app.split('\n').find((line) => line.includes('path="/inventory/categories"'));
  assert.doesNotMatch(categoriesRoute, /PlanGate/);
});

/**
 * AUDIT FINDING 6: openNew() and duplicate() both refused at the cap, but
 * openCopy() — from CopyGroupPanel's onAddCopy — opened the dialog with no
 * check, so an Essentials customer filled the whole form before the
 * server refused the 51st product. All three now share one guard and one
 * toast string (FINDING 36: the New and Duplicate wordings differed).
 */
test('Copy product shares the at-limit guard and the one at-limit message', () => {
  const products = readFileSync('src/pages/Products.jsx', 'utf8');
  assert.match(products, /const productLimitToast = \(\) => \{/);
  assert.match(products, /const openCopy = \(product\) => \{\s*\n?\s*if \(atProductLimit\) \{\s*\n?\s*productLimitToast\(\);\s*\n?\s*return;/);
  assert.match(products, /const openNew = \(\) => \{\s*\n?\s*if \(atProductLimit\) \{\s*\n?\s*productLimitToast\(\);\s*\n?\s*return;/);
  // The description string appears exactly once — the three callers share it.
  const description = 'Archive one you no longer sell to free a slot, or move to Business for unlimited products.';
  assert.equal(products.split(description).length - 1, 1);
  // The shorter Duplicate wording is gone.
  assert.doesNotMatch(products, /or move to Business\.'/);
  // The server's refusal at 51 is the same friendly wording, not a raw
  // function error: a 403 with code product_limit and productLimitMessage.
  const entry = readFileSync('base44/functions/create-products/entry.ts', 'utf8');
  assert.match(entry, /error: productLimitMessage\(limits\.products, used\),/);
  assert.match(entry, /code: 'product_limit',/);
  const limits = readFileSync('base44/shared/planLimits.ts', 'utf8');
  assert.match(limits, /export function productLimitMessage\(limit, used\) \{/);
  assert.match(
    limits,
    /`This plan includes \$\{limit\} active products and \$\{used\} are already in the catalog\. Archive a product you no longer sell to free a slot, or move to Business for unlimited products\.`/
  );
});

/** FINDING 36: the expanded product row showed a raw cost next to a
 * formatted price. */
test('the expanded product row formats cost as money', () => {
  const products = readFileSync('src/pages/Products.jsx', 'utf8');
  assert.match(products, /\{formatMoney\(product\.cost, profile\.currency, 2\)\} · price/);
  assert.doesNotMatch(products, /cost \{product\.cost \|\| 0\}/);
});

/**
 * AUDIT FINDING 10: while the entitlement row loads, a missing row
 * resolves to restricted Essentials, so a Business login briefly lost
 * Purchasing, Suppliers, Stock value, Reports, Alerts, Exports and
 * Bundles from the nav, then got them back. The nav now holds its
 * loading state until the plan is known — same unknown-null pattern as
 * PlanGate / Dashboard. The tab bar needs no hold: its five routes
 * carry no feature, only staff permissions.
 */
test('Layout holds the nav at its loading state until the plan is known', () => {
  const layout = readFileSync('src/components/Layout.jsx', 'utf8');
  assert.match(layout, /const \{ can: planAllows, isLoading: entitlementLoading \} = useEntitlements\(\);/);
  // Both nav surfaces hold: the laptop sidebar and the mobile All screens menu.
  assert.equal((layout.match(/aria-label="Loading screens"/g) || []).length, 2);
  assert.match(layout, /animate-pulse rounded-md bg-primary-foreground\/10/);
  // The filter itself is unchanged: staff permission AND plan feature.
  assert.match(layout, /\(!item\.perm \|\| can\(item\.perm\)\) && \(!item\.feature \|\| planAllows\(item\.feature\)\)/);
});

/**
 * AUDIT FINDING 23: the New business button sat silently disabled at
 * 1/1, the compact (mobile) layout showed no count at all, and the
 * dialog said "1 businesses".
 */
test('BusinessSwitcher explains a disabled New button and counts in compact too', () => {
  const switcher = readFileSync('src/components/business/BusinessSwitcher.jsx', 'utf8');
  // The hint only fires once the allowance is known and only for someone
  // who may create (a staff seat never sees the button).
  assert.match(switcher, /const atBusinessLimit = mayCreate && limit != null && !canCreate;/);
  assert.match(switcher, /\{atBusinessLimit && \(/);
  assert.match(switcher, /Business allows up to \{PLANS\.business\.limits\.businesses\} —/);
  assert.match(switcher, /<Link to="\/upgrade"/);
  // The count is no longer compact-gated.
  assert.doesNotMatch(switcher, /\{!compact && \(/);
  assert.match(switcher, /\{businesses\.length\}\/\{limit \?\? '…'\}/);
});

/** AUDIT FINDING 25: 3 active + 1 suspended showed "Staff 4" next to
 * "Staff 3 of 3" — looking like an over-limit error. The stat card and
 * the "N people" line now count seats in use (active + invited only),
 * consistent with the LimitBadge. */
test('Staff counts seats in use, not staff records', () => {
  const staff = readFileSync('src/pages/Staff.jsx', 'utf8');
  assert.match(staff, /\{seatsUsed\} people/);
  assert.doesNotMatch(staff, /\{members\.length\} people/);
  // The Staff stat card prints seatsUsed too — the record count appears
  // nowhere as a bare number on this page.
  assert.doesNotMatch(staff, /\{members\.length\}/);
  // The member grid still lists every record, suspended included.
  assert.match(staff, /\{members\.map\(\(member\) => \(/);
});

/**
 * AUDIT FINDING 33: a missing record defaulted to "Full access" on an
 * Essentials-priced card. resolveEntitlement defaults a missing status
 * to pending_checkout; the card now agrees, with a label for it.
 */
test('PlanSummaryCard defaults a missing record to pending_checkout, never Full access', () => {
  const card = readFileSync('src/components/plans/PlanSummaryCard.jsx', 'utf8');
  assert.match(card, /const status = record\?\.status \|\| 'pending_checkout';/);
  assert.doesNotMatch(card, /record\?\.status \|\| 'grandfathered'/);
  assert.match(card, /pending_checkout: 'Checkout pending',/);
  // The grandfathered label still exists for the real pre-launch records.
  assert.match(card, /grandfathered: 'Full access',/);
});
