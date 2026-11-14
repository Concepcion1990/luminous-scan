/**
 * Till connections (POS), client side — POS phase.
 *
 * Thin wrappers over /api/businesses/:bid/pos/* — every rule
 * (who may connect, idempotency, matching, never-negative) is
 * decided on the server; this file only carries calls plus the
 * plain-words labels for connection / event / line outcomes.
 *
 * (Node-testable shape: the API client is imported by relative
 * path, not the `@/` alias — same note as src/lib/rewards.js.)
 */
import { apiRequest, base44 } from '../api/client.js';
import { t } from './i18n.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId)}/pos`;

export function getPosOverview(businessId) {
  return apiRequest(base(businessId) + '/overview');
}

export function listPosEvents(businessId, limit = 50) {
  return apiRequest(`${base(businessId)}/events?limit=${limit}`);
}

export function listHeldLines(businessId) {
  return apiRequest(`${base(businessId)}/unmatched`);
}

export function startSquareConnect(businessId) {
  return apiRequest(`${base(businessId)}/square/connect`, { method: 'POST', body: {} });
}

export function connectShopify(businessId, values) {
  return apiRequest(`${base(businessId)}/shopify/connect`, { method: 'POST', body: values });
}

export function startCloverConnect(businessId) {
  return apiRequest(`${base(businessId)}/clover/connect`, { method: 'POST', body: {} });
}

export function connectToast(businessId, values) {
  return apiRequest(`${base(businessId)}/toast/connect`, { method: 'POST', body: values });
}

export function connectLightspeed(businessId, values) {
  return apiRequest(`${base(businessId)}/lightspeed/connect`, { method: 'POST', body: values });
}

export function connectZettle(businessId, values) {
  return apiRequest(`${base(businessId)}/zettle/connect`, { method: 'POST', body: values });
}

export function connectStripeTerminal(businessId, values) {
  return apiRequest(`${base(businessId)}/stripe-terminal/connect`, { method: 'POST', body: values });
}

export function connectWix(businessId, values) {
  return apiRequest(`${base(businessId)}/wix/connect`, { method: 'POST', body: values });
}

export function disconnectProvider(businessId, provider) {
  return apiRequest(`${base(businessId)}/connections/${encodeURIComponent(provider)}/disconnect`, {
    method: 'POST',
    body: {},
  });
}

export function setProviderLocation(businessId, provider, locationId) {
  return apiRequest(`${base(businessId)}/connections/${encodeURIComponent(provider)}/location`, {
    method: 'POST',
    body: { location_id: locationId },
  });
}

export function savePosMapping(businessId, values) {
  return apiRequest(`${base(businessId)}/mappings`, { method: 'POST', body: values });
}

export function applyHeldForMapping(businessId, mappingId) {
  return apiRequest(`${base(businessId)}/mappings/${encodeURIComponent(mappingId)}/apply-held`, {
    method: 'POST',
    body: {},
  });
}

/** Count the sales that were held while the business was off Business. */
export function applyHeldPlanSales(businessId) {
  return apiRequest(`${base(businessId)}/apply-held-plan`, { method: 'POST', body: {} });
}

export function importPosCsv(businessId, csvText) {
  return apiRequest(`${base(businessId)}/csv-import`, { method: 'POST', body: { csv: csvText } });
}

/** Products + locations for the mapping picker and the till-location select. */
export async function listPosPickerData(businessId) {
  const [products, locations] = await Promise.all([
    base44.entities.Product.filter({ business_id: businessId }, { sort: 'name', limit: 500 }),
    base44.entities.Location.filter({ business_id: businessId }, { sort: 'name', limit: 100 }),
  ]);
  return { products, locations };
}

// ---- Plain-words labels -----------------------------------------------------

export function providerLabel(provider) {
  switch (provider) {
    case 'square':
      return t('pos.provider.square');
    case 'shopify':
      return t('pos.provider.shopify');
    case 'clover':
      return t('pos.provider.clover');
    case 'toast':
      return t('pos.provider.toast');
    case 'lightspeed':
      return t('pos.provider.lightspeed');
    case 'zettle':
      return t('pos.provider.zettle');
    case 'stripe_terminal':
      return t('pos.provider.stripeTerminal');
    case 'wix':
      return t('pos.provider.wix');
    case 'csv':
      return t('pos.provider.csv');
    default:
      return provider || '';
  }
}

export function connectionStatusLabel(status) {
  switch (status) {
    case 'connected':
      return t('pos.connection.connected');
    case 'error':
      return t('pos.connection.error');
    default:
      return t('pos.connection.notConnected');
  }
}

export function eventStatusLabel(status) {
  switch (status) {
    case 'applied':
      return t('pos.event.applied');
    case 'partially_applied':
      return t('pos.event.partial');
    case 'held_unmatched':
      return t('pos.event.held');
    case 'held_plan':
      return t('pos.event.heldPlan');
    case 'refused':
      return t('pos.event.refused');
    default:
      return status || '';
  }
}

export function lineStatusLabel(status) {
  switch (status) {
    case 'applied':
      return t('pos.line.applied');
    case 'insufficient_stock':
      return t('pos.line.insufficient');
    case 'held_plan':
      return t('pos.line.heldPlan');
    case 'ignored':
      return t('pos.line.ignored');
    default:
      return t('pos.line.unmatched');
  }
}
