/**
 * Bar counting — the core (Nov 26, 2026; plan release 379:
 * Gap 10, the no-hardware version only).
 *
 * PARTIAL-BOTTLE COUNTS: an open bottle is counted in
 * tenths — the counter slides to how full the bottle looks
 * — and a keg is recorded the same way. A line's counted
 * number is its full units plus the open one's tenths:
 * 3 full bottles and one at 7/10 is 3.7. Counts are
 * organized BY STORAGE AREA (the business's locations, in
 * the location tree's walk order, the count sheets' own
 * order since release 378).
 *
 * THE COUNT MACHINERY, NOT A SIDE SILO: saving a bar count
 * writes ONE ordinary count session (count_sessions) in
 * status 'open', its lines carrying bar_kind (bottle/keg),
 * full_units and partial_tenths beside the counted total.
 * From there the Counts page's own lifecycle runs it —
 * save, send for review, apply — and applying sets the
 * shelf through 'count' movements like any other count.
 * The counted-vs-expected differences those sessions carry
 * are the actual side of the theoretical-vs-actual
 * variance release 361 computes; nothing here recomputes
 * or duplicates it.
 *
 * ANTI-CLUTTER (the plan's rule 3): the whole section is
 * hidden until the OWNER turns it on for the business
 * (businesses.bar_counting_enabled, migration 067, off by
 * default). Only the owner flips the switch; while it is
 * off, no bar count can be saved.
 *
 * BUSINESS-ONLY: the routes sit behind the restaurant
 * corner's plan gate. Saving a count rides the counts door
 * — the owner, or a member holding `counts.run`.
 *
 * The Bluetooth-scale version needs hardware partnerships
 * — out of scope, and nothing here builds toward it.
 */
import crypto from 'node:crypto';

export const BAR_OWNER_MESSAGE = 'Only the owner can turn bar counting on or off.';
export const BAR_COUNT_MESSAGE =
  'Only the owner, a manager, or a person with the counting permission can save a bar count.';
export const BAR_MESSAGE = 'Check the bar count and try again.';
export const BAR_OFF_MESSAGE = 'Bar counting is not turned on for this business.';

export const BAR_KINDS = ['bottle', 'keg'];

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cleanText(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

/** Who may flip the bar switch: the owner, nobody else. */
export function canToggleBar(access) {
  return Boolean(access?.isOwner);
}

/** Who may save a bar count: the owner, or a member whose
 *  role/permissions carry the counts door (managers carry
 *  it by role) — the count machinery's own door. */
export function canBarCount(access) {
  if (!access) return false;
  if (access.isOwner) return true;
  return typeof access.can === 'function' ? access.can('counts.run') : false;
}

/**
 * The partial-bottle arithmetic, pure: full units (a whole
 * number, 0 or more) plus the open bottle's tenths (a
 * whole number 0–9 — the slider's stops). 3 full and 7
 * tenths is 3.7. Anything outside that shape is refused,
 * never rounded into being.
 */
export function partialCounted(fullUnits, partialTenths) {
  const full = Number(fullUnits);
  const tenths = Number(partialTenths);
  if (!Number.isInteger(full) || full < 0 || full > 100000) {
    throw err(400, 'bar_counting_invalid', BAR_MESSAGE);
  }
  if (!Number.isInteger(tenths) || tenths < 0 || tenths > 9) {
    throw err(400, 'bar_counting_invalid', BAR_MESSAGE);
  }
  return round2(full + tenths / 10);
}

/**
 * One bar count line, cleaned for the count sheet: the
 * product, whether it is counted as bottles or as kegs,
 * its full units and the open one's tenths — and the
 * counted total those make. A line with nothing counted
 * (0 full, 0 tenths) is still a real count of zero only
 * when the counter entered it; the caller decides which
 * lines were entered.
 */
export function cleanBarLine(input) {
  const productId = cleanText(input?.product_id, 120);
  const kind = cleanText(input?.kind, 20);
  if (!productId || !BAR_KINDS.includes(kind)) {
    throw err(400, 'bar_counting_invalid', BAR_MESSAGE);
  }
  const full = Number(input?.full_units);
  const tenths = Number(input?.partial_tenths);
  const counted = partialCounted(full, tenths);
  return { product_id: productId, kind, full_units: full, partial_tenths: tenths, counted };
}

/** A whole bar count, cleaned: one storage area and at
 *  least one entered line. Duplicate products on one sheet
 *  are refused — one line per product per area, like every
 *  count sheet. */
export function cleanBarCount(input) {
  const locationId = cleanText(input?.location_id, 120);
  if (!locationId) throw err(400, 'bar_counting_invalid', BAR_MESSAGE);
  const rawLines = Array.isArray(input?.lines) ? input.lines : [];
  const lines = rawLines.map(cleanBarLine);
  if (!lines.length) throw err(400, 'bar_counting_invalid', BAR_MESSAGE);
  const seen = new Set();
  for (const line of lines) {
    if (seen.has(line.product_id)) throw err(400, 'bar_counting_invalid', BAR_MESSAGE);
    seen.add(line.product_id);
  }
  return { location_id: locationId, lines };
}

/** The count-session number, the count machinery's own
 *  shape (CNT-YYMMDD-###, src/lib/counts.js countNumber). */
export function barCountNumber(now = new Date()) {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    .replace(/-/g, '')
    .slice(2);
  return `CNT-${stamp}-${String(now.getTime()).slice(-3)}`;
}

async function barEnabled(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT bar_counting_enabled FROM businesses WHERE id = $1',
    [businessId],
  );
  return rows[0]?.bar_counting_enabled === true;
}

