/**
 * Profile photos — shared reads (Nov 21, 2026).
 *
 * The data half of the owner's profile-photo rulings (Nov 19,
 * 2026); the HTTP surface lives in server/profilePhotoRoutes.js
 * and the Messages integration in server/workforceRoutes.js.
 *
 * The one law everything here serves: a pending photo is
 * INVISIBLE. Only approved bytes ever leave the server for a
 * client surface (header, Staff list, Messages), and the single
 * read that may return pending bytes is the owner's own approval
 * view on the Staff page. These helpers therefore expose approved
 * state as booleans + the approved-file route only; pending bytes
 * are read inside profilePhotoRoutes.js, behind the owner check.
 */

export const OWNER_PERSON_KEY = 'owner';

/** The word every surface falls back to until the owner sets a
 *  name — the fallback is the label itself, never a blank. */
export const OWNER_FALLBACK_NAME = 'Owner';

/** The owner's display name for one business, resolved live from
 *  the owner's account: the name they set, or null (callers fall
 *  back to OWNER_FALLBACK_NAME). */
export async function ownerDisplayName(pool, business) {
  if (!business?.owner_id) return null;
  const { rows } = await pool.query(
    'SELECT display_name FROM users WHERE id = $1 LIMIT 1',
    [business.owner_id],
  );
  const name = String(rows[0]?.display_name || '').trim();
  return name || null;
}

/** The name a surface should print for the owner of a business. */
export async function ownerPublicName(pool, business) {
  return (await ownerDisplayName(pool, business)) || OWNER_FALLBACK_NAME;
}

/**
 * Attribution name map (owner's email-exposure rule, Nov 21,
 * 2026): email → display name for everyone in one business — the
 * owner under their set name (or "Owner"), each member under
 * their staff name. Read paths that serve attribution fields to
 * a non-owner resolve a stored EMAIL through this map (legacy
 * rows written before attribution was stamped with names);
 * a value that is not an email passes through untouched, and an
 * email that matches nobody resolves to '' so the line drops
 * instead of printing an address.
 */
export async function attributionNameMap(pool, business) {
  const map = new Map();
  const { rows } = await pool.query(
    'SELECT email, full_name FROM staff_members WHERE business_id = $1',
    [business.id],
  );
  for (const row of rows) {
    if (row.email) map.set(String(row.email).toLowerCase(), row.full_name);
  }
  const { rows: ownerRows } = await pool.query(
    'SELECT email FROM users WHERE id = $1 LIMIT 1',
    [business.owner_id],
  );
  if (ownerRows[0]?.email) {
    map.set(String(ownerRows[0].email).toLowerCase(), await ownerPublicName(pool, business));
  }
  return map;
}

/** One attribution value through the map (see above). */
export function attributionName(map, value) {
  if (typeof value !== 'string' || !value.includes('@')) return value;
  return map.get(value.trim().toLowerCase()) || '';
}

/**
 * Which people in one business hold an APPROVED photo, as a Set of
 * person keys ('owner' or a staff member id). One query for the
 * whole business, so list surfaces (Messages threads, the Staff
 * page) never pay a read per person. Pending photos contribute
 * nothing here — by design they cannot be seen.
 */
export async function approvedPhotoKeys(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT person_key FROM profile_photos WHERE business_id = $1 AND approved_data IS NOT NULL',
    [businessId],
  );
  return new Set(rows.map((row) => row.person_key));
}
