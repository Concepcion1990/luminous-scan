import { apiRequest, base44 } from '../api/client.js';

/**
 * Storefront connections client (release 362) — the eBay
 * door. A storefront is NOT a till: the owner's ruling
 * (Nov 23, 2026) puts storefront connections on BOTH plans,
 * so this page renders the same on Essentials and Business.
 * The server is the authority either way (server/ebayRoutes.js);
 * credentials never reach the client — the overview carries
 * the connection's public shape only.
 */

export async function getStorefrontOverview(businessId) {
  return apiRequest(`/businesses/${businessId}/storefronts/overview`);
}

export async function connectEbay(businessId) {
  return apiRequest(`/businesses/${businessId}/storefronts/ebay/connect`, { method: 'POST', body: {} });
}

export async function disconnectEbay(businessId) {
  return apiRequest(`/businesses/${businessId}/storefronts/ebay/disconnect`, { method: 'POST', body: {} });
}

export async function setEbayLocation(businessId, locationId) {
  return apiRequest(`/businesses/${businessId}/storefronts/ebay/location`, {
    method: 'POST',
    body: { location_id: locationId || '' },
  });
}

export async function checkEbayNow(businessId) {
  return apiRequest(`/businesses/${businessId}/storefronts/ebay/check-now`, { method: 'POST', body: {} });
}

export async function saveStorefrontMapping(businessId, { providerItemKey, productId }) {
  return apiRequest(`/businesses/${businessId}/storefronts/mappings`, {
    method: 'POST',
    body: { provider_item_key: providerItemKey, product_id: productId },
  });
}

export async function applyHeldStorefrontSales(businessId, mappingId) {
  return apiRequest(`/businesses/${businessId}/storefronts/mappings/${mappingId}/apply-held`, {
    method: 'POST',
    body: {},
  });
}

/** Products + locations for the page's pickers (same source the till page uses). */
export async function listStorefrontPickerData(businessId) {
  const [products, locations] = await Promise.all([
    base44.entities.Product.filter({ business_id: businessId }, { sort: 'name', limit: 500 }),
    base44.entities.Location.filter({ business_id: businessId }, { sort: 'name', limit: 100 }),
  ]);
  return { products, locations };
}
