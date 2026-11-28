/**
 * Standing orders + supplier price book — client doors
 * (Nov 26, 2026; plan release 377: Gap 8b + Q-fire 3).
 *
 * Thin wrappers over server/standingOrdersRoutes.js.
 * Business-only (the restaurant plan gate sits server-side
 * too). A standing order is a template: making a draft
 * writes ONE draft purchase order into Purchasing for the
 * owner to confirm — the app never sends an order.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/standing-orders`;

export function fetchStandingOrders(businessId) {
  return apiRequest(base(businessId));
}

export function createStandingOrder(businessId, body) {
  return apiRequest(base(businessId), { method: 'POST', body });
}

export function updateStandingOrder(businessId, standingId, body) {
  return apiRequest(`${base(businessId)}/${encodeURIComponent(standingId)}`, { method: 'PUT', body });
}

export function deleteStandingOrder(businessId, standingId) {
  return apiRequest(`${base(businessId)}/${encodeURIComponent(standingId)}`, { method: 'DELETE' });
}

export function makeStandingDraft(businessId, standingId) {
  return apiRequest(`${base(businessId)}/${encodeURIComponent(standingId)}/draft`, { method: 'POST', body: {} });
}
