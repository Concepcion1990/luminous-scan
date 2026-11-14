/**
 * The default location (Nov 14, 2026) — no business may sit at
 * zero locations. The owner hit the wall live: her fresh test
 * business had NO location at all, so every stock picker was an
 * empty dropdown whose only answer was "Choose where this stock
 * sits" — a dead end. Her ruling: the store location simply IS
 * there from the start (Essentials has one location: the store).
 *
 * Three doors guarantee it, all idempotent:
 *  - business creation seeds it in the same transaction
 *    (server/authRoutes.js);
 *  - migration 021 backfilled every existing zero-location
 *    business at deploy;
 *  - ensureDefaultLocation() heals at runtime if a business is
 *    ever found with none (e.g. all locations deleted) — called
 *    from the Location list path.
 * A business that HAS locations is never touched.
 */

/** Fallback only — the default location normally carries the business's own name. */
export const DEFAULT_LOCATION_NAME = 'Main location';

/** The deterministic id is how the app knows a location is the business's default. */
export function defaultLocationId(businessId) {
  return `default-${businessId}`;
}

export async function ensureDefaultLocation(pool, businessId, createdById = null) {
  if (!pool || !businessId) return;
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM locations WHERE business_id = $1',
    [businessId],
  );
  if ((rows[0]?.n ?? 0) > 0) return;
  // The default location takes its identity from the business
  // (Nov 14, 2026): it is named with the business's name as
  // recorded in Settings, so the owner never types their store
  // in twice.
  const biz = await pool.query('SELECT name FROM businesses WHERE id = $1', [businessId]);
  const locationName = (biz.rows[0]?.name || '').trim() || DEFAULT_LOCATION_NAME;
  await pool.query(
    `INSERT INTO locations (id, business_id, name, kind, created_by_id)
     VALUES ($1, $2, $3, 'store', $4)
     ON CONFLICT (id) DO NOTHING`,
    [defaultLocationId(businessId), businessId, locationName, createdById],
  );
}
