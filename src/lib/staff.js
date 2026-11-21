/**
 * Staff roles and permissions. Preset roles live in code so every business has
 * usable roles immediately; roles the owner writes are stored per business.
 */

import { t } from './i18n.js';

export const PERMISSION_GROUPS = [
  {
    get area() { return t('staffLib.area.catalog'); },
    items: [
      { key: 'products.view', get label() { return t('staffLib.perm.productsView'); } },
      { key: 'products.edit', get label() { return t('staffLib.perm.productsEdit'); } },
      { key: 'locations.manage', get label() { return t('staffLib.perm.locationsManage'); } },
      { key: 'categories.manage', get label() { return t('staffLib.perm.categoriesManage'); } },
    ],
  },
  {
    get area() { return t('staffLib.area.stock'); },
    items: [
      { key: 'scan.use', get label() { return t('staffLib.perm.scanUse'); } },
      { key: 'movements.reverse', get label() { return t('staffLib.perm.movementsReverse'); } },
      { key: 'counts.run', get label() { return t('staffLib.perm.countsRun'); } },
      { key: 'builds.manage', get label() { return t('staffLib.perm.buildsManage'); } },
    ],
  },
  {
    get area() { return t('staffLib.area.sales'); },
    items: [
      { key: 'orders.manage', get label() { return t('staffLib.perm.ordersManage'); } },
      { key: 'returns.manage', get label() { return t('staffLib.perm.returnsManage'); } },
      { key: 'listings.manage', get label() { return t('staffLib.perm.listingsManage'); } },
    ],
  },
  {
    get area() { return t('staffLib.area.buying'); },
    items: [
      { key: 'purchasing.manage', get label() { return t('staffLib.perm.purchasingManage'); } },
      { key: 'suppliers.manage', get label() { return t('staffLib.perm.suppliersManage'); } },
    ],
  },
  {
    get area() { return t('staffLib.area.reportingAdmin'); },
    items: [
      { key: 'reports.view', get label() { return t('staffLib.perm.reportsView'); } },
      { key: 'print.use', get label() { return t('staffLib.perm.printUse'); } },
      { key: 'exports.use', get label() { return t('staffLib.perm.exportsUse'); } },
      { key: 'settings.manage', get label() { return t('staffLib.perm.settingsManage'); } },
      { key: 'staff.manage', get label() { return t('staffLib.perm.staffManage'); } },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) =>
  group.items.map((item) => item.key)
);

/**
 * Permissions that only exist on Business, audited 2026-11-07 against the
 * plan definitions (src/lib/plans.js) and every surface each permission
 * opens. Each of these opens ONLY a Business-only module — the page is
 * nav-hidden and PlanGate-locked on Essentials — so offering the permission
 * on Essentials would offer something the plan cannot do:
 *
 * - builds.manage → Bundles & builds (Plans: essentials false)
 * - purchasing.manage → Purchasing (Plans: 'Suppliers and purchase orders',
 *   essentials false; the /purchasing page is PlanGate-locked on Essentials)
 * - suppliers.manage → Suppliers (same Plans row; Concepcion confirmed
 *   2026-11-07 that only Business has a way to add suppliers)
 *
 * Deliberately NOT in this list, per Concepcion's confirmation 2026-11-07
 * that nothing else on the 18-permission list is wrong: reports.view (she
 * keeps it offered on Essentials) and exports.use ("Export and import
 * data"), which opens /exports (Business-only) AND /import (Essentials —
 * imports are an Essentials feature), so gating the key would take Import
 * away from Essentials staff. That key needs a split or a rename first.
 * listings.manage stays too: Listings has no plan gate anywhere, so it is
 * an Essentials module.
 *
 * The catalog itself is NOT edited: Business still offers all 18, and the
 * preset roles keep their definitions. Only the Essentials offer is
 * filtered — and the pages these permissions open stay locked regardless,
 * so a permission granted another way still opens nothing on Essentials.
 */
export const BUSINESS_ONLY_PERMISSIONS = [
  'builds.manage',
  'purchasing.manage',
  'suppliers.manage',
];

/**
 * The permission groups a plan may offer, in catalog order. On Essentials
 * the Business-only items are dropped, and a group left empty (Buying —
 * both of its items are Business-only) is dropped whole. The exports key
 * keeps its name on both plans but its label is import-only on Essentials:
 * Essentials cannot export, so the same permission only opens Import there.
 */
export function permissionGroupsForPlan(planKey) {
  const isBusiness = planKey === 'business';
  return PERMISSION_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => isBusiness || !BUSINESS_ONLY_PERMISSIONS.includes(item.key))
      .map((item) =>
        !isBusiness && item.key === 'exports.use' ? { ...item, label: exportPermissionLabel(planKey) } : item
      ),
  })).filter((group) => group.items.length > 0);
}

