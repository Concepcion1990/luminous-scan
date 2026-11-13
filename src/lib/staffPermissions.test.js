import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  ALL_PERMISSIONS,
  BUSINESS_ONLY_PERMISSIONS,
  PERMISSION_GROUPS,
  PRESET_ROLES,
  allPermissionsForPlan,
  exportPermissionLabel,
  permissionGroupsForPlan,
  permissionLabel,
  permissionSummary,
} from './staff.js';
import {
  BUSINESS_ONLY_PERMISSIONS as SERVER_BUSINESS_ONLY_PERMISSIONS,
  permissionsForPlan,
} from '../../base44/shared/planLimits.ts';
import { COMPARISON_ROWS } from './plans.js';
import { en } from './locales/en.js';

/**
 * Staff permissions: what each plan may offer, and what the server enforces.
 *
 * LIVE FINDINGS (2026-11-07, on the fresh Essentials account): the
 * staff-member form offered all 18 permissions, including ones for modules
 * Essentials cannot open. Concepcion confirmed the gating list — and that
 * nothing else on the list is wrong:
 *
 * GATED on Essentials (Business-only):
 * - "Build and take apart bundles" (builds.manage) — Bundles & builds is
 *   Business-only per the Plans page, and the /materials page is already
 *   nav-hidden and PlanGate-locked on Essentials.
 * - The whole BUYING group: "Raise and receive purchase orders"
 *   (purchasing.manage) and "Manage suppliers" (suppliers.manage) — only
 *   Business has a way to add suppliers; both pages are PlanGate-locked.
 * - Custom-role creation ("New role") — Business-only; Essentials uses the
 *   five built-in roles.
 * - "Export and import data" (exports.use) is import-only on Essentials:
 *   the permission KEY stays exports.use, but the label reads "Import data"
 *   and the catalog Export button refuses to render there.
 *
 * NOT gated, per Concepcion: reports.view, listings.manage (Listings has no
 * plan gate anywhere), and everything else on the list. exports.use is not
 * stripped server-side either — it also opens /import, which Essentials
 * includes — so the key stays offerable and only its label and the export
 * button change.
 */

const ALL_KEYS = [
  'products.view',
  'builds.manage',
  'purchasing.manage',
  'suppliers.manage',
  'reports.view',
  'exports.use',
];

test('the gated list is exactly the three confirmed keys', () => {
  assert.deepEqual(BUSINESS_ONLY_PERMISSIONS, [
    'builds.manage',
    'purchasing.manage',
    'suppliers.manage',
  ]);
  assert.deepEqual(SERVER_BUSINESS_ONLY_PERMISSIONS, BUSINESS_ONLY_PERMISSIONS);
});

test('Essentials is offered 15 permissions: the three gated keys are gone', () => {
  const groups = permissionGroupsForPlan('essentials');
  assert.deepEqual(
    groups.map((group) => group.area),
    ['Catalog', 'Stock', 'Sales', 'Reporting & admin']
  );
  // The Buying group drops whole: both of its items are Business-only.
  assert.deepEqual(
    groups.map((group) => group.items.length),
    [4, 3, 3, 5]
  );
  const keys = allPermissionsForPlan('essentials');
  assert.equal(keys.length, 15);
  assert.ok(!keys.includes('builds.manage'));
  assert.ok(!keys.includes('purchasing.manage'));
  assert.ok(!keys.includes('suppliers.manage'));
  // Confirmed NOT gated: reports, exports (import), listings.
  assert.ok(keys.includes('reports.view'));
  assert.ok(keys.includes('exports.use'));
  assert.ok(keys.includes('listings.manage'));
});

test('Business is offered all 18 permissions, Buying included', () => {
  const groups = permissionGroupsForPlan('business');
  assert.equal(groups.length, 5);
  assert.equal(allPermissionsForPlan('business').length, 18);
  assert.deepEqual(allPermissionsForPlan('business'), ALL_PERMISSIONS);
  const buying = groups.find((group) => group.area === 'Buying');
  assert.deepEqual(
    buying.items.map((item) => item.key),
    ['purchasing.manage', 'suppliers.manage']
  );
});

