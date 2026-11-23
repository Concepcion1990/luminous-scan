/**
 * Location nesting helpers. A location may sit inside another one
 * (warehouse → shelf → bin), so every list that shows stock has to know
 * the tree: a parent reports its own units plus everything stored inside it.
 */

export function buildLocationTree(locations = []) {
  const byId = new Map(locations.map((location) => [location.id, location]));
  const childrenByParent = new Map();
  const roots = [];
  locations.forEach((location) => {
    const parentId = location.parent_id && byId.has(location.parent_id) ? location.parent_id : '';
    if (parentId && parentId !== location.id) {
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(location);
    } else {
      roots.push(location);
    }
  });
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  roots.sort(byName);
  childrenByParent.forEach((list) => list.sort(byName));
  return { byId, childrenByParent, roots };
}

/** Flat list in tree order, with the depth each location sits at. */
export function orderedLocations(locations = []) {
  const { childrenByParent, roots } = buildLocationTree(locations);
  const out = [];
  const walk = (nodes, depth) => {
    nodes.forEach((location) => {
      out.push({ location, depth });
      walk(childrenByParent.get(location.id) || [], depth + 1);
    });
  };
  walk(roots, 0);
  return out;
}

/** The id itself plus every location nested under it. */
export function descendantIds(locations = [], id) {
  if (!id) return [];
  const { childrenByParent } = buildLocationTree(locations);
  const out = [];
  const walk = (nodeId) => {
    out.push(nodeId);
    (childrenByParent.get(nodeId) || []).forEach((child) => walk(child.id));
  };
  walk(id);
  return out;
}

export function locationLabel(location) {
  if (!location) return '';
  return location.parent_name ? `${location.parent_name} · ${location.name}` : location.name;
}

/** Full trail for a nested place: "Warehouse › Shelf A › Bin 3". */
export function locationPath(location, byId) {
  if (!location) return '';
  const parts = [];
  const seen = new Set();
  let current = location;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parent_id ? byId?.get(current.parent_id) : null;
  }
  return parts.join(' › ');
}

/** Locations that may become the parent of `locationId` (never itself or its own children). */
export function parentCandidates(locations = [], locationId = '') {
  const blocked = new Set(descendantIds(locations, locationId));
  return orderedLocations(locations).filter(({ location }) => !blocked.has(location.id));
}

/**
 * Shipping origins (owner ruling, Nov 23, 2026): an order ships
 * FROM a place the business operates — a store, warehouse or
 * other top-level site — never from a shelf, bin or van nested
 * inside one. "It should only be their business name on there."
 * The kind list mirrors OPERATING_SITE_KINDS in
 * src/lib/entitlements.js (isOperatingSite, the one site
 * predicate); the two are pinned against each other in
 * tests/t49 so they cannot drift apart. The helpers live here,
 * beside the other nesting helpers, so the rule stays
 * importable without the app client.
 */
const SHIP_FROM_KINDS = ['store', 'warehouse', 'other'];

export function isShipFromLocation(location) {
  if (!location) return false;
  return !location.parent_id && SHIP_FROM_KINDS.includes(location.kind || 'store');
}

/** The first shipping origin in list order — a new order's default. */
export function firstShipFromLocation(locations = []) {
  return locations.find(isShipFromLocation) || null;
}

/**
 * The Ships-from picker's options: every operating site, in list
 * order. A stored value that is no longer a site (a legacy order
 * whose ships-from names a shelf) is appended once, so the order
 * keeps showing — and saving — exactly what it already holds
 * until the owner picks a site instead. Nothing is rewritten
 * behind the owner's back.
 */
export function shipFromLocations(locations = [], storedId = '') {
  const sites = locations.filter(isShipFromLocation);
  const stored = storedId ? locations.find((location) => location.id === storedId) : null;
  if (stored && !sites.some((location) => location.id === stored.id)) return [...sites, stored];
  return sites;
}