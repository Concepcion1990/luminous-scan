/**
 * The barcode pool — client doors (Nov 25, 2026).
 *
 * Thin wrappers over server/barcodePoolRoutes.js: the owner
 * mints house codes into the business's pool from the Print
 * section, and the scanner asks whether a code it could not
 * match is one of the business's own printed codes waiting to
 * be claimed.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/barcode-pool`;

/** Mint `count` new codes into the pool. Resolves
 *  { codes, total, waiting } — the codes are in the pool
 *  whether or not they are ever printed. */
export function mintPoolCodes(businessId, count) {
  return apiRequest(`${base(businessId)}/mint`, { method: 'POST', body: { count } });
}

/** The pool at a glance: { total, waiting }. */
export function fetchPoolSummary(businessId) {
  return apiRequest(base(businessId));
}

/** Is this code one of THIS business's pool codes, and has a
 *  product claimed it? Resolves { pool, claimed, code? }. A
 *  code from another business's pool resolves pool:false. */
export function checkPoolCode(businessId, code) {
  return apiRequest(`${base(businessId)}/check?code=${encodeURIComponent(code || '')}`);
}

/** A minted code as a generic label payload — the same payload
 *  every label path (browser print, client PDF, Bluetooth, USB)
 *  already speaks, so a pool label flows through the existing
 *  machinery untouched. The business name rides as the title:
 *  the label is the store's own, printed ahead of the product. */
export function poolCodeLabel(code, businessName = '') {
  return { title: String(businessName || ''), lines: [], code: String(code || ''), codeType: 'CODE128' };
}
