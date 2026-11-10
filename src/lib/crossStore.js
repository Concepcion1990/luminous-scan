/**
 * Cross-store requests, client side — T6.2.
 *
 * The inbox page (src/pages/CrossStoreInbox.jsx) reads through here:
 * incoming requests (other stores asking THIS store to ship or bring
 * an item) and outgoing requests (this store's asks), and the
 * acknowledge / resolve / decline actions on an incoming request.
 * The server decides the plan rule — Essentials is refused with
 * cross_store_business_only on the create/lookup calls, and the page
 * itself never renders on Essentials (PlanGate + nav feature).
 *
 * (Node-testable: the API client is imported by relative path, not
 * the `@/` alias — see the note at the top of src/lib/syncClient.js.)
 */
import { apiRequest } from '../api/client.js';
import { t } from './i18n.js';

/** { incoming: [...], outgoing: [...] } for one business. */
export async function listCrossStoreRequests(businessId) {
  const data = await apiRequest(`/api/businesses/${encodeURIComponent(businessId)}/cross-store/requests`);
  return {
    incoming: data?.incoming ?? [],
    outgoing: data?.outgoing ?? [],
  };
}

/**
 * Answer an incoming request. `status` is one of 'acknowledged',
 * 'resolved' or 'declined'; only the target store's staff can do
 * this (the server 404s anyone else). Returns the updated request.
 */
export async function updateCrossStoreRequest(businessId, requestId, status) {
  const data = await apiRequest(
    `/api/businesses/${encodeURIComponent(businessId)}/cross-store/requests/${encodeURIComponent(requestId)}`,
    { method: 'PATCH', body: { status } },
  );
  return data?.request;
}

/** The four request states, in the order a request moves through them. */
export const CROSS_STORE_STATUSES = ['open', 'acknowledged', 'resolved', 'declined'];

export function crossStoreStatusLabel(status) {
  switch (status) {
    case 'open':
      return t('crossStoreLib.status.open');
    case 'acknowledged':
      return t('crossStoreLib.status.acknowledged');
    case 'resolved':
      return t('crossStoreLib.status.resolved');
    case 'declined':
      return t('crossStoreLib.status.declined');
    default:
      return status || t('crossStoreLib.status.unknown');
  }
}

/** Whether the staff at the receiving store can still answer this request. */
export function canAnswerCrossStoreRequest(request) {
  return request?.status === 'open' || request?.status === 'acknowledged';
}

/** 'ship' (send it over) or 'bring' (bring it over within ~2 days). */
export function crossStoreModeLabel(mode) {
  return mode === 'bring' ? t('crossStoreLib.mode.bring') : t('crossStoreLib.mode.ship');
}
