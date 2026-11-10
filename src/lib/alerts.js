import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';
import { descendantIds } from '@/lib/locations';
import { fetchMovements } from '@/lib/movementHistory';
import { t } from '@/lib/i18n';

export const ALERT_KINDS = [
  {
    id: 'low_stock',
    get label() { return t('alerts.kindLowStock'); },
    defaultThreshold: 0,
    get thresholdLabel() { return t('alerts.kindLowStockThreshold'); },
    get unit() { return t('alerts.unitUnits'); },
    get hint() { return t('alerts.kindLowStockHint'); },
    sentence: (rule) =>
      Number(rule.threshold) > 0
        ? t('alerts.lowStockSentenceThreshold', { threshold: Number(rule.threshold) })
        : t('alerts.lowStockSentenceReorder'),
  },
  {
    id: 'out_of_stock',
    get label() { return t('alerts.kindOutOfStock'); },
    defaultThreshold: 0,
    thresholdLabel: '',
    unit: '',
    get hint() { return t('alerts.kindOutOfStockHint'); },
    sentence: () => t('alerts.kindOutOfStock'),
  },
  {
    id: 'overstock',
    get label() { return t('alerts.kindOverstock'); },
    defaultThreshold: 25,
    get thresholdLabel() { return t('alerts.kindOverstockThreshold'); },
    get unit() { return t('alerts.unitUnits'); },
    get hint() { return t('alerts.kindOverstockHint'); },
    sentence: (rule) => t('alerts.overstockSentence', { threshold: Number(rule.threshold) || 25 }),
  },
  {
    id: 'expiring',
    get label() { return t('alerts.kindExpiring'); },
    defaultThreshold: 30,
    get thresholdLabel() { return t('alerts.kindExpiringThreshold'); },
    get unit() { return t('alerts.unitDays'); },
    get hint() { return t('alerts.kindExpiringHint'); },
    sentence: (rule) => t('alerts.expiringSentence', { threshold: Number(rule.threshold) || 30 }),
  },
  {
    id: 'stale',
    get label() { return t('alerts.kindStale'); },
    defaultThreshold: 90,
    get thresholdLabel() { return t('alerts.kindStaleThreshold'); },
    get unit() { return t('alerts.unitDays'); },
    get hint() { return t('alerts.kindStaleHint'); },
    sentence: (rule) => t('alerts.staleSentence', { threshold: Number(rule.threshold) || 90 }),
  },
  {
    id: 'unscanned',
    get label() { return t('alerts.kindUnscanned'); },
    defaultThreshold: 60,
    get thresholdLabel() { return t('alerts.kindUnscannedThreshold'); },
    get unit() { return t('alerts.unitDays'); },
    get hint() { return t('alerts.kindUnscannedHint'); },
    sentence: (rule) => t('alerts.unscannedSentence', { threshold: Number(rule.threshold) || 60 }),
  },
];

export const ALERT_KIND_BY_ID = Object.fromEntries(ALERT_KINDS.map((kind) => [kind.id, kind]));

export const ALERT_PRESETS = [
  { get name() { return t('alerts.presetLowStock'); }, kind: 'low_stock', threshold: 0 },
  { get name() { return t('alerts.presetOutOfStock'); }, kind: 'out_of_stock', threshold: 0 },
  { get name() { return t('alerts.presetExpiring'); }, kind: 'expiring', threshold: 30 },
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
    : rule.location_name || t('alerts.allLocations');
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
  const sku = (product) => product.sku || t('alerts.noSku');

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
        detail: t('alerts.detailLowStock', { sku: sku(product), qty, point }),
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
        detail: product.supplier_name
          ? t('alerts.detailOutOfStockSupplier', { sku: sku(product), supplier: product.supplier_name })
          : t('alerts.detailOutOfStock', { sku: sku(product) }),
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
        detail: t('alerts.detailOverstock', { sku: sku(product), qty, threshold, category: product.category || t('alerts.uncategorized') }),
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
        days < 0
          ? t('alerts.expiredPastBy', { count: Math.abs(days), s: Math.abs(days) === 1 ? '' : 's' })
          : days === 0
            ? t('alerts.expiresToday')
            : t('alerts.expiresIn', { count: days, s: days === 1 ? '' : 's' });
      items.push({
        key: product.id,
        title: product.name,
        detail: t('alerts.detailExpiring', { sku: sku(product), date: product.expiration_date, when, qty }),
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
          ? t('alerts.lastScannedAgo', { age, s: age === 1 ? '' : 's' })
          : t('alerts.lastMovedAgo', { age, s: age === 1 ? '' : 's' })
        : scanned
          ? t('alerts.addedNoScanYet', { age, s: age === 1 ? '' : 's' })
          : t('alerts.addedNoMovementYet', { age, s: age === 1 ? '' : 's' });
      items.push({
        key: product.id,
        title: product.name,
        detail: t('alerts.detailStale', { sku: sku(product), qty, history }),
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