/**
 * The food-safety file, completed — client side (Nov 26,
 * 2026; plan release 370, Gap 6 + the round-2 riders).
 *
 * Thin wrappers over /api/businesses/:bid/food-safety/* —
 * every rule (the staff.documents tick pattern on the
 * certificates, the staff-readable SDS shelf, the Business
 * gate) is decided on the server; this file only carries the
 * calls and the small shared judgements the pages render:
 * each safety-log kind's expected range (mirroring
 * server/foodSafetyCore.js SAFETY_RANGES — the server judges
 * again at save, so a client can never stand a missed reading
 * as in range) and the certificate classes.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) =>
  `/api/businesses/${encodeURIComponent(businessId)}/food-safety`;

export function listFoodCerts(businessId) {
  return apiRequest(`${base(businessId)}/certs`);
}

export function listMyFoodCerts(businessId) {
  return apiRequest(`${base(businessId)}/certs/mine`);
}

export function addFoodCert(businessId, memberId, values) {
  return apiRequest(`${base(businessId)}/certs/${encodeURIComponent(memberId)}`, {
    method: 'POST',
    body: values,
  });
}

export function removeFoodCert(businessId, certId) {
  return apiRequest(`${base(businessId)}/certs/${encodeURIComponent(certId)}`, {
    method: 'DELETE',
  });
}

export function listSdsSheets(businessId) {
  return apiRequest(`${base(businessId)}/sds`);
}

export function addSdsSheet(businessId, values) {
  return apiRequest(`${base(businessId)}/sds`, { method: 'POST', body: values });
}

export function removeSdsSheet(businessId, sheetId) {
  return apiRequest(`${base(businessId)}/sds/${encodeURIComponent(sheetId)}`, {
    method: 'DELETE',
  });
}

export function sdsSheetFileUrl(businessId, sheetId) {
  return `${base(businessId)}/sds/${encodeURIComponent(sheetId)}/file`;
}

export function attachPestReport(businessId, visitId, values) {
  return apiRequest(`${base(businessId)}/pest/${encodeURIComponent(visitId)}/report`, {
    method: 'POST',
    body: values,
  });
}

export function pestReportFileUrl(businessId, visitId) {
  return `${base(businessId)}/pest/${encodeURIComponent(visitId)}/file`;
}

/** The ice-point judgement, the server's way
 *  (server/foodSafetyCore.js calibrationOutcome): a
 *  thermometer in ice water must read 32 °F / 0 °C — at the
 *  ice point the check passes; anything else was adjusted. */
export function calibrationOutcome(reading, unit) {
  const value = reading === null || reading === undefined || reading === '' ? NaN : Number(reading);
  if (!Number.isFinite(value)) return 'adjusted';
  const judged = unit === 'F' ? Math.round(((value - 32) * 5) / 9) : value;
  return judged === 0 ? 'pass' : 'adjusted';
}

export function startMockInspection(businessId, values) {
  return apiRequest(`${base(businessId)}/mock-inspection`, {
    method: 'POST',
    body: values,
  });
}

/** The safety-log kinds, in shelf order. */
export const SAFETY_LOG_KINDS = ['cooling', 'reheating', 'sanitizer'];

/** Each kind's expected range, judged as the server judges:
 *  temperatures in Celsius (converted from F), sanitizer in
 *  ppm. Mirrors server/foodSafetyCore.js SAFETY_RANGES. */
export const SAFETY_RANGES = {
  cooling: { judge: 'C', min: null, max: 5 },
  reheating: { judge: 'C', min: 74, max: null },
  sanitizer: { judge: 'ppm', min: 50, max: 100 },
};

export function safetyLogInRange(kind, reading, unit) {
  const range = SAFETY_RANGES[kind];
  const value = reading === null || reading === undefined || reading === '' ? NaN : Number(reading);
  if (!range || !Number.isFinite(value)) return false;
  let judged = value;
  // Fahrenheit converts and rounds to the whole degree a
  // thermometer reads, so the canonical pair agrees: 41 °F
  // is 5 °C and 165 °F is 74 °C, not a hair under either.
  if (range.judge === 'C' && unit === 'F') judged = Math.round(((value - 32) * 5) / 9);
  if (range.min != null && judged < range.min) return false;
  if (range.max != null && judged > range.max) return false;
  return true;
}

/** The certificate classes (the round-2 widened family):
 *  labels live in the locales under foodSafety.certs.class.*. */
export const CERT_CLASSES = ['food_handler', 'servsafe_manager', 'alcohol_server', 'other'];

/** A certificate's standing, computed the server's way
 *  (server/foodSafetyCore.js certStatus) for rows the client
 *  already holds: expired / expiring (30 days) / ok / none. */
export function certStatus(expiresOn, today = new Date()) {
  const raw = String(expiresOn || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'none';
  const day = today.toISOString().slice(0, 10);
  if (raw < day) return 'expired';
  const days = Math.round(
    (new Date(`${raw}T12:00:00Z`).getTime() - new Date(`${day}T12:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000),
  );
  return days <= 30 ? 'expiring' : 'ok';
}
