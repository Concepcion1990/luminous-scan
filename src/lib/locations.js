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