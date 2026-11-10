/**
 * Server-side plan allowances — T3 (plan §2.4, §5.3).
 *
 * This is the copy that actually decides whether a write is allowed;
 * src/lib/plans.js holds the same numbers for what the screens
 * display. When a plan allowance changes, change both.
 *
 * Until T4 lands there is no billing: a business with no entitlement
 * row resolves to restricted Essentials (fail closed, never Business).
 * No route in T3 writes an entitlement row — T4's Stripe-verified
 * flows own that. Tests set the plan by direct SQL only.
 */
import { getPool } from './db.js';

export const PLAN_LIMITS = {
  essentials: { products: 50, staff: 3, sites: 1, businesses: 1, customRoles: false },
  business: { products: null, staff: null, sites: 5, businesses: 5, customRoles: true },
};

export const DEFAULT_PLAN = 'essentials';

/** Locations that are a site in their own right; shelves and bins inside are not. */
export const SITE_KINDS = ['store', 'warehouse', 'other'];

export const BUSINESS_ONLY_PERMISSIONS = [
  'builds.manage',
  'purchasing.manage',
  'suppliers.manage',
];

export const ALL_PERMISSIONS = [
  'products.view',
  'products.edit',
  'locations.manage',
  'categories.manage',
  'scan.use',
  'movements.reverse',
  'counts.run',
  'builds.manage',
  'orders.manage',
  'returns.manage',
  'listings.manage',
  'purchasing.manage',
  'suppliers.manage',
  'reports.view',
  'print.use',
  'exports.use',
  'settings.manage',
  'staff.manage',
];

export const BUNDLE_MOVEMENT_TYPES = ['consume', 'produce', 'disassemble', 'recovered'];

export function limitsForPlan(plan) {
  return plan === 'business' ? PLAN_LIMITS.business : PLAN_LIMITS.essentials;
}

export function featureAllowed(planKey, _feature) {
  // Every gated module belongs to Business; Essentials gets none of them.
  return planKey === 'business';
}

/** Drop Business-only permission keys for any plan that is not Business. */
export function permissionsForPlan(plan, permissions) {
  if (!Array.isArray(permissions)) return [];
  if (plan === 'business') return permissions;
  return permissions.filter((key) => !BUSINESS_ONLY_PERMISSIONS.includes(key));
}

export function isOperatingSite(location) {
  return SITE_KINDS.includes(location?.kind || 'store') && !location?.parent_id;
}

/** The plan row for one business, or null when no row exists yet. */
export async function entitlementFor(pool, businessId) {
  if (!businessId) return null;
  const { rows } = await pool.query(
    'SELECT * FROM entitlements WHERE business_id = $1 LIMIT 1',
    [businessId],
  );
  return rows[0] ?? null;
}

/** Missing billing records resolve to restricted Essentials, never Business. */
export async function planFor(pool, businessId) {
  const record = await entitlementFor(pool, businessId);
  if (!record) return DEFAULT_PLAN;
  return record.plan === 'business' ? 'business' : DEFAULT_PLAN;
}

export function productLimitMessage(limit, used) {
  return `This plan includes ${limit} active products and ${used} are already in the catalog. Archive a product you no longer sell to free a slot, or move to Business for unlimited products.`;
}

export function staffLimitMessage(limit) {
  return `This plan includes ${limit} additional staff. Free a seat or move to Business for unlimited staff.`;
}

export function siteLimitMessage(limit) {
  const base = `This plan includes ${limit} site${limit === 1 ? '' : 's'}.`;
  return `${base} Shelves, bins and vans inside a site do not count, and you can still add them.${limit < 5 ? ' Move to Business for up to five sites.' : ''}`;
}

export function customRolesBusinessOnlyMessage() {
  return 'Custom roles are a Business feature. Essentials uses the five built-in roles — Owner, Manager, Stock clerk, Sales clerk, Viewer. Move to Business to create your own roles.';
}

export function getPoolOrThrow() {
  const pool = getPool();
  if (!pool) throw Object.assign(new Error('database_not_configured'), { status: 503 });
  return pool;
}
