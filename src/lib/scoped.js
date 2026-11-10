/**
 * Business scoping helpers. Every inventory, purchasing and supplier query is
 * filtered by the active business id, so records never mix between workspaces.
 */

export function scoped(query = {}, businessId) {
  if (!businessId) return query;
  const keys = Object.keys(query);
  const logical = keys.some((key) => key === '$or' || key === '$and' || key === '$nor');
  return logical
    ? { $and: [query, { business_id: businessId }] }
    : { ...query, business_id: businessId };
}

export function withBusiness(values = {}, businessId) {
  return businessId ? { ...values, business_id: businessId } : values;
}