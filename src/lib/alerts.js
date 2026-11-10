import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';
import { descendantIds } from '@/lib/locations';
import { fetchMovements } from '@/lib/movementHistory';

export const ALERT_KINDS = [
  {
    id: 'low_stock',
    label: 'Running low',
    defaultThreshold: 0,
    thresholdLabel: 'On hand at or below',
    unit: 'units',
    hint: 'Counts units on hand. Leave the number at 0 to use each product’s reorder point; empty shelves belong to the out-of-stock alert.',
    sentence: (rule) =>
      Number(rule.threshold) > 0
        ? `In stock but at or below ${Number(rule.threshold)} units`
        : 'In stock but at or below the reorder point',
  },
  {
    id: 'out_of_stock',
    label: 'Out of stock',
    defaultThreshold: 0,
    thresholdLabel: '',
    unit: '',
    hint: 'Products whose tracked locations hold none, without waiting for a reorder point.',
    sentence: () => 'Out of stock',
  },
  {
    id: 'overstock',
    label: 'Overstocked',
    defaultThreshold: 25,
    thresholdLabel: 'On hand at or above',
    unit: 'units',
    hint: 'Ties up cash on the shelf — useful for slow sellers and small storage.',
    sentence: (rule) => `At or above ${Number(rule.threshold) || 25} units`,
  },
  {
    id: 'expiring',
    label: 'Expiring soon',
    defaultThreshold: 30,
    thresholdLabel: 'Expires within',
    unit: 'days',
    hint: 'Products with an expiry date and stock on hand.',
    sentence: (rule) => `Expiring within ${Number(rule.threshold) || 30} days`,
  },
  {
    id: 'stale',
    label: 'Slow-moving',
    defaultThreshold: 90,
    thresholdLabel: 'No movement in',
    unit: 'days',
    hint: 'Stock on hand with no movement in the period. A product added inside the period is measured from its added date, not from an empty ledger.',
    sentence: (rule) => `No movement in ${Number(rule.threshold) || 90} days`,
  },
  {
    id: 'unscanned',
    label: 'Not scanned',
    defaultThreshold: 60,
    thresholdLabel: 'Not scanned in',
    unit: 'days',
    hint: 'Uses the scanned code kept on each stock change, so only stock handled with a scan counts. Products added inside the period are measured from their added date.',
    sentence: (rule) => `Not scanned in ${Number(rule.threshold) || 60} days`,
  },
];

export const ALERT_KIND_BY_ID = Object.fromEntries(ALERT_KINDS.map((kind) => [kind.id, kind]));

export const ALERT_PRESETS = [
  { name: 'Low stock', kind: 'low_stock', threshold: 0 },
  { name: 'Out of stock', kind: 'out_of_stock', threshold: 0 },
  { name: 'Expiring within 30 days', kind: 'expiring', threshold: 30 },
];

export function ruleCondition(rule) {
  const kind = ALERT_KIND_BY_ID[rule.kind] || ALERT_KINDS[0];
  return kind.sentence ? kind.sentence(rule) : kind.label;
}

