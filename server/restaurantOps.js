/**
 * Restaurant operations — pure helpers (release 361,
 * Nov 23, 2026).
 *
 * The server-side kitchen arithmetic that has no shelf of
 * its own: parsing the products table's new JSON columns
 * (allergens, unit_conversions — TEXT columns that may also
 * arrive already parsed), the supplier invoice 3-way match
 * (what was ordered vs what arrived vs what was billed),
 * and the vendor price-alert scan the invoice hooks run.
 * Everything here is pure — no pool, no transaction — so the
 * entity layer shapes reads and writes with it and tests can
 * pin the math directly. The client mirror for previews
 * lives in src/lib/restaurantOps.js; THIS copy is
 * authoritative on read.
 */
import { parseJsonArray } from './authz.js';
import { parseUnitConversions } from './recipes.js';

/** A product's allergen keys: [] when none recorded. Accepts
 *  the TEXT column, a JSON string, or a parsed array. */
export function parseAllergens(product) {
  const raw = product?.allergens;
  if (Array.isArray(raw)) return raw.filter((key) => typeof key === 'string' && key);
  return parseJsonArray(raw).filter((key) => typeof key === 'string' && key);
}

/** A product's unit conversions ([{unit, per}]) — the
 *  recipes.js parser, re-exported so ops callers have one
 *  door for both kitchen columns. */
