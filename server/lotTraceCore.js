/**
 * Lot codes, the recall finder and supplier traceability —
 * the pure core (Nov 26, 2026; plan Part 7, item 392:
 * round-2 Gap 7 + the receiving riders + the owner-ruled
 * SUPPLIER TRACEABILITY strengthening).
 *
 * WHAT LIVES HERE (no database, no HTTP):
 *  - the wording constants every refusal carries (keyed in
 *    the apiErrors registry, translated ×52);
 *  - the back-door cleaning: a receiving record (supplier +
 *    lot PER ITEM, quantity, catch weight, delivery temp,
 *    refusal), a pull, and a receiving check, each refused
 *    kindly when its shape is wrong;
 *  - catch-weight math: the true cost per weight unit from
 *    the weight that actually arrived;
 *  - the RECALL FINDER's answer shape: given the business's
 *    batches, movements, pulls and waste rows, answer for
 *    one lot — do we have any of it, where is it, did any
 *    of it move, was any of it pulled or wasted;
 *  - the TRACEABILITY LOG's lines: pick a supplier or a lot
 *    and see where it went — receivings in, movements,
 *    pulls, waste and receiving checks, oldest first, one
 *    line each, in the shape the Studio print reads.
 *
 * HONEST SIZING (the plan's own words, carried in the
 * feature's copy): this is the restaurant's recall drill,
 * NOT distributor-grade FSMA 204 KDE/CTE record-keeping.
 */
export const LOT_STOCK_DOOR_MESSAGE =
  'Only the owner, a manager, or a person with the stock-building permission can record a delivery or pull a lot.';
export const LOT_PRODUCT_MESSAGE = 'Choose the product this delivery belongs to.';
export const LOT_CODE_MESSAGE = 'A delivery needs its lot code — read it off the stamp on the case.';
export const LOT_QUANTITY_MESSAGE = 'Enter how much arrived — a quantity greater than zero.';
export const LOT_BATCH_MESSAGE = 'That batch is not in this business.';
export const LOT_ALREADY_PULLED_MESSAGE = 'This lot has already been pulled.';
export const LOT_PULL_REASON_MESSAGE =
  'A pulled lot needs its reason — the health department and the supplier will ask for it.';
export const LOT_REFUSAL_REASON_MESSAGE = 'A refused delivery needs the reason it was refused.';
export const LOT_FINDER_MESSAGE = 'Type the lot code you are looking for.';
export const LOT_WEIGHT_MESSAGE = 'The actual weight must be greater than zero when it is recorded.';

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

/**
 * Catch-weight truth: a case billed at a total cost whose
 * ACTUAL weight is what arrived costs total ÷ weight per
 * weight unit. Null when either side is missing — the app
 * never invents a per-pound cost it was not given.
 */
export function costPerWeight(totalCost, actualWeight) {
  if (totalCost === null || totalCost === undefined || totalCost === '') return null;
  const cost = Number(totalCost);
  const weight = Number(actualWeight);
  if (!Number.isFinite(cost) || !Number.isFinite(weight) || !(weight > 0)) return null;
  return round2(cost / weight);
}

/**
 * Clean one receiving record (the back-door delivery). The
 * supplier and the lot are PER ITEM (traceability piece 1):
 * a delivery of three items is three receivings, each with
 * its own supplier + lot. A REFUSED delivery records no
 * stock — only its check row — so quantity and lot are not
 * demanded of it; an accepted one needs product, lot and a
 * quantity greater than zero. The catch weight is optional
 * but, when present, must be a real weight.
 */
