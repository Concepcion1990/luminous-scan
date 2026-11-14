/**
 * Clearance + rollback pricing — the effective-price derivation
 * (migration 018, Nov 13, 2026).
 *
 * The owner's design, in her Walmart words:
 *   * CLEARANCE is a permanent markdown: pricing_mode 'clearance'
 *     with a clearance_price — it stays down until changed back.
 *   * ROLLBACK is a temporary sale: pricing_mode 'rollback' with a
 *     sale_price and start/end calendar dates. The regular price
 *     (`price`) is retained untouched the whole time and shown
 *     alongside; when the end date passes, the effective price
 *     returns to regular BY ITSELF — that is exactly what deriving
 *     the price from the window (here, at render time) guarantees.
 *     No daily job, no stale state.
 *
 * Dates are calendar dates (YYYY-MM-DD) in the viewer's local
 * calendar: a rollback runs whole days, like a shelf-edge sale sign.
 * Either bound may be empty — no start means "already running", no
 * end means "runs until changed".
 *
 * Business-only on the server (pricing_business_only on writes;
 * reads off-Business arrive pre-stripped to defaults), so everything
 * here simply renders what the row says.
 */

function dateOnly(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function todayOnly(now) {
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

/**
 * The full price picture for a product right now:
 * { mode, effective, regular, onSale, active, start, end }
 * mode is the stored pricing_mode; `active` says whether a rollback
 * window covers today; `onSale` says the effective price is a real
 * markdown below the regular price.
 */
export function priceInfo(product, now = new Date()) {
  const regular = numberOrNull(product?.price) ?? 0;
  const mode = product?.pricing_mode || 'regular';

  if (mode === 'clearance') {
    const clearance = numberOrNull(product?.clearance_price);
    if (clearance !== null) {
      return {
        mode,
        effective: clearance,
        regular,
        onSale: clearance < regular,
        active: true,
        start: null,
        end: null,
      };
    }
  }

  if (mode === 'rollback') {
    const sale = numberOrNull(product?.sale_price);
    const start = dateOnly(product?.sale_start);
    const end = dateOnly(product?.sale_end);
    if (sale !== null) {
      const today = todayOnly(now);
      const active = (!start || today >= start) && (!end || today <= end);
      return {
        mode,
        effective: active ? sale : regular,
        regular,
        onSale: active && sale < regular,
        active,
        start,
        end,
      };
    }
  }

  return { mode: 'regular', effective: regular, regular, onSale: false, active: false, start: null, end: null };
}

/** Just the price a customer pays / a label prints, right now. */
export function effectivePrice(product, now = new Date()) {
  return priceInfo(product, now).effective;
}
