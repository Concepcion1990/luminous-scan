/**
 * Staff members — T3 (plan §2.10, PR #63 + its two follow-ups).
 *
 * Invite path (the only way a StaffMember row is created on the
 * twin): the caller must manage staff here, the plan's seat cap is
 * enforced server-side, Business-only permissions are stripped on
 * Essentials (never refused — the seat itself is legitimate), and
 * created_by_id/created_by are set from the session, never the body.
 * Creation also sets the new member's own-role training (the join
 * seed in trainingCore.js), and accepting the invite at sign-in
 * re-runs that seed — a new member's training is waiting for them
 * from day one, at their own level, on either plan.
 *
 * Follow-up (a): an invited staff member reads their own row by
 * email (see the staff list handler in entities.js).
 * Follow-up (b): the business owner may delete ANY StaffMember row
 * on their own business, including attacker-created ones.
 */
import crypto from 'node:crypto';
import { limitsForPlan, permissionsForPlan, planFor, staffLimitMessage } from './plans.js';
import { parseJsonArray } from './authz.js';
import { ringBell, seedRoleTrainingForMember, userForStaffRow } from './trainingCore.js';
import { personLevel } from './workforceRoutes.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function staffSeatCount(pool, businessId) {
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM staff_members WHERE business_id = $1 AND status IN ('active', 'invited')",
    [businessId],
  );
  return rows[0]?.n ?? 0;
}

/** A seat is held by an active member or a pending invitation, never by the owner. */
export async function createStaffMember(pool, { business, planKey, caller, member, actor = null }) {
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
      throw Object.assign(new Error(staffLimitMessage(limits.staff, { neutral: business.owner_id !== caller.id })), {
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
        status, location_id, location_name, notes, personal_address, personal_phone,
        invited_at, created_by_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
      // Personal contact details (owner ruling, Nov 19, 2026):
      // stored on the record; the entity reads strip them for
      // anyone who is not the owner or a hiring manager.
      member.personal_address || '',
      member.personal_phone || '',
      now,
      caller.id,
      caller.email,
    ],
  );
  // The join seed (owner ruling, Nov 15, 2026): the new member's
  // own-role training is set from the start — assigned and waiting
  // when they first sign in. Every creation door funnels through
  // here, so every door seeds. The seed never throws, so it can
  // never fail the invite that triggered it.
  await seedRoleTrainingForMember(pool, business, rows[0], {
    planKey,
    actor: actor ?? { userId: caller.id, staffId: null, name: caller.email || '' },
  });
  return rows[0];
}

/**
 * When a user signs in (login or OTP verify) with an email that has
 * an Invited staff row anywhere, the row becomes Active — the invite
 * is accepted by signing in. No email is needed for the flip; the
 * row's provenance (owner-created) is what trusted it.
 */
/**
 * The workspace-list link (owner catch, Nov 15, 2026): the SPA's
 * workspace list, the set-active door and the switch door all read
 * business_memberships — and before this fix the ONLY production
 * insert into that table was business creation (the owner). A staff
 * member's row flipped Active at sign-in and their training seeded,
 * but no membership ever materialized, so they signed in to an
 * empty workspace list and landed on the public plans page with no
 * way in. Data access was never the gap (resolveAccess reads the
 * staff row itself) — the front door was.
 *
 * The invariant this keeps, on every sign-in: a 'member'-role
 * membership exists for exactly the businesses where the person
 * holds an ACTIVE staff row. Newly flipped rows gain theirs here;
 * rows that were already Active before this fix heal here too; and
 * a 'member' membership whose staff row is gone (removed) or no
 * longer active (suspended) is deleted, so removal stays removal.
 * 'owner' memberships are never touched. Idempotent — the
 * (business_id, user_id) unique pair makes re-runs no-ops. Fully
 * self-guarded: a membership hiccup must never fail a sign-in (the
 * verify path calls this inside its transaction).
 */