export function cleanReceiving(input = {}) {
  const refused = input.refused === true;
  const out = {
    product_id: cleanText(input.product_id, 200),
    supplier_id: cleanText(input.supplier_id, 200),
    supplier_name: cleanText(input.supplier_name, 200),
    lot_code: cleanText(input.lot_code, 120),
    location_id: cleanText(input.location_id, 200) || null,
    quantity: cleanNumber(input.quantity),
    expires_on: cleanText(input.expires_on, 20) || null,
    actual_weight: cleanNumber(input.actual_weight),
    weight_unit: cleanText(input.weight_unit, 20),
    temperature: cleanNumber(input.temperature),
    scale: input.scale === 'C' ? 'C' : 'F',
    refused,
    refusal_reason: cleanText(input.refusal_reason, 500),
    note: cleanText(input.note, 500),
  };
  if (!out.product_id) throw err(400, 'lot_product_needed', LOT_PRODUCT_MESSAGE);
  if (refused) {
    if (!out.refusal_reason) throw err(400, 'lot_refusal_reason_needed', LOT_REFUSAL_REASON_MESSAGE);
    return out;
  }
  if (!out.lot_code) throw err(400, 'lot_code_needed', LOT_CODE_MESSAGE);
  if (!(out.quantity > 0)) throw err(400, 'lot_quantity_needed', LOT_QUANTITY_MESSAGE);
  if (out.actual_weight !== null && !(out.actual_weight > 0)) {
    throw err(400, 'lot_weight_needed', LOT_WEIGHT_MESSAGE);
  }
  return out;
}

/** Clean one standalone receiving check (a temperature or a
 *  refusal logged without a full receiving record). A check
 *  names its product and, for a refusal, its reason; the
 *  lot and quantity demands belong to the receiving door,
 *  because a check is evidence, not stock. */
export function cleanReceivingCheck(input = {}) {
  const refused = input.refused === true;
  const out = {
    product_id: cleanText(input.product_id, 200),
    supplier_id: cleanText(input.supplier_id, 200),
    supplier_name: cleanText(input.supplier_name, 200),
    lot_code: cleanText(input.lot_code, 120),
    location_id: cleanText(input.location_id, 200) || null,
    quantity: cleanNumber(input.quantity),
    expires_on: cleanText(input.expires_on, 20) || null,
    actual_weight: cleanNumber(input.actual_weight),
    weight_unit: cleanText(input.weight_unit, 20),
    temperature: cleanNumber(input.temperature),
    scale: input.scale === 'C' ? 'C' : 'F',
    refused,
    refusal_reason: cleanText(input.refusal_reason, 500),
    note: cleanText(input.note, 500),
  };
  if (!out.product_id) throw err(400, 'lot_product_needed', LOT_PRODUCT_MESSAGE);
  if (refused && !out.refusal_reason) throw err(400, 'lot_refusal_reason_needed', LOT_REFUSAL_REASON_MESSAGE);
  if (out.actual_weight !== null && !(out.actual_weight > 0)) {
    throw err(400, 'lot_weight_needed', LOT_WEIGHT_MESSAGE);
  }
  return out;
}

/** Clean one lot pull: the reason is the record — a pull
 *  without it is refused, because the reason is what the
 *  health department and the supplier ask for afterward. */
export function cleanPull(input = {}) {
  const reason = cleanText(input.reason, 500);
  if (!reason) throw err(400, 'lot_pull_reason_needed', LOT_PULL_REASON_MESSAGE);
  return { batch_id: cleanText(input.batch_id, 200), reason };
}

/** The lot a finder search names, cleaned; empty refuses. */
export function cleanLotQuery(value) {
  const lot = cleanText(value, 120);
  if (!lot) throw err(400, 'lot_finder_needed', LOT_FINDER_MESSAGE);
  return lot;
}

const sameLot = (row, lot) => String(row?.lot_code || '').trim().toLowerCase() === lot.toLowerCase();

/**
 * THE RECALL FINDER's answer for one lot: every batch that
 * carries it (with its place and its pulled/active state),
 * the on-hand total of the ACTIVE batches, every movement
 * that carried the lot, the pulls, and the waste rows the
 * lot flowed into. One search answers the three questions:
 * do we have any of that lot, where is it, did any of it
 * move?
 */