/** "All locations · Fiction" style scope summary for a rule. */
export function ruleScope(rule) {
  const names = (rule.location_names || []).filter(Boolean);
  const place = names.length
    ? names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 3).join(', ')} +${names.length - 3}`
    : rule.location_name || 'All locations';
  return rule.category ? `${place} · ${rule.category}` : place;
}

/** Location ids a rule watches (descendants included), or null for every location. */
export function ruleLocationIds(rule, locations) {
  const chosen =
    Array.isArray(rule.location_ids) && rule.location_ids.length
      ? rule.location_ids
      : rule.location_id
        ? [rule.location_id]
        : [];
  if (!chosen.length) return null;
  const ids = new Set();
  chosen.forEach((id) => descendantIds(locations, id).forEach((child) => ids.add(child)));
  return ids;
}

/** Everything an alert needs to be evaluated, loaded once per business. */
export async function loadAlertSource(businessId, staleDays = 180) {
  const since = new Date();
  since.setDate(since.getDate() - Math.max(Number(staleDays) || 0, 30));
  const [products, levels, locations, movements] = await Promise.all([
    base44.entities.Product.filter(scoped({}, businessId), { sort: 'name', limit: 500 }),
    base44.entities.StockLevel.filter(scoped({}, businessId), { limit: 2000 }),
    base44.entities.Location.filter(scoped({}, businessId), { sort: 'name', limit: 100 }),
    fetchMovements(businessId, { since: since.toISOString(), pages: 8 }),
  ]);
  return {
    products: products.items ?? [],
    levels: levels.items ?? [],
    locations: locations.items ?? [],
    movements,
  };
}

const day = 24 * 60 * 60 * 1000;

function stockInScope(rule, source) {
  const ids = ruleLocationIds(rule, source.locations);
  const quantity = new Map();
  const tracked = new Set();
  source.levels.forEach((level) => {
    if (ids && !ids.has(level.location_id)) return;
    tracked.add(level.product_id);
    quantity.set(level.product_id, (quantity.get(level.product_id) || 0) + (level.quantity || 0));
  });
  return { quantity, tracked };
}

/**
 * Matches one rule against the current stock and ledger. Nothing is stored:
 * an alert always reflects the data as it is right now.
 */
export function evaluateRule(rule, source) {
  if (!source) return { items: [], count: 0 };
  const kind = rule.kind || 'low_stock';
  const threshold = Number(rule.threshold) || 0;
  const { quantity, tracked } = stockInScope(rule, source);
  const categoryKey = (rule.category || '').trim().toLowerCase();

  const products = source.products.filter((product) => {
    if (product.status === 'archived' || product.active === false) return false;
    if (categoryKey && (product.category || '').trim().toLowerCase() !== categoryKey) return false;
    return true;
  });

  const items = [];
  const now = Date.now();
  const onHand = (product) => quantity.get(product.id) || 0;
  const sku = (product) => product.sku || 'No SKU';

  if (kind === 'low_stock') {
    products.forEach((product) => {
      if (!tracked.has(product.id)) return;
      const point = threshold > 0 ? threshold : Number(product.reorder_point) || 0;
      if (point <= 0) return;
      const qty = onHand(product);
      // Empty shelves are the out-of-stock alert's job, not this one's.
      if (qty <= 0 || qty > point) return;
      items.push({
        key: product.id,
        title: product.name,
        detail: `${sku(product)} · ${qty} on hand / ${point} minimum`,
        value: qty,
        tone: 'default',
      });
    });
    items.sort((a, b) => a.value - b.value || a.title.localeCompare(b.title));
  }

  if (kind === 'out_of_stock') {
    products.forEach((product) => {
      if (!tracked.has(product.id)) return;
      if (onHand(product) > 0) return;
      items.push({
        key: product.id,
        title: product.name,
        detail: `${sku(product)} · nothing on hand${product.supplier_name ? ` · ${product.supplier_name}` : ''}`,
        value: 0,
        tone: 'warn',
      });
    });
    items.sort((a, b) => a.title.localeCompare(b.title));
  }

  if (kind === 'overstock' && threshold > 0) {
    products.forEach((product) => {
      const qty = onHand(product);
      if (qty < threshold) return;
      items.push({
        key: product.id,
        title: product.name,
        detail: `${sku(product)} · ${qty} on hand / ${threshold} ceiling · ${product.category || 'Uncategorized'}`,
        value: qty,
        tone: 'default',
      });
    });
    items.sort((a, b) => b.value - a.value || a.title.localeCompare(b.title));
  }

  if (kind === 'expiring') {
    const limit = now + (threshold || 30) * day;
    products.forEach((product) => {
      if (!product.expiration_date) return;
      const stamp = new Date(`${product.expiration_date}T00:00:00`).getTime();
      if (Number.isNaN(stamp) || stamp > limit) return;
      const qty = onHand(product);
      if (qty <= 0) return;
      const days = Math.ceil((stamp - now) / day);
      const when =
        days < 0 ? `past by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
          : days === 0 ? 'expires today'
          : `in ${days} day${days === 1 ? '' : 's'}`;
      items.push({
        key: product.id,
        title: product.name,
        detail: `${sku(product)} · ${product.expiration_date} · ${when} · ${qty} on hand`,
        value: days,
        tone: days <= 0 ? 'warn' : 'default',
      });
    });
    items.sort((a, b) => a.value - b.value || a.title.localeCompare(b.title));
  }

  if (kind === 'stale' || kind === 'unscanned') {
    const scanned = kind === 'unscanned';
    const window = (threshold || (scanned ? 60 : 90)) * day;
    const cutoff = now - window;
    const ids = ruleLocationIds(rule, source.locations);
    const lastSeen = new Map();
    source.movements.forEach((movement) => {
      if (ids && !ids.has(movement.location_id)) return;
      if (scanned && !(movement.scanned_code || '').trim()) return;
      const stamp = new Date(movement.created_date).getTime();
      if (Number.isNaN(stamp)) return;
      if ((lastSeen.get(movement.product_id) || 0) < stamp) lastSeen.set(movement.product_id, stamp);
    });
    products.forEach((product) => {
      const qty = onHand(product);
      if (qty <= 0) return;
      const last = lastSeen.get(product.id) || null;
      const created = product.created_date ? new Date(product.created_date).getTime() : null;
      const added = created && !Number.isNaN(created) ? created : null;
      // With no history at all, judge from when the product was added. An empty
      // ledger is not evidence of 60 quiet days — a product created this morning
      // must not be called unscanned.
      const anchor = last || added;
      if (!anchor) return;
      if (anchor > cutoff) return;
      const age = Math.floor((now - anchor) / day);
      const history = last
        ? scanned
          ? `last scanned ${age} day${age === 1 ? '' : 's'} ago`
          : `last moved ${age} day${age === 1 ? '' : 's'} ago`
        : scanned
          ? `added ${age} day${age === 1 ? '' : 's'} ago, no scan yet`
          : `added ${age} day${age === 1 ? '' : 's'} ago, no movement yet`;
      items.push({
        key: product.id,
        title: product.name,
        detail: `${sku(product)} · ${qty} on hand · ${history}`,
        value: age,
        tone: 'default',
      });
    });
    items.sort((a, b) => b.value - a.value || a.title.localeCompare(b.title));
  }

  return {
    items: items.map((item) => ({ ...item, value: item.value === Number.MAX_SAFE_INTEGER ? null : item.value })),
    count: items.length,
  };
}