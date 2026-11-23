/**
 * T54 helpers — release 357, time trails (Nov 23, 2026). Boots
 * the real app via the T4 harness (pg-mem + mock Stripe) and
 * adds an entitled-owner fixture plus a staff-actor fixture in
 * the T46 shape (owner-created member row, all-week schedule,
 * so the staff bracket admits them at any test hour).
 */
import crypto from 'node:crypto';

export * from '../t4/helpers.js';
import { pool, req, registerVerifiedUser, ownerWithBusiness, setEntitlement } from '../t4/helpers.js';

/** An owner whose business is entitled (active) on a plan,
 *  with a display name the trail can resolve. */
export async function trailOwner(email, { plan = 'essentials', displayName = 'Olivia Owner' } = {}) {
  const owner = await ownerWithBusiness(email, 'Trail Shop');
  await setEntitlement(owner.business.id, { plan, status: 'active' });
  if (displayName) {
    await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [displayName, owner.user.id]);
  }
  return owner;
}

/** The preset roles' permission lists, mirroring
 *  server/authz.js — the app's own staff form stores the
 *  picked role's permissions ON the member row, and the
 *  client gates pages on that array, so the fixture does
 *  the same (a row carrying only a role id reads as a row
 *  with no permissions at all in the browser). */
const PRESET_PERMISSIONS = {
  'preset-sales': [
    'products.view', 'scan.use', 'orders.manage', 'returns.manage',
    'listings.manage', 'reports.view', 'print.use',
  ],
  'preset-viewer': ['products.view', 'reports.view', 'print.use'],
};

/** A staff member of the business who can sign in and act:
 *  owner-created row (trusted), verified account, all-week
 *  00:00–23:59 schedule (the T46 fixture shape). */
export async function trailActor(owner, { email, roleId, roleName, fullName }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      business_id: owner.business.id,
      full_name: fullName,
      email,
      role_id: roleId,
      role_name: roleName,
      permissions: PRESET_PERMISSIONS[roleId] ?? [],
    },
  });
  if (invite.status !== 201) throw new Error(`actor invite failed: ${invite.status} ${invite.text}`);
  const account = await registerVerifiedUser(email);
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [
    owner.business.id,
    account.user.id,
  ]);
  const row = (
    await pool.query('SELECT id FROM staff_members WHERE business_id = $1 AND email = $2', [
      owner.business.id,
      email,
    ])
  ).rows[0];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')`,
      [crypto.randomUUID(), owner.business.id, row.id, weekday],
    );
  }
  return { ...account, memberId: row.id };
}
