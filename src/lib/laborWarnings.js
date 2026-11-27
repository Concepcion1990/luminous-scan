/**
 * Labor target + overtime/break warnings — client doors
 * (Nov 26, 2026; plan release 374, Gap 13, Q4).
 *
 * Thin wrappers over server/laborWarningsRoutes.js. The
 * warnings are general (both plans); the labor-target
 * fields ride the same response only on plans with the
 * restaurant feature — the server strips them otherwise.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/labor-watch`;

export function fetchLaborWatch(businessId) {
  return apiRequest(base(businessId));
}

export function saveLaborWatchSettings(businessId, settings) {
  return apiRequest(`${base(businessId)}/settings`, { method: 'PUT', body: settings });
}
