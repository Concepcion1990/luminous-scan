/**
 * Staff documents — the tick half (Nov 21, 2026).
 *
 * The data rules live in server/staffDocumentRoutes.js; this
 * module answers the one question every document door asks:
 * does this member row hold the staff.documents tick IN EFFECT?
 *
 * The tick (the owner's rulings, Nov 19 + Nov 20, 2026) follows
 * the established grant family (src/lib/staff.js): stored in the
 * member's own permissions, in no preset, off by default, held
 * by the owner by birth. Like its roster and clock siblings it
 * is offered for every role but takes effect only for a
 * MANAGER-level member — a staff row's stored tick stays inert,
 * enforced here, on the server, on every read and write.
 *
 * The small helpers are mirrored from server/clockAdmin.js
 * (which mirrors trainingCore/authz in turn), as elsewhere in
 * this codebase, with the source named: this module imports
 * neither workforceRoutes.js nor trainingCore.js.
 */
import { parseJsonArray, presetRoleById } from './authz.js';
import { permissionsForPlan, planFor } from './plans.js';
import { memberLevel } from './staffWindow.js';

export const STAFF_DOCUMENTS_TICK = 'staff.documents';

/** The permission set a staff row actually lives under (mirrors
 *  clockAdmin.effectivePermissions). */
function effectivePermissions(row, customRoles, planKey) {
  const stored = parseJsonArray(row?.permissions);
  if (stored.length) return permissionsForPlan(planKey, stored);
  const preset = presetRoleById(row?.role_id);
  if (preset) return permissionsForPlan(planKey, preset.permissions);
  const custom = (customRoles || []).find((role) => role.id === row?.role_id);
  if (custom) return permissionsForPlan(planKey, parseJsonArray(custom.permissions));
  return [];
}

/** True when this member row is a manager the owner trusted with
 *  the staff documents tick. The owner is not a member row —
 *  callers check access.isOwner separately, as everywhere else. */
export async function memberHasDocumentsTick(pool, business, memberRow) {
  if (!memberRow || memberLevel(memberRow) !== 'manager') return false;
  const planKey = await planFor(pool, business.id);
  const { rows: customRoles } = await pool.query(
    'SELECT * FROM staff_roles WHERE business_id = $1',
    [business.id],
  );
  return effectivePermissions(memberRow, customRoles, planKey).includes(STAFF_DOCUMENTS_TICK);
}