/** Flat list of the permission keys a plan may offer. */
export function allPermissionsForPlan(planKey) {
  return permissionGroupsForPlan(planKey).flatMap((group) =>
    group.items.map((item) => item.key)
  );
}

/**
 * What the exports permission is called on a plan. The KEY stays exports.use
 * on both — stored roles and members keep working — but Essentials cannot
 * export, so on Essentials the permission is offered, and named, as import
 * only. Business keeps the full label.
 */
export function exportPermissionLabel(planKey) {
  return planKey === 'business' ? t('staffLib.perm.exportsUse') : t('staffLib.importOnly');
}

export const PRESET_ROLES = [
  {
    id: 'preset-owner',
    get name() { return t('staffLib.role.ownerName'); },
    get description() { return t('staffLib.role.ownerDesc'); },
    permissions: ALL_PERMISSIONS,
  },
  {
    id: 'preset-manager',
    get name() { return t('staffLib.role.managerName'); },
    get description() { return t('staffLib.role.managerDesc'); },
    permissions: ALL_PERMISSIONS.filter((key) => key !== 'staff.manage'),
  },
  {
    id: 'preset-stock',
    get name() { return t('staffLib.role.stockClerkName'); },
    get description() { return t('staffLib.role.stockClerkDesc'); },
    permissions: [
      'products.view',
      'products.edit',
      'locations.manage',
      'categories.manage',
      'scan.use',
      'movements.reverse',
      'counts.run',
      'builds.manage',
      'print.use',
    ],
  },
  {
    id: 'preset-sales',
    get name() { return t('staffLib.role.salesClerkName'); },
    get description() { return t('staffLib.role.salesClerkDesc'); },
    permissions: [
      'products.view',
      'scan.use',
      'orders.manage',
      'returns.manage',
      'listings.manage',
      'reports.view',
      'print.use',
    ],
  },
  {
    id: 'preset-viewer',
    get name() { return t('staffLib.role.viewerName'); },
    get description() { return t('staffLib.role.viewerDesc'); },
    permissions: ['products.view', 'reports.view', 'print.use'],
  },
];

/**
 * Owner-granted Settings sections (the owner's ruling, Nov 19,
 * 2026). A member's Settings is PERSONAL ONLY by default; at
 * enrollment (and later, on the member's record) the owner may
 * tick extra business sections, and whatever is ticked pops up
 * in that person's own Settings as a working section. Unticked
 * sections stay completely invisible.
 *
 * These keys live in the member's own permissions array, but
 * they are deliberately NOT part of PERMISSION_GROUPS /
 * ALL_PERMISSIONS / the preset roles: no role carries them, so
 * nobody holds one by default — each grant is a per-member tick
 * by the boss's hand. Subscription / billing / trial is NOT here
 * and never will be: owner-only, not grantable.
 *
 * - settings.taxRate        the "My tax rate" field
 * - settings.businessDetails contact details + tagline
 * - settings.gs1            the GS1 company prefix field
 * - settings.editName       the business NAME (header pencil +
 *                           Settings name field) — managers only:
 *                           the tick stays inert on a staff row,
 *                           enforced server-side as well.
 */
export const SETTINGS_GRANTS = [
  { key: 'settings.taxRate', get label() { return t('staffLib.perm.settingsTaxRate'); } },
  { key: 'settings.businessDetails', get label() { return t('staffLib.perm.settingsBusinessDetails'); } },
  { key: 'settings.gs1', get label() { return t('staffLib.perm.settingsGs1'); } },
  { key: 'settings.editName', get label() { return t('staffLib.perm.settingsEditName'); } },
  { key: 'settings.contactDetails', get label() { return t('staffLib.perm.settingsContactDetails'); } },
];

export const SETTINGS_GRANT_KEYS = SETTINGS_GRANTS.map((grant) => grant.key);

export function isSettingsGrant(key) {
  return SETTINGS_GRANT_KEYS.includes(key);
}

/**
 * Owner-granted returns completion (the owner's ruling, Nov 19,
 * 2026). Same pattern as the Settings grants above: the key
 * lives in the member's own permissions array, is deliberately
 * NOT part of PERMISSION_GROUPS / ALL_PERMISSIONS / the preset
 * roles, and is edited in the member dialog as its own tick, so
 * the permission picker can never wipe it and no role carries
 * it by default — a manager included. Holding returns.manage
 * lets a person LOG a return; approving it and finishing the
 * refund or exchange takes this tick, or the owner.
 */