/**
 * The bar counting read: the switch, and — only when it is
 * on — the count sheet laid out by storage area: every
 * location of the business in name order, each area's
 * stocked products with what's on record there (the
 * expected the count will be judged against). Products
 * stocked nowhere do not appear; a bar count counts what
 * the areas hold.
 */
export async function listBarCounting(pool, businessId) {
  const enabled = await barEnabled(pool, businessId);
  if (!enabled) return { enabled, areas: [] };
  const [locations, products, levels] = await Promise.all([
    pool.query('SELECT id, name FROM locations WHERE business_id = $1 ORDER BY name ASC', [businessId]),
    pool.query("SELECT id, name, sku FROM products WHERE business_id = $1 AND COALESCE(status, 'active') <> 'archived'", [businessId]),
    pool.query('SELECT product_id, location_id, quantity FROM stock_levels WHERE business_id = $1', [businessId]),
  ]);
  const byId = new Map(products.rows.map((p) => [p.id, p]));
  const areas = locations.rows.map((location) => {
    const lines = [];
    for (const level of levels.rows) {
      if (level.location_id !== location.id) continue;
      const qty = Number(level.quantity) || 0;
      if (qty <= 0) continue;
      const product = byId.get(level.product_id);
      if (!product) continue;
      lines.push({
        product_id: product.id,
        product_name: product.name,
        sku: product.sku || '',
        expected: qty,
      });
    }
    lines.sort((a, b) => (a.product_name || '').localeCompare(b.product_name || ''));
    return { id: location.id, name: location.name || '', lines };
  });
  return { enabled, areas: areas.filter((area) => area.lines.length > 0) };
}

/** The owner's switch. Owner-only is enforced in the
 *  routes; this is the write itself. */
export async function setBarCountingEnabled(pool, businessId, enabled) {
  await pool.query('UPDATE businesses SET bar_counting_enabled = $2 WHERE id = $1', [
    businessId,
    enabled === true,
  ]);
  return { enabled: enabled === true };
}

/**
 * Save a bar count: ONE ordinary count session, status
 * 'open', named for its storage area, its lines carrying
 * the partial arithmetic beside the counted total — ready
 * for the Counts page's review-and-apply lifecycle, whose
 * applied differences feed the variance. Refused whole
 * while the switch is off, and refused when the area or
 * any product is not this business's own.
 */
export async function saveBarCount(pool, businessId, input, { userId } = {}) {
  if (!(await barEnabled(pool, businessId))) {
    throw err(403, 'bar_counting_off', BAR_OFF_MESSAGE);
  }
  const clean = cleanBarCount(input);
  const { rows: locationRows } = await pool.query(
    'SELECT id, name FROM locations WHERE id = $1 AND business_id = $2',
    [clean.location_id, businessId],
  );
  const location = locationRows[0];
  if (!location) throw err(400, 'bar_counting_invalid', BAR_MESSAGE);

  const productIds = clean.lines.map((line) => line.product_id);
  const { rows: productRows } = await pool.query(
    'SELECT id, name, sku FROM products WHERE business_id = $1 AND id = ANY($2)',
    [businessId, productIds],
  );
  const byId = new Map(productRows.map((p) => [p.id, p]));
  const { rows: levelRows } = await pool.query(
    'SELECT product_id, quantity FROM stock_levels WHERE business_id = $1 AND location_id = $2',
    [businessId, location.id],
  );
  const expectedBy = new Map(levelRows.map((l) => [l.product_id, Number(l.quantity) || 0]));

  const lines = clean.lines.map((line) => {
    const product = byId.get(line.product_id);
    if (!product) throw err(400, 'bar_counting_invalid', BAR_MESSAGE);
    return {
      product_id: product.id,
      product_name: product.name,
      sku: product.sku || '',
      expected: expectedBy.get(product.id) || 0,
      counted: line.counted,
      location_id: location.id,
      location_name: location.name || '',
      bar_kind: line.kind,
      full_units: line.full_units,
      partial_tenths: line.partial_tenths,
    };
  });

  const number = barCountNumber();
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO count_sessions
       (id, business_id, number, name, status, location_id, location_name, category, scope_note, lines, notes, created_by_id)
     VALUES ($1, $2, $3, $4, 'open', $5, $6, '', 'bar', $7, '', $8)`,
    [id, businessId, number, location.name || '', location.id, location.name || '', JSON.stringify(lines), userId || null],
  );
  return { id, number, lines };
}
