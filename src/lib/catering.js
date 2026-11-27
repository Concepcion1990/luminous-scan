/**
 * Catering & private events, the simple version — client
 * doors (Nov 26, 2026; plan release 375, Gap 11).
 *
 * Thin wrappers over server/cateringRoutes.js. Business-
 * only (the restaurant plan gate sits server-side too).
 * Deposits and balances are owner-only money: they ride a
 * response only for the owner, so a non-owner's rows simply
 * have no money fields to show.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/catering`;

export function fetchCateringBook(businessId) {
  return apiRequest(base(businessId));
}

export function createCateringEvent(businessId, body) {
  return apiRequest(base(businessId), { method: 'POST', body });
}

export function updateCateringEvent(businessId, eventId, body) {
  return apiRequest(`${base(businessId)}/${encodeURIComponent(eventId)}`, { method: 'PUT', body });
}

export function deleteCateringEvent(businessId, eventId) {
  return apiRequest(`${base(businessId)}/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
}

export function fetchEventPrep(businessId, eventId) {
  return apiRequest(`${base(businessId)}/${encodeURIComponent(eventId)}/prep`);
}

export function fetchUpcomingEventPrep(businessId, today) {
  const query = today ? `?today=${encodeURIComponent(today)}` : '';
  return apiRequest(`${base(businessId)}/prep/upcoming${query}`);
}
