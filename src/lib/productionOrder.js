/**
 * Order by production — client doors (Nov 26, 2026; plan
 * release 378: Gap 8c).
 *
 * Thin wrappers over server/productionOrderRoutes.js.
 * Business-only (the restaurant plan gate sits server-side
 * too). A production plan becomes DRAFT purchase orders in
 * Purchasing for the owner to confirm — the app never
 * sends an order on its own.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/production-order`;

export function fetchProductionSources(businessId) {
  return apiRequest(base(businessId));
}

export function planProductionOrder(businessId, source) {
  return apiRequest(`${base(businessId)}/plan`, { method: 'POST', body: source });
}

export function makeProductionDrafts(businessId, source) {
  return apiRequest(`${base(businessId)}/draft`, { method: 'POST', body: source });
}
