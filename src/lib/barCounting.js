/**
 * Bar counting — client doors + the partial arithmetic
 * (Nov 26, 2026; plan release 379: Gap 10, no-hardware).
 *
 * Thin wrappers over server/barCountingRoutes.js, plus the
 * one pure helper the page and the print share: a line's
 * counted total is its full units plus the open bottle's
 * tenths — the counter slides to how full the bottle
 * looks. Kegs are recorded the same way. A saved bar count
 * is an ordinary count session: review and apply run on
 * the Counts page, and the applied differences feed the
 * theoretical-vs-actual variance (release 361).
 *
 * Business-only, and the section stays hidden until the
 * owner turns it on for the business (migration 067).
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/bar-counting`;

export function fetchBarCounting(businessId) {
  return apiRequest(base(businessId));
}

export function toggleBarCounting(businessId, enabled) {
  return apiRequest(`${base(businessId)}/toggle`, { method: 'POST', body: { enabled } });
}

export function saveBarCount(businessId, count) {
  return apiRequest(`${base(businessId)}/count`, { method: 'POST', body: count });
}

/** Full units plus the open one's tenths: 3 full and a
 *  bottle at 7/10 counts 3.7. Non-numbers count as zero —
 *  the page's live preview only; the server refuses
 *  anything out of shape when the count is saved. */
export function partialCounted(fullUnits, partialTenths) {
  const full = Number(fullUnits) || 0;
  const tenths = Number(partialTenths) || 0;
  return Math.round((full + tenths / 10 + Number.EPSILON) * 100) / 100;
}

/** The bottle picture's fill: the open bottle's tenths as
 *  a 0–1 fraction for the SVG fill height. */
export function bottleFill(tenths) {
  const t = Math.min(9, Math.max(0, Number(tenths) || 0));
  return t / 10;
}