export const RETURNS_GRANTS = [
  { key: 'returns.complete', get label() { return t('staffLib.perm.returnsComplete'); } },
];

export const RETURNS_GRANT_KEYS = RETURNS_GRANTS.map((grant) => grant.key);

export function isReturnsGrant(key) {
  return RETURNS_GRANT_KEYS.includes(key);
}

/**
 * Owner-granted product creation (the owner's ruling, Nov 19,
 * 2026 — no dangling doors). Same pattern as the grants above:
 * the key lives in the member's own permissions array, is
 * deliberately NOT part of PERMISSION_GROUPS / ALL_PERMISSIONS /
 * the preset roles, and is edited in the member dialog as its own
 * tick, so the permission picker can never wipe it and no role
 * carries it by default. Holding it lets a member whose role
 * cannot create products (a Sales clerk, say) see the New product
 * buttons and create products end to end; editing an existing
 * product still takes products.edit. Unticked, the buttons do not
 * appear for that person at all — a door a person cannot walk
 * through does not hang on their wall.
 */
export const PRODUCTS_GRANTS = [
  { key: 'products.create', get label() { return t('staffLib.perm.productsCreate'); } },
];

export const PRODUCTS_GRANT_KEYS = PRODUCTS_GRANTS.map((grant) => grant.key);

export function isProductsGrant(key) {
  return PRODUCTS_GRANT_KEYS.includes(key);
}

/**
 * Owner-granted location creation (the owner's ruling, Nov 19,
 * 2026). Same pattern as the grants above: adding a location is
 * the OWNER'S job, and the key lives in the member's own
 * permissions array, deliberately NOT part of PERMISSION_GROUPS /
 * ALL_PERMISSIONS / the preset roles, edited in the member dialog
 * as its own tick, so the permission picker can never wipe it and
 * no role carries it by default — a manager included. Holding it
 * lets a member the owner chose add locations (the Locations page
 * door and the inline add-a-location form follow it). Editing and
 * deleting locations stay locations.manage work, exactly as
 * before: her ruling covers ADDING only.
 */
export const LOCATIONS_GRANTS = [
  { key: 'locations.create', get label() { return t('staffLib.perm.locationsCreate'); } },
];

export const LOCATIONS_GRANT_KEYS = LOCATIONS_GRANTS.map((grant) => grant.key);

export function isLocationsGrant(key) {
  return LOCATIONS_GRANT_KEYS.includes(key);
}

/**
 * Owner-granted staff roster (the owner's ruling, Nov 19,
 * 2026, answering the release-314 §17 flag). Same pattern as
 * the grants above: whether a manager sees the whole staff
 * roster is the OWNER'S choice, made per manager. The key
 * lives in the member's own permissions array, deliberately
 * NOT part of PERMISSION_GROUPS / ALL_PERMISSIONS / the
 * preset roles, and is edited in the member dialog as its own
 * tick, so the permission picker can never wipe it and no role
 * carries it by default. Like the Settings name and
 * contact-details ticks (release 314), it is offered for every
 * role but takes effect only for a MANAGER-level member — a
 * staff member's stored tick stays inert, enforced server-side
 * (server/entities.js canSeeRoster). Holding it lets a manager
 * READ the full roster on the Staff page; editing members
 * still takes staff.manage, and the personal contact fields
 * and pay stay behind the hiring gate, exactly as before.
 */
export const ROSTER_GRANTS = [
  { key: 'staff.roster', get label() { return t('staffLib.perm.staffRoster'); } },
];

export const ROSTER_GRANT_KEYS = ROSTER_GRANTS.map((grant) => grant.key);

export function isRosterGrant(key) {
  return ROSTER_GRANT_KEYS.includes(key);
}

/**
 * Owner-granted low stock — TWO sibling ticks (the owner's
 * rulings, Nov 20, 2026). Same pattern as the grants above: the
 * keys live in the member's own permissions array, deliberately
 * NOT part of PERMISSION_GROUPS / ALL_PERMISSIONS / the preset
 * roles, edited in the member dialog as their own ticks, so the
 * permission picker can never wipe them and no role carries
 * them by default — a manager included. The owner holds both
 * inherently. Low stock exists only on Business, so the tick
 * block renders only there; on Essentials neither tick exists.
 *
 * - alerts.view       the low-stock ALERT surfaces: the
 *                     Overview Needs attention box and low
 *                     counts, the Low Stock and Alerts pages
 *                     and their doors, the LOW marks. Without
 *                     it those surfaces simply do not exist
 *                     for that person, even on Business.
 * - products.reorder  SAVING a change to a product's reorder
 *                     point. The Reorder at box itself stays
 *                     visible to everyone on Business, exactly
 *                     as before — without this tick a save
 *                     that changes the value is refused by
 *                     the server; a save that leaves it alone
 *                     goes through on the ordinary edit right.
 */