test('an unknown plan fails closed to the Essentials offer', () => {
  assert.deepEqual(allPermissionsForPlan(null), allPermissionsForPlan('essentials'));
  assert.deepEqual(allPermissionsForPlan('weird'), allPermissionsForPlan('essentials'));
  assert.equal(permissionGroupsForPlan(null).length, 4);
});

test('the exports permission reads import-only on Essentials, full on Business', () => {
  const essentials = permissionGroupsForPlan('essentials');
  const exportsItem = essentials
    .flatMap((group) => group.items)
    .find((item) => item.key === 'exports.use');
  assert.equal(exportsItem.label, 'Import data');
  const business = permissionGroupsForPlan('business');
  assert.equal(
    business.flatMap((group) => group.items).find((item) => item.key === 'exports.use').label,
    'Export and import data'
  );
  // The KEY is unchanged on both plans — stored roles and members keep working.
  assert.ok(allPermissionsForPlan('essentials').includes('exports.use'));
  assert.ok(allPermissionsForPlan('business').includes('exports.use'));
  assert.equal(exportPermissionLabel('essentials'), 'Import data');
  assert.equal(exportPermissionLabel('business'), 'Export and import data');
  assert.equal(permissionLabel('exports.use', 'essentials'), 'Import data');
  assert.equal(permissionLabel('exports.use', 'business'), 'Export and import data');
  assert.equal(permissionLabel('exports.use'), 'Export and import data');
  assert.equal(permissionLabel('builds.manage', 'business'), 'Build and take apart bundles');
  assert.equal(permissionLabel('nope'), 'nope');
});

test('the built-in roles grant exports.use on Essentials (Owner and Manager)', () => {
  // Audit finding 36 (2026-11-07): the Import nav entry is permissioned
  // as exports.use and must stay that way — renaming the key would break
  // stored grants. Verified here: the key is offered on Essentials AND the
  // built-in roles that should carry it do. Owner holds every permission;
  // Manager holds everything but staff.manage. The narrower presets (Stock
  // clerk, Sales clerk, Viewer) never held exports.use on either plan, by
  // preset design — not a plan gate.
  const owner = PRESET_ROLES.find((role) => role.id === 'preset-owner');
  const manager = PRESET_ROLES.find((role) => role.id === 'preset-manager');
  assert.ok(owner.permissions.includes('exports.use'));
  assert.ok(manager.permissions.includes('exports.use'));
  assert.ok(allPermissionsForPlan('essentials').includes('exports.use'));
  for (const role of PRESET_ROLES) {
    if (['preset-owner', 'preset-manager'].includes(role.id)) continue;
    assert.ok(!role.permissions.includes('exports.use'), `${role.name} should not hold exports.use`);
  }
});

test('server-side strip mirrors the client offer', () => {
  assert.deepEqual(permissionsForPlan('essentials', ALL_KEYS), [
    'products.view',
    'reports.view',
    'exports.use',
  ]);
  assert.deepEqual(permissionsForPlan('business', ALL_KEYS), ALL_KEYS);
  assert.deepEqual(permissionsForPlan(null, ALL_KEYS), [
    'products.view',
    'reports.view',
    'exports.use',
  ]);
  assert.deepEqual(permissionsForPlan('essentials', 'not-an-array'), []);
  assert.deepEqual(permissionsForPlan('essentials', []), []);
});

