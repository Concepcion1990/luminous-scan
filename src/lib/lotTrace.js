/**
 * Lot codes, the recall finder and supplier traceability —
 * client doors (Nov 26, 2026; plan Part 7, item 392).
 *
 * Thin wrappers over server/lotTraceRoutes.js, plus the one
 * pure helper the receiving form and the batch list share:
 * the catch-weight truth — what a delivery really costs per
 * weight unit, from the weight that actually arrived.
 *
 * Business-only (the Restaurant Corner): supplier + lot are
 * captured per item at receiving, the lot rides movements,
 * a pull locks its batch and flows into the waste log, and
 * the traceability log answers by supplier or by lot.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/lot-trace`;

export function fetchLotTrace(businessId) {
  return apiRequest(base(businessId));
}

export function receiveLot(businessId, receiving) {
  return apiRequest(`${base(businessId)}/receive`, { method: 'POST', body: receiving });
}

export function logReceivingCheck(businessId, check) {
  return apiRequest(`${base(businessId)}/checks`, { method: 'POST', body: check });
}

export function pullLot(businessId, pull) {
  return apiRequest(`${base(businessId)}/pull`, { method: 'POST', body: pull });
}

export function findLot(businessId, lot) {
  return apiRequest(`${base(businessId)}/recall?lot=${encodeURIComponent(lot || '')}`);
}

export function fetchTrace(businessId, { supplier = '', lot = '' } = {}) {
  const params = new URLSearchParams();
  if (supplier) params.set('supplier', supplier);
  if (lot) params.set('lot', lot);
  const qs = params.toString();
  return apiRequest(`${base(businessId)}/trace${qs ? `?${qs}` : ''}`);
}

/** Catch-weight truth, mirrored from the server core: the
 *  total paid spread over the weight that actually arrived.
 *  Null when either side is missing — never invented. */
export function costPerWeight(totalCost, actualWeight) {
  if (totalCost === null || totalCost === undefined || totalCost === '') return null;
  const cost = Number(totalCost);
  const weight = Number(actualWeight);
  if (!Number.isFinite(cost) || !Number.isFinite(weight) || !(weight > 0)) return null;
  return Math.round(((cost / weight) + Number.EPSILON) * 100) / 100;
}

/** The product a scanned case code names: an exact match on
 *  barcode, UPC or SKU — the Corner Scanner Rule's in-place
 *  scan on the receiving surface. Null when nothing matches,
 *  so the scan never guesses. */
export function productForCode(products, code) {
  const wanted = String(code || '').trim();
  if (!wanted) return null;
  return (products || []).find(
    (p) => p.barcode === wanted || p.upc === wanted || p.sku === wanted,
  ) || null;
}
