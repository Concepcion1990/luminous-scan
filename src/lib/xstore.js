/**
 * Cross-store messages, client side (the owner's second
 * messaging door, Nov 23, 2026).
 *
 * Thin wrappers over /api/businesses/:bid/xstore/* — the
 * business in the path is only the door the caller walked
 * through; every rule (the Business gate, the account scope,
 * the two-participant privacy, the owner read-receipt
 * exception) is decided on the server. This file only carries
 * calls.
 *
 * (Node-testable shape: the API client is imported by relative
 * path, not the `@/` alias — same note as src/lib/workforce.js.)
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId)}/xstore`;

export function listXstorePeople(businessId) {
  return apiRequest(`${base(businessId)}/people`);
}

export function listXstoreThreads(businessId) {
  return apiRequest(`${base(businessId)}/threads`);
}

export function startXstoreThread(businessId, userId) {
  return apiRequest(`${base(businessId)}/threads`, { method: 'POST', body: { user_id: userId } });
}

export function getXstoreThread(businessId, threadId) {
  return apiRequest(`${base(businessId)}/threads/${encodeURIComponent(threadId)}`);
}

export function postXstoreMessage(businessId, threadId, body) {
  return apiRequest(`${base(businessId)}/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body: { body },
  });
}

export function postXstoreVoiceMessage(businessId, threadId, dataUrl, durationMs) {
  return apiRequest(`${base(businessId)}/threads/${encodeURIComponent(threadId)}/voice`, {
    method: 'POST',
    body: { dataUrl, duration_ms: durationMs },
  });
}

/** The private file route for one voice note's recording. The
 * browser's media element carries the session cookie itself
 * (same-origin); the server re-checks conversation access. */
export function xstoreVoiceNoteFileUrl(businessId, threadId, messageId) {
  return `${base(businessId)}/threads/${encodeURIComponent(threadId)}/voice/${encodeURIComponent(messageId)}/file`;
}

export function markXstoreThreadRead(businessId, threadId) {
  return apiRequest(`${base(businessId)}/threads/${encodeURIComponent(threadId)}/read`, {
    method: 'PATCH',
    body: {},
  });
}

export function getXstoreUnread(businessId) {
  return apiRequest(`${base(businessId)}/unread`);
}

/** The account photo route: an approved photo of one person in
 * this account, served to account members only. Used as an
 * <img> src (the session cookie rides along, same-origin). */
export function xstorePhotoFileUrl(businessId, userId) {
  return `${base(businessId)}/people/${encodeURIComponent(userId)}/photo`;
}