export const LOW_STOCK_GRANTS = [
  { key: 'alerts.view', get label() { return t('staffLib.perm.alertsView'); } },
  { key: 'products.reorder', get label() { return t('staffLib.perm.productsReorder'); } },
];

export const LOW_STOCK_GRANT_KEYS = LOW_STOCK_GRANTS.map((grant) => grant.key);

export function isLowStockGrant(key) {
  return LOW_STOCK_GRANT_KEYS.includes(key);
}

/**
 * Owner-granted policy trainings (Nov 20, 2026): TWO sibling
 * ticks, one per owner document. Reading the Store Policies and
 * the Terms stays core for everyone — these ticks assign only
 * the QUIZ training the owner builds beside each document in
 * Settings. Off by default, in no preset, either plan (the
 * documents live on both).
 */
export const TRAINING_GRANTS = [
  { key: 'training.policiesQuiz', get label() { return t('staffLib.perm.trainingPoliciesQuiz'); } },
  { key: 'training.termsQuiz', get label() { return t('staffLib.perm.trainingTermsQuiz'); } },
];

export const TRAINING_GRANT_KEYS = TRAINING_GRANTS.map((grant) => grant.key);

export function isTrainingGrant(key) {
  return TRAINING_GRANT_KEYS.includes(key);
}

/** Any per-member grant key (Settings sections + returns + products + locations + roster + low stock + policy trainings). */
export function isMemberGrant(key) {
  return isSettingsGrant(key) || isReturnsGrant(key) || isProductsGrant(key) || isLocationsGrant(key) || isRosterGrant(key) || isLowStockGrant(key) || isTrainingGrant(key);
}

/** A member row's level, mirroring the server's personLevel. */
export function memberLevelOf(member) {
  if (!member) return 'staff';
  const roleName = String(member.role_name || '').trim().toLowerCase();
  return member.role_id === 'preset-manager' || roleName === 'manager' ? 'manager' : 'staff';
}

export const STATUS_OPTIONS = [
  { value: 'invited', get label() { return t('staffLib.status.invited'); }, tone: 'border-warn/40 bg-warn/10 text-warn' },
  { value: 'active', get label() { return t('staffLib.status.active'); }, tone: 'border-ok/40 bg-ok/10 text-ok' },
  { value: 'suspended', get label() { return t('staffLib.status.suspended'); }, tone: 'border-border bg-muted text-muted-foreground' },
];

/** Preset roles plus the business's own roles, in one list. */
export function allRoles(customRoles = []) {
  const stored = customRoles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description || '',
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
  }));
  return [...PRESET_ROLES, ...stored];
}

export function roleById(roleId, customRoles = []) {
  return allRoles(customRoles).find((role) => role.id === roleId) || null;
}

export function permissionLabel(key, planKey = 'business') {
  for (const group of PERMISSION_GROUPS) {
    const found = group.items.find((item) => item.key === key);
    if (found) {
      if (key === 'exports.use') return exportPermissionLabel(planKey);
      return found.label;
    }
  }
  return key;
}

export function statusMeta(value) {
  return STATUS_OPTIONS.find((option) => option.value === value) || STATUS_OPTIONS[0];
}

/**
 * "6 of 18 permissions" style summary, grouped by area — filtered to what
 * the plan may offer, so an Essentials card never advertises a Business-only
 * permission. On Essentials the Buying group is gone entirely (both of its
 * items are Business-only) and Stock totals 3, not 4 (builds.manage is
 * dropped), so a Manager card reads "Stock 3/3" and no "Buying 2/2".
 * The default is Business, which is the unfiltered catalog — existing
 * callers that pass no plan keep exactly the old output.
 *
 * AUDIT FINDING 7 (2026-11-07): the unfiltered summary showed Business-only
 * permissions on Essentials cards, and the stored member sets carried
 * builds.manage / purchasing.manage / suppliers.manage.
 */
export function permissionSummary(permissions = [], planKey = 'business') {
  const set = new Set(permissions);
  return permissionGroupsForPlan(planKey).map((group) => ({
    area: group.area,
    granted: group.items.filter((item) => set.has(item.key)).length,
    total: group.items.length,
  }));
}