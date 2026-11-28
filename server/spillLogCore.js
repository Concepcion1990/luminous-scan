/**
 * Spill & breakage log — the pure core (Nov 26, 2026;
 * plan Part 7, item 392A, owner-ruled addition).
 *
 * WHAT LIVES HERE (no database, no HTTP):
 *  - the wording constants every refusal carries (keyed
 *    in the apiErrors registry, translated ×52);
 *  - the entry cleaning: an item, a quantity spilled or
 *    broken greater than zero, a kind (spill | breakage)
 *    and the REASON — a spill without its reason is
 *    refused, the way a pulled lot is;
 *  - the pour-cost math and the OWNER-ONLY money shaping:
 *    the cost of what was lost rides a read ONLY for the
 *    owner; everyone else's row carries neither unit_cost
 *    nor total_cost, so no door can render money it was
 *    never sent (the waste log's shapeWasteMoney pattern,
 *    tightened to the owner by 392A's money ruling).
 *
 * LOSS, THE WASTE LOG'S WAY (the routes carry it out):
 * the stock-out is ONE 'write_off' movement through
 * recordMovementTx and a costed waste_entries row with
 * reason 'spill' or 'breakage' — no second depletion
 * path, no silent depletion beyond the app's existing
 * movement rules.
 *
 * FAMILY DISCIPLINE: the log lives with the bar-counting
 * family (plan release 379) — Business-only Restaurant
 * Corner, Stock & Ordering home beside bar counting, and
 * under the family's owner switch: while bar counting is
 * off for the business, the log shows nothing and takes
 * nothing (the routes enforce it with the bar family's
 * own off wording).
 */
export const SPILL_PRODUCT_MESSAGE = 'Choose the item that was spilled or broken.';
export const SPILL_QUANTITY_MESSAGE = 'Enter how much was spilled or broken — a quantity greater than zero.';
export const SPILL_REASON_MESSAGE = 'A spill or breakage needs its reason — what happened.';
export const SPILL_MESSAGE = 'Check the spill entry and try again.';

export const SPILL_KINDS = ['spill', 'breakage'];

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function cleanText(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** The pour cost of what was lost: quantity × unit cost,
 *  rounded to the cent. Null when no cost is known — the
 *  app never invents a cost it was not given. */
export function pourCost(quantity, unitCost) {
  if (unitCost === null || unitCost === undefined || unitCost === '') return null;
  const qty = Number(quantity);
  const cost = Number(unitCost);
  if (!Number.isFinite(qty) || !Number.isFinite(cost)) return null;
  return round2(qty * cost);
}

/**
 * Clean one spill entry: the item, how much was spilled
 * or broken (greater than zero), whether it was a spill
 * or a breakage, where it happened, and the reason in the
 * logger's words — the reason is REQUIRED, because the
 * reason is the record the log exists to keep.
 */
export function cleanSpillEntry(input = {}) {
  const out = {
    product_id: cleanText(input.product_id, 200),
    quantity: cleanNumber(input.quantity),
    kind: SPILL_KINDS.includes(input.kind) ? input.kind : 'spill',
    reason: cleanText(input.reason, 500),
    location_id: cleanText(input.location_id, 200) || null,
  };
  if (!out.product_id) throw err(400, 'spill_product_needed', SPILL_PRODUCT_MESSAGE);
  if (!(out.quantity > 0)) throw err(400, 'spill_quantity_needed', SPILL_QUANTITY_MESSAGE);
  if (!out.reason) throw err(400, 'spill_reason_needed', SPILL_REASON_MESSAGE);
  return out;
}

/**
 * Owner-only money shaping (392A's ruling: pour cost
 * follows the bar family's money rules — owner-only where
 * money appears). For the owner the row gains total_cost
 * (the pour cost of what was lost); for everyone else the
 * row carries NEITHER unit_cost NOR total_cost.
 */
export function publicSpill(row, isOwner) {
  const out = { ...row, quantity: Number(row.quantity) || 0 };
  if (isOwner) {
    out.unit_cost = row.unit_cost !== null && row.unit_cost !== undefined ? Number(row.unit_cost) : null;
    out.total_cost = pourCost(out.quantity, out.unit_cost);
  } else {
    delete out.unit_cost;
    delete out.total_cost;
  }
  return out;
}

/** The log's totals, from shaped rows: the pour-cost total
 *  exists only when a row carries one (the owner's read). */
export function spillTotals(entries = []) {
  const showMoney = (entries || []).some((e) => e.total_cost !== null && e.total_cost !== undefined);
  return {
    showMoney,
    totalCost: showMoney
      ? round2((entries || []).reduce((sum, e) => sum + (Number(e.total_cost) || 0), 0))
      : null,
    totalQuantity: round2((entries || []).reduce((sum, e) => sum + (Number(e.quantity) || 0), 0)),
  };
}