export function parseConversions(product) {
  return parseUnitConversions(product);
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * The 3-way match between a supplier invoice and the
 * purchase order it bills. Per invoice line: ordered = the
 * PO line's qty_ordered, received = its qty_received,
 * invoiced = the billed quantity; unit costs are compared
 * the same way. A line's flag, in the order a bookkeeper
 * checks them:
 *   not_ordered — the product is not on the PO at all;
 *   price_diff  — billed unit cost ≠ the PO line's unit cost;
 *   short       — invoiced less than what was received;
 *   over        — invoiced more than what was received;
 *   ok          — quantity and price agree with the receipt.
 * Lines on the PO that the invoice never bills ride along
 * flagged 'not_invoiced' with invoiced 0, so a missing line
 * is visible instead of silent. `overall` is 'matched' only
 * when every line is ok, else 'differences'. An invoice
 * with no PO (or a PO with no lines) matches as null-po
 * shape: callers only invoke this when purchase_order_id
 * is set; a missing PO row yields overall 'no_po'.
 */
export function computeInvoiceMatch(invoice, po) {
  if (!invoice) return null;
  if (!po) return { lines: [], overall: 'no_po' };
  const poLines = Array.isArray(po.lines) ? po.lines : parseJsonArray(po.lines);
  const invoiceLines = Array.isArray(invoice.lines) ? invoice.lines : parseJsonArray(invoice.lines);
  const poByProduct = new Map();
  for (const line of poLines) {
    if (line?.product_id && !poByProduct.has(line.product_id)) poByProduct.set(line.product_id, line);
  }
  const lines = [];
  const billed = new Set();
  for (const line of invoiceLines) {
    const productId = line?.product_id || '';
    const invoicedQty = Number(line?.quantity) || 0;
    const invoicedCost = line?.unit_cost === null || line?.unit_cost === undefined ? null : Number(line.unit_cost);
    const poLine = productId ? poByProduct.get(productId) : undefined;
    billed.add(productId);
    if (!poLine) {
      lines.push({
        product_id: productId,
        product_name: line?.product_name || '',
        ordered: 0,
        received: 0,
        invoiced: invoicedQty,
        ordered_unit_cost: null,
        invoiced_unit_cost: invoicedCost,
        flag: 'not_ordered',
      });
      continue;
    }
    const ordered = Number(poLine.qty_ordered) || 0;
    const received = Number(poLine.qty_received) || 0;
    const orderedCost = poLine.unit_cost === null || poLine.unit_cost === undefined ? null : Number(poLine.unit_cost);
    let flag = 'ok';
    if (invoicedCost !== null && orderedCost !== null && round2(invoicedCost) !== round2(orderedCost)) {
      flag = 'price_diff';
    } else if (invoicedQty < received) {
      flag = 'short';
    } else if (invoicedQty > received) {
      flag = 'over';
    }
    lines.push({
      product_id: productId,
      product_name: line?.product_name || poLine.product_name || '',
      ordered,
      received,
      invoiced: invoicedQty,
      ordered_unit_cost: orderedCost,
      invoiced_unit_cost: invoicedCost,
      flag,
    });
  }
  for (const poLine of poLines) {
    if (!poLine?.product_id || billed.has(poLine.product_id)) continue;
    lines.push({
      product_id: poLine.product_id,
      product_name: poLine.product_name || '',
      ordered: Number(poLine.qty_ordered) || 0,
      received: Number(poLine.qty_received) || 0,
      invoiced: 0,
      ordered_unit_cost: poLine.unit_cost === null || poLine.unit_cost === undefined ? null : Number(poLine.unit_cost),
      invoiced_unit_cost: null,
      flag: 'not_invoiced',
    });
  }
  const overall = lines.length && lines.every((line) => line.flag === 'ok') ? 'matched' : 'differences';
  return { lines, overall };
}

/**
 * An invoice's own total for credit-cap purposes (release
 * 378): the stored total when the invoice carries one, else
 * the sum of its lines (quantity × unit cost). An invoice
 * always has one or the other — the dialog writes the total
 * from the same lines — but a total of zero is a total of
 * zero: no credit fits against it.
 */
export function invoiceTotalForCredit(invoice) {
  if (!invoice) return 0;
  if (invoice.total !== null && invoice.total !== undefined && invoice.total !== '') {
    const stored = Number(invoice.total);
    if (Number.isFinite(stored)) return round2(stored);
  }
  const lines = Array.isArray(invoice.lines) ? invoice.lines : parseJsonArray(invoice.lines);
  return round2(
    lines.reduce((sum, line) => sum + (Number(line?.quantity) || 0) * (Number(line?.unit_cost) || 0), 0),
  );
}

/**
 * The credit standing of one invoice (release 378): how much
 * of it supplier credit memos have covered, and how much is
 * still owed. Only 'applied' memos count — a voided memo is
 * kept on the record but covers nothing. `excludeId` lets an
 * update weigh the invoice without the memo being saved
 * counting against itself. Pure: the entity validator and
 * the read shaping both take their numbers from here, and
 * the client mirror (src/lib/restaurantOps.js) agrees.
 */
export function creditStanding(invoice, memos, excludeId = '') {
  if (!invoice) return { total: 0, credited: 0, owed: 0 };
  const total = invoiceTotalForCredit(invoice);
  const credited = round2(
    (memos || [])
      .filter((memo) => memo && memo.status !== 'void' && memo.id !== excludeId)
      .reduce((sum, memo) => sum + (Number(memo.amount) || 0), 0),
  );
  return { total, credited, owed: round2(total - credited) };
}

/**
 * The price-alert scan for one invoice (used by the
 * SupplierInvoice create/update hooks in server/entities.js):
 * given the invoice's lines and a lookup of the business's
 * products (Map or plain object, id -> row), return one
 * candidate per line whose billed unit_cost differs from
 * the product's CURRENT cost — { product_id, product_name,
 * old_cost, new_cost }. Lines naming no product, products
 * the lookup doesn't know, and lines with no billed cost
 * produce nothing. Duplicate suppression (an open alert for
 * the same invoice + product) is the hook's job — it owns
 * the table; this helper only does the comparison.
 */
export function priceAlertCandidates(invoice, productsById) {
  const getFrom = (id) => {
    if (!id) return null;
    if (productsById instanceof Map) return productsById.get(id) ?? null;
    return productsById?.[id] ?? null;
  };
  const invoiceLines = Array.isArray(invoice?.lines) ? invoice.lines : parseJsonArray(invoice?.lines);
  const out = [];
  const seen = new Set();
  for (const line of invoiceLines) {
    const productId = line?.product_id || '';
    if (!productId || seen.has(productId)) continue;
    const product = getFrom(productId);
    if (!product) continue;
    if (line.unit_cost === null || line.unit_cost === undefined || line.unit_cost === '') continue;
    const newCost = Number(line.unit_cost);
    if (!Number.isFinite(newCost)) continue;
    const oldCost = product.cost === null || product.cost === undefined ? null : Number(product.cost);
    if (oldCost !== null && round2(oldCost) === round2(newCost)) continue;
    seen.add(productId);
    out.push({
      product_id: productId,
      product_name: line.product_name || product.name || '',
      old_cost: oldCost,
      new_cost: newCost,
    });
  }
  return out;
}
