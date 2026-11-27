/**
 * Checklists — client doors (Nov 26, 2026; plan release 369).
 *
 * Thin wrappers over server/checklistsRoutes.js. Checklists
 * are a general feature on both plans: every member of the
 * business reads the day's lists and ticks items off (plain
 * staff work, no tick needed); template writes ride the
 * owner-grant `checklists.manage` tick server-side.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/checklists`;

/** The device's local day as YYYY-MM-DD — the business's
 *  "today" for checklist runs. */
export function localRunDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's instances (materialised server-side) with each
 *  item's completion and the day's progress. */
export function fetchChecklistToday(businessId, date = localRunDate()) {
  return apiRequest(`${base(businessId)}/today?date=${encodeURIComponent(date)}`);
}

/** Recent days' instances: who did what, and what's missing. */
export function fetchChecklistHistory(businessId, { date = localRunDate(), days = 14 } = {}) {
  return apiRequest(`${base(businessId)}/history?date=${encodeURIComponent(date)}&days=${days}`);
}

/** The business's templates, plus whether the caller may
 *  manage them (owner, or the checklists.manage tick). */
export function fetchChecklistTemplates(businessId) {
  return apiRequest(`${base(businessId)}/templates`);
}

export function createChecklistTemplate(businessId, template) {
  return apiRequest(`${base(businessId)}/templates`, { method: 'POST', body: template });
}

export function updateChecklistTemplate(businessId, templateId, template) {
  return apiRequest(`${base(businessId)}/templates/${encodeURIComponent(templateId)}`, { method: 'PATCH', body: template });
}

export function deleteChecklistTemplate(businessId, templateId) {
  return apiRequest(`${base(businessId)}/templates/${encodeURIComponent(templateId)}`, { method: 'DELETE' });
}

/** Tick one item off, carrying the proof the item requires
 *  (a photo data URL, a scanned code, or a typed temperature). */
export function completeChecklistItem(businessId, instanceId, itemId, proofValue = null) {
  return apiRequest(
    `${base(businessId)}/instances/${encodeURIComponent(instanceId)}/items/${encodeURIComponent(itemId)}/complete`,
    { method: 'POST', body: { proof_value: proofValue } },
  );
}

export function uncompleteChecklistItem(businessId, instanceId, itemId) {
  return apiRequest(
    `${base(businessId)}/instances/${encodeURIComponent(instanceId)}/items/${encodeURIComponent(itemId)}/uncomplete`,
    { method: 'POST', body: {} },
  );
}

/**
 * Downscale a picked photo to a proof-sized JPEG data URL
 * (max 900px on the long side) — proof that the work was
 * seen, not a gallery print, so the completion row stays
 * small. Resolves null when the file is not a readable image.
 */
export function photoToProofDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