export async function ensureStaffMemberships(pool, email) {
  try {
    if (!email) return;
    const user = (
      await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email])
    ).rows[0];
    if (!user) return;
    const { rows: activeRows } = await pool.query(
      "SELECT * FROM staff_members WHERE LOWER(email) = LOWER($1) AND status = 'active'",
      [email],
    );
    for (const row of activeRows) {
      let createdBy = row.created_by_id;
      if (!createdBy) {
        const business = (
          await pool.query('SELECT owner_id FROM businesses WHERE id = $1 LIMIT 1', [row.business_id])
        ).rows[0];
        createdBy = business?.owner_id || user.id;
      }
      await pool.query(
        `INSERT INTO business_memberships (id, business_id, user_id, role, created_by_id)
         VALUES ($1, $2, $3, 'member', $4)
         ON CONFLICT (business_id, user_id) DO NOTHING`,
        [crypto.randomUUID(), row.business_id, user.id, createdBy],
      );
    }
    // Stale-link cleanup, computed in JS (the set is tiny): any
    // 'member' membership whose business has no ACTIVE staff row
    // for this person is deleted.
    const activeIds = new Set(activeRows.map((row) => row.business_id));
    const { rows: memberOf } = await pool.query(
      "SELECT business_id FROM business_memberships WHERE user_id = $1 AND role = 'member'",
      [user.id],
    );
    for (const membership of memberOf) {
      if (!activeIds.has(membership.business_id)) {
        await pool.query(
          "DELETE FROM business_memberships WHERE user_id = $1 AND business_id = $2 AND role = 'member'",
          [user.id, membership.business_id],
        );
      }
    }
  } catch (error) {
    console.error('[twin] staff membership sync failed:', error);
  }
}

export async function activateStaffRowsForEmail(pool, email) {
  if (!email) return 0;
  const { rows } = await pool.query(
    "UPDATE staff_members SET status = 'active', joined_at = NOW(), updated_at = NOW() WHERE LOWER(email) = LOWER($1) AND status = 'invited' RETURNING *",
    [email],
  );
  // The join seed rides the flip: rows created before the seed
  // existed are set at this, their first sign-in, and rows the
  // create door already seeded merge without duplicating. A seed
  // hiccup must never fail a sign-in, so each row is guarded.
  for (const row of rows) {
    try {
      const planKey = await planFor(pool, row.business_id);
      const seeded = await seedRoleTrainingForMember(pool, { id: row.business_id }, row, { planKey, actor: null });
      // When the set was already waiting from the invite, the seed
      // itself rang nothing (no account existed to ring) — so the
      // arrival gets one bell of its own. When the seed just built
      // the set here, its per-module bells already rang.
      if (!seeded.created && !seeded.extended) {
        const user = await userForStaffRow(pool, row);
        const { rows: open } = await pool.query(
          "SELECT COUNT(*)::int AS n FROM training_assignments WHERE business_id = $1 AND assignee_key = $2 AND status = 'assigned'",
          [row.business_id, row.id],
        );
        if (user && (open[0]?.n ?? 0) > 0) {
          await ringBell(pool, { id: row.business_id }, {
            recipientUserId: user.id,
            recipientStaffId: row.id,
            recipientRole: personLevel(row),
            actorName: '',
            event: 'training_assigned',
            detail: 'Your training is ready — your role\u2019s lessons are waiting for you in Training.',
          });
        }
      }
    } catch (error) {
      console.error('[twin] training seed (sign-in) failed:', error);
    }
  }
  // The front door rides the same sign-in moment as the training
  // seed: flipped rows get their workspace membership, and rows
  // that were already Active heal theirs (see ensureStaffMemberships).
  await ensureStaffMemberships(pool, email);
  return rows.length;
}

export function staffMemberPublic(row) {
  if (!row) return null;
  return {
    ...row,
    permissions: parseJsonArray(row.permissions),
  };
}