export function recallAnswer({ batches = [], movements = [], pulls = [], waste = [] } = {}, lot) {
  const lotBatches = (batches || []).filter((b) => sameLot(b, lot));
  const lotMovements = (movements || []).filter((m) => sameLot(m, lot));
  const lotPulls = (pulls || []).filter((p) => sameLot(p, lot));
  const lotWaste = (waste || []).filter((w) => sameLot(w, lot));
  const onHand = lotBatches
    .filter((b) => (b.status || 'active') !== 'pulled')
    .reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
  return {
    lot,
    found: lotBatches.length > 0 || lotMovements.length > 0 || lotPulls.length > 0 || lotWaste.length > 0,
    batches: lotBatches,
    onHand: round2(onHand),
    movements: lotMovements,
    pulls: lotPulls,
    waste: lotWaste,
  };
}

/**
 * THE TRACEABILITY LOG's lines (traceability piece 2): pick
 * a supplier or a lot (or both) and see where it went.
 * Every source row becomes one line — a receiving (its
 * batch), a movement, a pull, a waste row, a receiving
 * check — shaped { at, kind, product_name, lot_code,
 * supplier_name, location_name, quantity, detail } and
 * sorted oldest first, the order the Studio print reads.
 */
export function traceLines({ batches = [], movements = [], pulls = [], waste = [], checks = [] } = {}, { supplier = '', lot = '' } = {}) {
  const wantSupplier = cleanText(supplier, 200).toLowerCase();
  const wantLot = cleanText(lot, 120).toLowerCase();
  const matches = (row) => {
    if (wantLot && !sameLot(row, wantLot)) return false;
    if (wantSupplier) {
      const name = String(row?.supplier_name || '').trim().toLowerCase();
      const id = String(row?.supplier_id || '').trim().toLowerCase();
      if (name !== wantSupplier && id !== wantSupplier) return false;
    }
    return true;
  };
  const lines = [];
  for (const b of batches || []) {
    if (!matches(b)) continue;
    lines.push({
      at: b.created_at || null, kind: 'receiving', product_name: b.product_name || '', lot_code: b.lot_code || '',
      supplier_name: b.supplier_name || '', location_name: b.location_name || '', quantity: Number(b.quantity) || 0,
      detail: b.status === 'pulled' ? 'pulled' : 'received',
    });
  }
  for (const m of movements || []) {
    if (!matches(m)) continue;
    lines.push({
      at: m.created_at || null, kind: 'movement', product_name: m.product_name || '', lot_code: m.lot_code || '',
      supplier_name: m.supplier_name || '', location_name: m.location_name || '', quantity: Number(m.quantity) || 0,
      detail: m.type || '',
    });
  }
  for (const p of pulls || []) {
    if (!matches(p)) continue;
    lines.push({
      at: p.created_at || null, kind: 'pull', product_name: p.product_name || '', lot_code: p.lot_code || '',
      supplier_name: p.supplier_name || '', location_name: p.location_name || '', quantity: Number(p.quantity) || 0,
      detail: p.reason || '',
    });
  }
  for (const w of waste || []) {
    if (!matches(w)) continue;
    lines.push({
      at: w.created_at || null, kind: 'waste', product_name: w.product_name || '', lot_code: w.lot_code || '',
      supplier_name: '', location_name: w.location_name || '', quantity: Number(w.quantity) || 0,
      detail: w.reason || '',
    });
  }
  for (const c of checks || []) {
    if (!matches(c)) continue;
    lines.push({
      at: c.created_at || null, kind: 'check', product_name: c.product_name || '', lot_code: c.lot_code || '',
      supplier_name: c.supplier_name || '', location_name: c.location_name || '', quantity: 0,
      detail: c.refused ? (c.refusal_reason || 'refused') : (c.temperature !== null && c.temperature !== undefined ? `${c.temperature}°${c.scale || 'F'}` : ''),
    });
  }
  lines.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  return lines;
}
