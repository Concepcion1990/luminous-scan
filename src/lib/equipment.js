/**
 * Equipment records — client doors (Nov 26, 2026; plan
 * release 372).
 *
 * Thin wrappers over server/equipmentRoutes.js. Equipment
 * is a general feature on both plans: every member reads
 * the machines and their history (money stripped server-
 * side outside owner/manager territory); machine and
 * upkeep writes and repairs are owner/manager work;
 * reporting a breakdown rides the owner-grant
 * `equipment.report` tick for staff.
 */
import { apiRequest } from '../api/client.js';

export { photoToProofDataUrl } from './checklists.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/equipment`;

/** The machines, the business-wide due list, and the open
 *  breakdown count — money-shaped for the caller. */
export function fetchEquipmentOverview(businessId) {
  return apiRequest(base(businessId));
}

/** One machine's page: the machine, its upkeep with due
 *  states, and its history. */
export function fetchMachine(businessId, machineId) {
  return apiRequest(`${base(businessId)}/machines/${encodeURIComponent(machineId)}`);
}

export function createMachine(businessId, machine) {
  return apiRequest(`${base(businessId)}/machines`, { method: 'POST', body: machine });
}

export function updateMachine(businessId, machineId, machine) {
  return apiRequest(`${base(businessId)}/machines/${encodeURIComponent(machineId)}`, { method: 'PATCH', body: machine });
}

export function deleteMachine(businessId, machineId) {
  return apiRequest(`${base(businessId)}/machines/${encodeURIComponent(machineId)}`, { method: 'DELETE' });
}

export function createUpkeep(businessId, machineId, task) {
  return apiRequest(`${base(businessId)}/machines/${encodeURIComponent(machineId)}/upkeep`, { method: 'POST', body: task });
}

export function updateUpkeep(businessId, upkeepId, task) {
  return apiRequest(`${base(businessId)}/upkeep/${encodeURIComponent(upkeepId)}`, { method: 'PATCH', body: task });
}

export function deleteUpkeep(businessId, upkeepId) {
  return apiRequest(`${base(businessId)}/upkeep/${encodeURIComponent(upkeepId)}`, { method: 'DELETE' });
}

export function completeUpkeep(businessId, upkeepId, doneDate = null) {
  return apiRequest(`${base(businessId)}/upkeep/${encodeURIComponent(upkeepId)}/complete`, {
    method: 'POST',
    body: doneDate ? { done_date: doneDate } : {},
  });
}

/** Report a breakdown against a machine, with an optional
 *  photo (a data URL, sized by photoToProofDataUrl). */
export function reportBreakdown(businessId, machineId, report) {
  return apiRequest(`${base(businessId)}/machines/${encodeURIComponent(machineId)}/breakdowns`, { method: 'POST', body: report });
}

/** Record a repair: what was done, its cost, its outcome;
 *  may name the breakdown it answers, which then closes. */
export function recordRepair(businessId, machineId, repair) {
  return apiRequest(`${base(businessId)}/machines/${encodeURIComponent(machineId)}/repairs`, { method: 'POST', body: repair });
}
