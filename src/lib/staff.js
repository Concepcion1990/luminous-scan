/**
 * Staff roles and permissions. Preset roles live in code so every business has
 * usable roles immediately; roles the owner writes are stored per business.
 */

export const PERMISSION_GROUPS = [
  {
    area: 'Catalog',
    items: [
      { key: 'products.view', label: 'See products and stock' },
      { key: 'products.edit', label: 'Add and edit products' },
      { key: 'locations.manage', label: 'Manage locations' },
      { key: 'categories.manage', label: 'Manage categories and tags' },
    ],
  },
  {
    area: 'Stock',
    items: [
      { key: 'scan.use', label: 'Scan and record stock movements' },
      { key: 'movements.reverse', label: 'Reverse a movement' },
      { key: 'counts.run', label: 'Run stock counts' },
      { key: 'builds.manage', label: 'Build and take apart bundles' },
    ],
  },
  {
    area: 'Sales',
    items: [
      { key: 'orders.manage', label: 'Take and pack orders' },
      { key: 'returns.manage', label: 'Approve and process returns' },
      { key: 'listings.manage', label: 'Manage channel listings' },
    ],
  },
  {
    area: 'Buying',
    items: [
      { key: 'purchasing.manage', label: 'Raise and receive purchase orders' },
      { key: 'suppliers.manage', label: 'Manage suppliers' },
    ],
  },
  {
    area: 'Reporting & admin',
    items: [
      { key: 'reports.view', label: 'See reports, value and alerts' },
      { key: 'print.use', label: 'Print labels and documents' },
      { key: 'exports.use', label: 'Export and import data' },
      { key: 'settings.manage', label: 'Change business settings' },
      { key: 'staff.manage', label: 'Manage staff and roles' },
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
  return planKey === 'business' ? 'Export and import data' : 'Import data';
}

export const PRESET_ROLES = [
  {
    id: 'preset-owner',
    name: 'Owner',
    description: 'Everything, including staff, settings and data.',
    permissions: ALL_PERMISSIONS,
  },
  {
    id: 'preset-manager',
    name: 'Manager',
    description: 'Runs the shop floor: stock, buying, orders and counts.',
    permissions: ALL_PERMISSIONS.filter((key) => key !== 'staff.manage'),
  },
  {
    id: 'preset-stock',
    name: 'Stock clerk',
    description: 'Receives, scans, counts and prints labels.',
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
    name: 'Sales clerk',
    description: 'Handles orders, returns and listings, with sales and stock reporting.',
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
    name: 'Viewer',
    description: 'Read-only access to stock and reports.',
    permissions: ['products.view', 'reports.view', 'print.use'],
  },
];

export const STATUS_OPTIONS = [
  { value: 'invited', label: 'Invited', tone: 'border-warn/40 bg-warn/10 text-warn' },
  { value: 'active', label: 'Active', tone: 'border-ok/40 bg-ok/10 text-ok' },
  { value: 'suspended', label: 'Suspended', tone: 'border-border bg-muted text-muted-foreground' },
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