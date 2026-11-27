/**
 * Tip pooling + tip reporting records — client doors
 * (Nov 26, 2026; plan release 373 + its records rider).
 *
 * Thin wrappers over server/tipPoolingRoutes.js. Business-
 * only (the restaurant plan gate sits server-side too).
 * Everything but my-shares is owner-only money: the page
 * reads the overview, which for a non-owner carries only
 * that member's own published shares.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/tips`;

export function fetchTipsOverview(businessId) {
  return apiRequest(base(businessId));
}

export function saveTipSettings(businessId, settings) {
  return apiRequest(`${base(businessId)}/settings`, { method: 'PUT', body: settings });
}

export function previewTipSplit(businessId, body) {
  return apiRequest(`${base(businessId)}/preview`, { method: 'POST', body });
}

export function saveTipRun(businessId, body) {
  return apiRequest(`${base(businessId)}/runs`, { method: 'POST', body });
}

export function setTipRunPublished(businessId, runId, published) {
  return apiRequest(`${base(businessId)}/runs/${encodeURIComponent(runId)}/publish`, {
    method: 'PATCH',
    body: { published },
  });
}

export function deleteTipRun(businessId, runId) {
  return apiRequest(`${base(businessId)}/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
}

export function createTipReportPeriod(businessId, body) {
  return apiRequest(`${base(businessId)}/report-periods`, { method: 'POST', body });
}

export function deleteTipReportPeriod(businessId, periodId) {
  return apiRequest(`${base(businessId)}/report-periods/${encodeURIComponent(periodId)}`, { method: 'DELETE' });
}

export function saveTipReport(businessId, periodId, staffId, body) {
  return apiRequest(
    `${base(businessId)}/report-periods/${encodeURIComponent(periodId)}/reports/${encodeURIComponent(staffId)}`,
    { method: 'PUT', body },
  );
}

export function deleteTipReport(businessId, periodId, staffId) {
  return apiRequest(
    `${base(businessId)}/report-periods/${encodeURIComponent(periodId)}/reports/${encodeURIComponent(staffId)}`,
    { method: 'DELETE' },
  );
}

export function fetchTipYear(businessId, year) {
  return apiRequest(`${base(businessId)}/year?year=${encodeURIComponent(year)}`);
}
