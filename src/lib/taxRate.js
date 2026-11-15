/**
 * The set-once sales tax rate (owner ruling, Nov 15, 2026).
 * One business-level percentage lives in Settings; every NEW
 * sales order pre-fills its Tax as items subtotal × rate
 * (shipping is NOT taxed by the auto-calc). The order's Tax
 * stays hand-editable on that order and never writes back.
 * No rate set = orders behave exactly as before.
 */

/** The stored rate text as a number, or null when unset/invalid. */
export function parseTaxRate(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value <= 100 ? value : null;
}

/** The rate for display: 8.2500 reads as 8.25, 8 reads as 8. */
export function formatTaxRate(raw) {
  const value = parseTaxRate(raw);
  if (value == null) return '';
  return String(value);
}

/**
 * Tax for an items subtotal at a rate percent, rounded to the
 * cent: $4.99 at 8.25% is $0.41. Null rate = no auto tax (0 is
 * returned so callers can leave the field exactly as it was).
 */
export function computeOrderTax(subtotal, rate) {
  const value = typeof rate === 'number' ? rate : parseTaxRate(rate);
  if (value == null) return 0;
  const base = Number(subtotal) || 0;
  return Math.round(base * value) / 100;
}
