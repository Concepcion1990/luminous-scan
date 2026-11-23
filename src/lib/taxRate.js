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

import { resolveStateTaxRate } from './stateTaxRates.js';

const roundCents = (value) => Math.round((Number(value) || 0) * 100) / 100;

const goodsOf = (lines) =>
  (lines || []).reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0),
    0
  );

/** The goods value an order was taxed on: its lines at their
 * ordered quantities — the same subtotal the order form's Tax
 * pre-fill multiplies (shipping is never in the taxed base,
 * and neither is the discount). */
export function orderGoodsValue(order) {
  if (!order) return 0;
  return goodsOf(order.lines);
}

/**
 * The tax on a return's goods (owner-approved Nov 18, 2026;
 * release 349). The first source is the ORIGINAL order itself:
 * its stored tax against its goods gives its effective rate,
 * and the returned goods carry their proportional share of
 * that tax — her example: a $2.50 item on an order taxed $0.14
 * refunds $2.64, not $2.50. An order whose stored tax is an
 * honest 0 (nothing was charged) yields 0 the same way.
 *
 * THE EDGE — no original order, or an original order with no
 * tax recorded (no tax figure, or no goods to derive a rate
 * from): the fallback is the business's CURRENT tax setting,
 * applied to the returned goods — in Automatic mode the state
 * base rate when the linked order's ship-to state resolves
 * through the built-in table (release 347), otherwise the
 * fixed set-once rate. The form labels which source priced
 * the tax, and the figure stays hand-editable either way.
 * No source at all → source 'none', tax 0, and the form says
 * no rate is on file. Flagged for the owner's ruling in the
 * release-349 record; she can overrule the fallback.
 *
 * Returns { tax, source, rate } — source is 'order' | 'state'
 * | 'setting' | 'none'; rate is the percent that priced it
 * (the order's effective rate for 'order'), or null.
 */
export function returnTaxInfo({ lines = [], order = null, taxRate = null, taxMode = 'fixed' } = {}) {
  const returnedGoods = goodsOf(lines);

  if (order && order.tax != null && order.tax !== '') {
    const goods = orderGoodsValue(order);
    const orderTax = Number(order.tax) || 0;
    if (goods > 0) {
      return {
        tax: roundCents((returnedGoods * orderTax) / goods),
        source: 'order',
        rate: (orderTax / goods) * 100,
      };
    }
  }

  if (taxMode === 'automatic' && order) {
    const entry = resolveStateTaxRate(order.ship_region, order.ship_country);
    if (entry) {
      return { tax: computeOrderTax(returnedGoods, entry.rate), source: 'state', rate: entry.rate };
    }
  }

  const fixed = parseTaxRate(taxRate);
  if (fixed != null) {
    return { tax: computeOrderTax(returnedGoods, fixed), source: 'setting', rate: fixed };
  }

  return { tax: 0, source: 'none', rate: null };
}
