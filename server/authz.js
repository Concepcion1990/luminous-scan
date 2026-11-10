/**
 * Server-side authorization — T3 (plan §5.3, §2.10).
 *
 * Base44's row-level rules do not exist on Fly.io, so every check is
 * explicit server code here. Fail closed throughout: any check that
 * cannot be proven returns "not allowed".
 *
 * Access to a business: the owner, or a TRUSTED active staff member.
 * The PR #63 provenance rule: a StaffMember row is trusted only when
 * the business owner created it, or when its creator chains back to
 * the owner through trusted inviters (created_by_id is the one field
 * a caller cannot forge — the server sets it from the session).
 * Untrusted rows grant nothing.
 *
 * Staff read-by-email (PR #63 follow-up (a)): a staff member reads
 * their own StaffMember row by matching data.email to the caller's
 * email — even while still Invited. That is a read of ONE row, not
 * a grant of business access.
 */
import { planFor, permissionsForPlan, ALL_PERMISSIONS } from './plans.js';

export const PRESET_ROLES = [
  { id: 'preset-owner', name: 'Owner', permissions: ALL_PERMISSIONS },
  {
    id: 'preset-manager',
    name: 'Manager',
    permissions: ALL_PERMISSIONS.filter((key) => key !== 'staff.manage'),
  },
  {
    id: 'preset-stock',
    name: 'Stock clerk',
    permissions: [
      'products.view', 'products.edit', 'locations.manage', 'categories.manage',
      'scan.use', 'movements.reverse', 'counts.run', 'builds.manage', 'print.use',
    ],
  },
  {
    id: 'preset-sales',
    name: 'Sales clerk',
    permissions: [
      'products.view', 'scan.use', 'orders.manage', 'returns.manage',
      'listings.manage', 'reports.view', 'print.use',
    ],
  },
  { id: 'preset-viewer', name: 'Viewer', permissions: ['products.view', 'reports.view', 'print.use'] },
];

export function presetRoleById(roleId) {
  return PRESET_ROLES.find((role) => role.id === roleId) || null;
}

export async function loadBusiness(pool, businessId) {
  if (!businessId) return null;
  const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1 LIMIT 1', [businessId]);
  return rows[0] ?? null;
}

export async function loadBusinessesForUser(pool, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM businesses WHERE owner_id = $1 ORDER BY created_at ASC',
    [userId],
  );
  return rows;
}

/** The StaffMember row for one email on one business (any status), or null. */
export async function staffRowForEmail(pool, businessId, email) {
  if (!businessId || !email) return null;
  const { rows } = await pool.query(
    'SELECT * FROM staff_members WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1',
    [businessId, email],
  );
  return rows[0] ?? null;
}

/**
 * The PR #63 provenance check. Trusted when the business owner
 * created the row, or when the creator chains back to the owner:
 * creator user -> their email -> their own StaffMember row on this
 * business -> that row trusted (recursion, visited-guarded).
 */
export async function isTrustedStaffRow(pool, business, row, visited = new Set()) {
  if (!business || !row) return false;
  if (row.created_by_id && row.created_by_id === business.owner_id) return true;
  if (!row.created_by_id || visited.has(row.created_by_id)) return false;
  visited.add(row.created_by_id);
  const creator = (await pool.query('SELECT id, email FROM users WHERE id = $1 LIMIT 1', [row.created_by_id])).rows[0];
  if (!creator) return false;
  if (creator.id === business.owner_id) return true;
  const creatorRow = await staffRowForEmail(pool, business.id, creator.email);
  if (!creatorRow) return false;
  return isTrustedStaffRow(pool, business, creatorRow, visited);
}

function permissionsOfRole(roleId, customRoles, planKey) {
  const preset = presetRoleById(roleId);
  if (preset) return permissionsForPlan(planKey, preset.permissions);
  const custom = (customRoles || []).find((role) => role.id === roleId);
  if (custom) return permissionsForPlan(planKey, parseJsonArray(custom.permissions));
  return [];
}

export function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Resolve the caller's access to one business.
 * Returns null when the caller has no access at all.
 * { business, planKey, isOwner, staffRow, permissions, can(permission) }
 */
export async function resolveAccess(pool, user, businessId) {
  if (!user || !businessId) return null;
  const business = await loadBusiness(pool, businessId);
  if (!business) return null;
  const planKey = await planFor(pool, businessId);
  if (business.owner_id === user.id) {
    return {
      business,
      planKey,
      isOwner: true,
      staffRow: null,
      permissions: [...ALL_PERMISSIONS],
      can: () => true,
    };
  }
  const row = await staffRowForEmail(pool, businessId, user.email);
  if (!row || row.status !== 'active') return null;
  if (!(await isTrustedStaffRow(pool, business, row))) return null;
  const customRoles = (
    await pool.query('SELECT * FROM staff_roles WHERE business_id = $1', [businessId])
  ).rows;
  let permissions = [];
  if (Array.isArray(row.permissions) || typeof row.permissions === 'string') {
    const stored = parseJsonArray(row.permissions);
    permissions = stored.length ? permissionsForPlan(planKey, stored) : permissionsOfRole(row.role_id, customRoles, planKey);
  } else {
    permissions = permissionsOfRole(row.role_id, customRoles, planKey);
  }
  // A stored permission set wins when present; a role-only row falls
  // back to the role's permissions. Either way the plan filter applies.
  return {
    business,
    planKey,
    isOwner: false,
    staffRow: row,
    permissions,
    can: (permission) => !permission || permissions.includes(permission),
  };
}

/** Business ids the caller can read at all (owner businesses + trusted staff ones). */
export async function accessibleBusinessIds(pool, user) {
  const owned = await loadBusinessesForUser(pool, user.id);
  const ids = new Set(owned.map((business) => business.id));
  const { rows } = await pool.query(
    'SELECT business_id FROM staff_members WHERE LOWER(email) = LOWER($1) AND status = $2',
    [user.email, 'active'],
  );
  for (const row of rows) {
    const business = await loadBusiness(pool, row.business_id);
    if (!business) continue;
    const member = await staffRowForEmail(pool, row.business_id, user.email);
    if (member && (await isTrustedStaffRow(pool, business, member))) ids.add(row.business_id);
  }
  return [...ids];
}

export function forbidden(res, message = 'You do not have access to this workspace.') {
  return res.status(403).json({ error: 'forbidden', message });
}

export function badRequest(res, error, message) {
  return res.status(400).json({ error, message: message || error });
}