test('PermissionPicker only offers the plan\u2019s permissions', () => {
  const picker = readFileSync('src/components/staff/PermissionPicker.jsx', 'utf8');
  assert.match(picker, /permissionGroupsForPlan\(/);
  assert.match(picker, /allPermissionsForPlan\(/);
  assert.match(picker, /useEntitlements\(\)/);
  // No raw catalog rendering: the groups and the "All" grant come from the
  // plan-filtered lists, never the full PERMISSION_GROUPS / ALL_PERMISSIONS.
  assert.doesNotMatch(picker, /PERMISSION_GROUPS\.map/);
  assert.doesNotMatch(picker, /onChange\(ALL_PERMISSIONS\)/);
  assert.match(picker, /onChange\(offerable\)/);
  // While the plan is still loading the offer stays restricted.
  assert.match(picker, /offerBusinessOnly = !entitlementLoading && !isEssentials/);
});

test('Staff hides the New role button on Essentials and guards the opener', () => {
  const staff = readFileSync('src/pages/Staff.jsx', 'utf8');
  assert.match(staff, /const canCreateRoles = !entitlementLoading && !isEssentials;/);
  assert.match(staff, /\{canCreateRoles && \(\s*\n?\s*<Button variant="outline" onClick=\{openNewRole\}>/);
  assert.match(staff, /Custom roles are a Business feature/);
  assert.match(staff, /Custom roles are a Business feature: Essentials uses the five built-in roles/);
});

test('RoleDialog creates roles through the server, edits stay direct', () => {
  const dialog = readFileSync('src/components/staff/RoleDialog.jsx', 'utf8');
  assert.match(dialog, /import \{ createRole \} from '@\/lib\/entitlements';/);
  assert.match(dialog, /else await createRole\(businessId, payload\);/);
  assert.doesNotMatch(dialog, /StaffRole\.create\(payload\)/);
  assert.match(dialog, /await base44\.entities\.StaffRole\.update\(role\.id, payload\);/);
});

test('create-role refuses Essentials server-side; create-staff-member strips', () => {
  const entry = readFileSync('base44/functions/create-role/entry.ts', 'utf8');
  assert.match(entry, /custom_roles_business_only/);
  assert.match(entry, /if \(!limits\.customRoles\)/);
  assert.match(entry, /customRolesBusinessOnlyMessage\(\)/);

  const memberEntry = readFileSync('base44/functions/create-staff-member/entry.ts', 'utf8');
  assert.match(memberEntry, /permissionsForPlan\(entitlement\?\.plan, member\.permissions\)/);
  assert.match(memberEntry, /Business-only permissions stripped/);

  const limits = readFileSync('base44/shared/planLimits.ts', 'utf8');
  assert.match(limits, /customRoles: false/);
  assert.match(limits, /customRoles: true/);
  assert.match(limits, /export function permissionsForPlan\(plan, permissions\)/);
});

test('Plans page states custom roles as Business-only', () => {
  // T6.3: the wording moved into en.js and the comparison row cells are
  // getters — assert the key is referenced and the English value, and the
  // row's live values, instead of grepping the source for the literal.
  assert.equal(en['plansLib.compare.customRoles'], 'Custom staff roles');
  assert.equal(en['plansLib.essentialsIncludes.roles'], 'The five built-in staff roles');
  const row = COMPARISON_ROWS.find((entry) => entry.label === 'Custom staff roles');
  assert.deepEqual(
    { label: row.label, mobile: row.mobile, essentials: row.essentials, business: row.business },
    { label: 'Custom staff roles', mobile: 'Set at launch', essentials: false, business: true }
  );
});

/**
 * AUDIT FINDING 7: permissionSummary was unfiltered, so on Essentials the
 * Manager role card showed "Buying 2/2" and "Stock 4/4", and a Manager
 * member's card read "17 permissions · …Buying" — for permissions the
 * plan cannot open. The summary is now filtered through
 * permissionGroupsForPlan, so Essentials cards only ever show what the
 * plan offers.
 */
test('permissionSummary is plan-aware: Essentials never shows Business-only permissions', () => {
  const manager = PRESET_ROLES.find((role) => role.id === 'preset-manager').permissions;
  const stockClerk = PRESET_ROLES.find((role) => role.id === 'preset-stock').permissions;
  assert.equal(manager.length, 17);
  assert.equal(stockClerk.length, 9);

  // Business: identical to the unfiltered catalog — no behaviour change.
  assert.deepEqual(
    permissionSummary(manager, 'business').map((group) => [group.area, group.granted, group.total]),
    [
      ['Catalog', 4, 4],
      ['Stock', 4, 4],
      ['Sales', 3, 3],
      ['Buying', 2, 2],
      ['Reporting & admin', 4, 5],
    ]
  );
  // Default (no plan) is Business: existing callers keep the old output.
  assert.deepEqual(permissionSummary(manager), permissionSummary(manager, 'business'));

  // Essentials: no Buying group at all, Stock totals 3 (builds.manage
  // dropped), Manager grants 14 of the 15 offered.
  const essentials = permissionSummary(manager, 'essentials');
  assert.deepEqual(
    essentials.map((group) => [group.area, group.granted, group.total]),
    [
      ['Catalog', 4, 4],
      ['Stock', 3, 3],
      ['Sales', 3, 3],
      ['Reporting & admin', 4, 5],
    ]
  );
  assert.equal(
    essentials.reduce((total, group) => total + group.granted, 0),
    14
  );
  // Stock clerk: builds.manage dropped, 8 of 15 on Essentials (9 of 18 on Business).
  assert.equal(
    permissionSummary(stockClerk, 'essentials').reduce((total, group) => total + group.granted, 0),
    8
  );
  assert.equal(
    permissionSummary(stockClerk, 'business').reduce((total, group) => total + group.granted, 0),
    9
  );
  // Unknown plan fails closed to the Essentials summary.
  assert.deepEqual(permissionSummary(manager, null), essentials);
  assert.deepEqual(permissionSummary(manager, 'weird'), essentials);
});

test('the role and member cards show the plan-filtered summary', () => {
  const roleCard = readFileSync('src/components/staff/StaffRoleCard.jsx', 'utf8');
  assert.match(roleCard, /permissionSummary\(role\.permissions, planKey\)/);
  assert.match(roleCard, /planKey = 'business'/);
  const memberCard = readFileSync('src/components/staff/StaffMemberCard.jsx', 'utf8');
  assert.match(memberCard, /permissionSummary\(member\.permissions, planKey\)/);
  // The member count comes from the filtered summary, not the raw stored list.
  assert.match(memberCard, /summary\.reduce\(\(total, group\) => total \+ group\.granted, 0\)/);
  assert.doesNotMatch(memberCard, /\(member\.permissions \|\| \[\]\)\.length/);
  // Staff passes the plan down; while the entitlement loads the cards show
  // the full counts rather than flashing an Essentials restriction onto Business.
  const staff = readFileSync('src/pages/Staff.jsx', 'utf8');
  assert.match(staff, /const cardPlanKey = entitlementLoading \? 'business' : isEssentials \? 'essentials' : 'business';/);
  assert.equal((staff.match(/planKey=\{cardPlanKey\}/g) || []).length, 3);
});

/**
 * AUDIT FINDING 7 (stored data): chooseRole copied the preset's
 * permissions wholesale and the default new member was the Stock clerk —
 * which carries builds.manage — so every Essentials member on Manager or
 * Stock clerk STORED builds.manage / purchasing.manage / suppliers.manage.
 * The dialog now strips Business-only keys when a preset is applied and
 * again at save, so the stored set equals what the plan offers. The
 * server already strips the same keys on create (create-staff-member);
 * this mirrors it client-side and also covers edits, which go straight
 * to the entity.
 */
test('StaffMemberDialog strips Business-only permissions on Essentials', () => {
  const dialog = readFileSync('src/components/staff/StaffMemberDialog.jsx', 'utf8');
  assert.match(dialog, /BUSINESS_ONLY_PERMISSIONS/);
  assert.match(dialog, /const \{ isEssentials, isLoading: entitlementLoading \} = useEntitlements\(\);/);
  // The strip only runs once the plan is known to be Essentials: a
  // Business member edited while the plan loads keeps its permissions.
  assert.match(dialog, /!entitlementLoading && isEssentials/);
  // Preset applied: chooseRole and the default (Stock clerk) new-member form.
  assert.match(dialog, /permissions: role \? stripBusinessOnly\(\[\.\.\.role\.permissions\]\) : current\.permissions,/);
  assert.match(dialog, /permissions: role \? stripBusinessOnly\(\[\.\.\.role\.permissions\]\) : \[\],/);
  assert.match(dialog, /emptyForm\(customRoles, stripBusinessOnly\)/);
  // And filtered at save, so a legacy Business-only key on an Essentials
  // member (kept invisible by the picker) cannot survive an edit.
  assert.match(dialog, /permissions: stripBusinessOnly\(form\.permissions\),/);
  // Pure check against the real strip: Manager 17 -> 14, Stock clerk 9 -> 8.
  const strip = (permissions) =>
    permissions.filter((key) => !BUSINESS_ONLY_PERMISSIONS.includes(key));
  const manager = PRESET_ROLES.find((role) => role.id === 'preset-manager').permissions;
  const stockClerk = PRESET_ROLES.find((role) => role.id === 'preset-stock').permissions;
  assert.equal(strip(manager).length, 14);
  assert.ok(!strip(manager).includes('builds.manage'));
  assert.ok(!strip(manager).includes('purchasing.manage'));
  assert.ok(!strip(manager).includes('suppliers.manage'));
  assert.equal(strip(stockClerk).length, 8);
  assert.ok(!strip(stockClerk).includes('builds.manage'));
  // The server strip agrees (create-staff-member).
  const entry = readFileSync('base44/functions/create-staff-member/entry.ts', 'utf8');
  assert.match(entry, /permissionsForPlan\(entitlement\?\.plan, member\.permissions\)/);
});

/**
 * The strip shortens every preset on Essentials (Manager 17 -> 14), so a
 * length comparison would flag every untouched Essentials member as
 * changed. roleChanged now compares permission SETS against the
 * plan-filtered role set.
 */
test('StaffMemberDialog compares permission sets, not counts, for the role note', () => {
  const dialog = readFileSync('src/components/staff/StaffMemberDialog.jsx', 'utf8');
  assert.match(dialog, /const rolePermissions = roleById\(form\.role_id, customRoles\)\?\.permissions \|\| \[\];/);
  assert.match(dialog, /stripBusinessOnly\(rolePermissions\)/);
  assert.match(dialog, /expected\.size !== actual\.size \|\| \[\.\.\.expected\]\.some\(\(key\) => !actual\.has\(key\)\)/);
  assert.doesNotMatch(dialog, /form\.permissions\.length !== roleById\(form\.role_id, customRoles\)\.permissions\.length/);
});

/**
 * AUDIT FINDING 24: the invite was sent only on create, so a lost invite
 * email left no recovery but delete-and-re-add. The member card now
 * offers Resend invite for invited members, calling inviteUser the same
 * way the create path does.
 */
test('StaffMemberCard offers Resend invite for invited members', () => {
  const card = readFileSync('src/components/staff/StaffMemberCard.jsx', 'utf8');
  assert.match(card, /\{member\.status === 'invited' && \(/);
  assert.match(card, /await base44\.users\.inviteUser\(member\.email, member\.app_role \|\| 'user'\);/);
  assert.match(card, /Resend invite/);
  assert.match(card, /Invitation resent/);
  assert.match(card, /Invitation could not be sent/);
  // The create path in the dialog still sends the first invite the same way.
  const dialog = readFileSync('src/components/staff/StaffMemberDialog.jsx', 'utf8');
  assert.match(dialog, /await base44\.users\.inviteUser\(email, form\.app_role\);/);
});

test('Bundles lives only on the gated /materials page', () => {
  const app = readFileSync('src/App.jsx', 'utf8');
  assert.match(app, /<PlanGate feature="builds">/);
  assert.match(app, /path="\/materials"/);
  const nav = readFileSync('src/components/layout/navGroups.js', 'utf8');
  assert.match(nav, /\{ to: '\/materials', label: 'Bundles & builds'[^}]*feature: 'builds' \}/);
  // No bundle UI anywhere else: not on Products, Inventory or the Dashboard.
  // (The /materials page itself is the feature, behind the gate above — and
  // the Essentials menu has no Bundles entry.)
  for (const page of ['Products', 'Inventory', 'Dashboard']) {
    const content = readFileSync(`src/pages/${page}.jsx`, 'utf8');
    assert.doesNotMatch(content, /bundle/i, `${page} must not contain bundle UI`);
  }
  // Movements is the one exception, and only through the plan-gated filter:
  // its bundle options come from BUNDLE_MOVEMENT_TYPES and are spread in
  // only when the plan is known Business (see movementTypes.test.js). The
  // first bundle option must sit inside that conditional spread, never in
  // an unconditional options list.
  const movements = readFileSync('src/pages/Movements.jsx', 'utf8');
  assert.match(movements, /import \{ BUNDLE_MOVEMENT_TYPES \} from '@\/lib\/plans';/);
  assert.match(movements, /\.\.\.\(showBundleTypes\s*\n?\s*\? \[/);
  assert.ok(
    movements.indexOf('...(showBundleTypes') < movements.indexOf("{ value: 'consume'"),
    'bundle options must live inside the showBundleTypes conditional'
  );
});

test('the catalog Export button refuses to render on Essentials', () => {
  const button = readFileSync('src/components/products/ExportCsvButton.jsx', 'utf8');
  assert.match(button, /useEntitlements\(\)/);
  assert.match(button, /if \(entitlementLoading \|\| isEssentials\) return null;/);
  // Products still renders the button for Business; the gate lives in the
  // button itself so no other page can leak an export either.
  const products = readFileSync('src/pages/Products.jsx', 'utf8');
  assert.match(products, /<ExportCsvButton businessName=\{profile\.name\} businessId=\{activeId\} \/>/);
});

test('every other export action lives on a Business-gated page', () => {
  const app = readFileSync('src/App.jsx', 'utf8');
  for (const feature of ['valuation', 'reports', 'alerts', 'purchasing', 'suppliers', 'exports']) {
    assert.match(app, new RegExp(`<PlanGate feature="${feature}">`), `${feature} must be PlanGate-locked`);
  }
  // Import is NOT gated: it is an Essentials feature and stays open.
  const importLine = app.split('\n').find((line) => line.includes('path="/import"'));
  assert.match(importLine, /<Route path="\/import" element=\{<ImportCenter \/>\} \/>/);
  assert.doesNotMatch(importLine, /PlanGate/);
  // Import still goes through the server create path, and the import
  // template/problem-report downloads are import aids, not exports.
  const workbench = readFileSync('src/components/import/ImportWorkbench.jsx', 'utf8');
  assert.match(workbench, /await createProducts\(businessId, chunk\);/);
  const templates = readFileSync('src/lib/importTemplates.js', 'utf8');
  assert.match(templates, /downloadCsv\(name, toCsv\(columns, \[example\]\)\);/);
});

test('NoAccess names the permission in the plan\u2019s own words', () => {
  const noAccess = readFileSync('src/components/staff/NoAccess.jsx', 'utf8');
  assert.match(noAccess, /permissionLabel\(permission, planKey\)/);
  assert.match(noAccess, /const \{ planKey \} = useEntitlements\(\);/);
});

test('export has no backend endpoint: the surface is fully client-side and gated', () => {
  // No backend function exports, backs up or downloads anything, so there
  // is no server endpoint to refuse at — the enforcement is the button and
  // the page gates. If a backend export is ever added, this test fails and
  // forces the gating question to be answered then.
  for (const name of readdirSync('base44/functions')) {
    assert.doesNotMatch(name, /export|backup|download|csv|xlsx/i, `${name} looks like an export endpoint`);
  }
  // The export helpers build files in the browser from entity reads and
  // never invoke a backend function.
  for (const file of [
    'src/lib/exportData.js',
    'src/components/products/ExportCsvButton.jsx',
    'src/components/exports/ExportCard.jsx',
    'src/components/exports/BackupCard.jsx',
  ]) {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /base44\.functions/, `${file} must not invoke a backend function`);
  }
  // Navigation hides Exports on Essentials and keeps Import: the /exports
  // entry carries the Business-only feature, /import carries none, and the
  // layout filters both by the same staff/plan rule.
  const nav = readFileSync('src/components/layout/navGroups.js', 'utf8');
  assert.match(nav, /\{ to: '\/exports', label: 'Exports'[^}]*feature: 'exports' \}/);
  const importEntry = nav.match(/\{ to: '\/import'[^}]*\}/)[0];
  assert.doesNotMatch(importEntry, /feature/);
  const layout = readFileSync('src/components/Layout.jsx', 'utf8');
  assert.match(layout, /\(!item\.feature \|\| planAllows\(item\.feature\)\)/);
});
