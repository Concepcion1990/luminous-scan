/**
 * All-locations rollup + cross-location push — client
 * doors (Nov 26, 2026; plan release 380: Gap 14 + the
 * Part 7 rider).
 *
 * Thin wrappers over server/locationsRollupRoutes.js. The
 * rollup is reporting over data that already exists — food
 * cost %, stock value, waste this week and what's low,
 * side by side across the businesses the owner owns. The
 * push is the managing door beside it: copy a recipe, or
 * this business's prices and costs, to the owner's other
 * locations — explicit owner actions, inside the owner's
 * own account only.
 *
 * Business-only by nature (multi-business IS Business);
 * the Locations shelf itself only appears for owners with
 * 2+ businesses.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/locations-rollup`;

export function fetchLocationsRollup(businessId) {
  return apiRequest(base(businessId));
}

export function pushRecipe(businessId, recipeId, targetBusinessIds) {
  return apiRequest(`${base(businessId)}/push-recipe`, {
    method: 'POST',
    body: { recipe_id: recipeId, target_business_ids: targetBusinessIds },
  });
}

export function pushPrices(businessId, targetBusinessIds) {
  return apiRequest(`${base(businessId)}/push-prices`, {
    method: 'POST',
    body: { target_business_ids: targetBusinessIds },
  });
}
