/**
 * Staff members — T3 (plan §2.10, PR #63 + its two follow-ups).
 *
 * Invite path (the only way a StaffMember row is created on the
 * twin): the caller must manage staff here, the plan's seat cap is
 * enforced server-side, Business-only permissions are stripped on
 * Essentials (never refused — the seat itself is legitimate), and
 * created_by_id/created_by are set from the session, never the body.
 *
 * Follow-up (a): an invited staff member reads their own row by
 * email (see the staff list handler in entities.js).
 * Follow-up (b): the business owner may delete ANY StaffMember row
 * on their own business, including attacker-created ones.
 */
import crypto from 'node:crypto';
import { limitsForPlan, permissionsForPlan, staffLimitMessage } from './plans.js';
import { parseJsonArray } from './authz.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function staffSeatCount(pool, businessId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM staff_members WHERE business_id = $1 AND status IN ('active', 'invited')",
    [businessId],
  );
  return rows[0]?.n ?? 0;
}

/** A seat is held by an active member or a pending invitation, never by the owner. */
export async function createStaffMember(pool, { business, planKey, caller, member }) {
  const fullName = String(member.full_name || '').trim();
  const email = String(member.email || '').trim().toLowerCase();
  if (!fullName || !email || !EMAIL_RE.test(email)) {
    throw Object.assign(new Error('A name and a valid email are required.'), { status: 400, code: 'invalid_member' });
  }
  const status = ['active', 'invited', 'suspended'].includes(member.status) ? member.status : 'invited';
  const holdsSeat = status === 'active' || status === 'invited';
  const limits = limitsForPlan(planKey);
  if (holdsSeat && limits.staff != null) {
    const used = await staffSeatCount(pool, business.id);
    if (used >= limits.staff) {
      throw Object.assign(new Error(staffLimitMessage(limits.staff)), {
        status: 403,
        code: 'staff_limit',
        limit: limits.staff,
        used,
      });
    }
  }
  const existing = (
    await pool.query(
      "SELECT id, status FROM staff_members WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1",
      [business.id, email],
    )
  ).rows[0];
  if (existing && ['active', 'invited'].includes(existing.status)) {
    throw Object.assign(new Error('That email already has a staff record on this business.'), {
      status: 409,
      code: 'staff_exists',
    });
  }
  const permissions = permissionsForPlan(planKey, member.permissions);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { rows } = await pool.query(
    `INSERT INTO staff_members
       (id, business_id, full_name, email, app_role, role_id, role_name, permissions,
        status, location_id, location_name, notes, invited_at, created_by_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      id,
      business.id,
      fullName,
      email,
      member.app_role || 'user',
      member.role_id || null,
      member.role_name || '',
      JSON.stringify(permissions),
      status,
      member.location_id || null,
      member.location_name || '',
      member.notes || '',
      now,
      caller.id,
      caller.email,
    ],
  );
  return rows[0];
}

/**
 * When a user signs in (login or OTP verify) with an email that has
 * an Invited staff row anywhere, the row becomes Active — the invite
 * is accepted by signing in. No email is needed for the flip; the
 * row's provenance (owner-created) is what trusted it.
 */
export async function activateStaffRowsForEmail(pool, email) {
  if (!email) return 0;
  const { rowCount } = await pool.query(
    "UPDATE staff_members SET status = 'active', joined_at = NOW(), updated_at = NOW() WHERE LOWER(email) = LOWER($1) AND status = 'invited'",
    [email],
  );
  return rowCount ?? 0;
}

export function staffMemberPublic(row) {
  if (!row) return null;
  return {
    ...row,
    permissions: parseJsonArray(row.permissions),
  };
}
