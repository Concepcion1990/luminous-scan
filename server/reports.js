/**
 * Advanced reports, server-side — T5 (plan §2.11, §7 Phase T5).
 *
 * Mirrors src/lib/reports.js (buildReport / loadReportSource) so the
 * figures the Reports page shows and the figures the server exports
 * are counted from the same records, by the same rules — including
 * the missing-money rule: a figure nobody entered is not a figure
 * of zero; units counted without one are tracked as `missing.units`
 * and left out of the money totals.
 *
 * Report types: stock (snapshot), movements, sales, receipts,
 * losses. Groupings: product, category, location, type, supplier,
 * user. Movement history is capped at MOVEMENT_CAP entries (newest
 * first) and the cap is reported, never hidden.
 */
import { MOVEMENT_TYPES } from './movements.js';

export const REPORT_TYPES = [
  { id: 'stock', label: 'Stock on hand', valueLabel: 'Cost value', snapshot: true, defaultGroup: 'location', groups: ['location', 'category', 'product', 'supplier'] },
  { id: 'movements', label: 'Movement activity', valueLabel: 'Cost moved', defaultGroup: 'type', groups: ['type', 'location', 'category', 'product', 'user'] },
  { id: 'sales', label: 'Units sold', valueLabel: 'Sale value', defaultGroup: 'product', groups: ['product', 'category', 'location', 'user'], types: ['sale'] },
  { id: 'receipts', label: 'Receipts', valueLabel: 'Cost received', defaultGroup: 'supplier', groups: ['supplier', 'product', 'category', 'location'], types: ['receive'] },
  { id: 'losses', label: 'Losses & corrections', valueLabel: 'Value affected', defaultGroup: 'type', groups: ['type', 'product', 'category', 'location', 'user'], types: ['damaged', 'lost', 'write_off', 'correction', 'count'] },
];

export const GROUPINGS = {
  product: 'Product',
  category: 'Category',
  location: 'Location',
  type: 'Movement type',
  supplier: 'Supplier',
  user: 'Recorded by',
};

/** How much ledger history a report reads, newest first. */
export const MOVEMENT_CAP = 12 * 500;

export function reportDefinition(reportId) {
  return REPORT_TYPES.find((report) => report.id === reportId) || REPORT_TYPES[0];
}

export async function loadReportSource(pool, businessId) {
  const [products, levels, locations, movements] = await Promise.all([
    pool.query('SELECT * FROM products WHERE business_id = $1 ORDER BY name ASC LIMIT 5000', [businessId]),
    pool.query('SELECT * FROM stock_levels WHERE business_id = $1 LIMIT 20000', [businessId]),
    pool.query('SELECT * FROM locations WHERE business_id = $1 ORDER BY name ASC LIMIT 1000', [businessId]),
    pool.query(
      `SELECT * FROM stock_movements WHERE business_id = $1 ORDER BY created_at DESC LIMIT ${MOVEMENT_CAP + 1}`,
      [businessId],
    ),
  ]);
  const rows = movements.rows;
  return {
    products: products.rows,
    levels: levels.rows,
    locations: locations.rows,
    movements: rows.slice(0, MOVEMENT_CAP),
    movementsCapped: rows.length > MOVEMENT_CAP,
  };
}

const liveProduct = (product) => product.status !== 'archived' && product.active !== false;

function within(dateValue, from, to) {
  if (!dateValue) return false;
  const time = new Date(dateValue).getTime();
  if (Number.isNaN(time)) return false;
  if (from && time < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && time > new Date(`${to}T23:59:59.999`).getTime()) return false;
  return true;
}

/** A count or correction stores an absolute quantity, so its size is the change it made. */
function movedUnits(movement) {
  if (MOVEMENT_TYPES[movement.type]?.direction === 'set') {
    return Math.abs((movement.new_qty ?? 0) - (movement.previous_qty ?? 0));
  }
  return Math.abs(movement.quantity || 0);
}

function movedValue(reportId, movement, product, units) {
  if (reportId === 'sales') return units * (product?.price || 0);
  if (reportId === 'receipts') return units * (movement.unit_cost || product?.cost || 0);
  return units * (product?.cost || 0);
}

function descendantIds(locations, locationId) {
  const children = new Map();
  locations.forEach((location) => {
    const parent = location.parent_id || '';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(location.id);
  });
  const out = new Set([locationId]);
  const walk = (id) => {
    (children.get(id) || []).forEach((child) => {
      if (!out.has(child)) {
        out.add(child);
        walk(child);
      }
    });
  };
  walk(locationId);
  return out;
}

function locationPath(location, locationById) {
  if (!location) return '';
  const parts = [location.name];
  let parent = location.parent_id ? locationById.get(location.parent_id) : null;
  while (parent) {
    parts.unshift(parent.name);
    parent = parent.parent_id ? locationById.get(parent.parent_id) : null;
  }
  return parts.join(' › ');
}

function resolveGroup(groupBy, { product, location, movement }, locationById) {
  switch (groupBy) {
    case 'product':
      return {
        key: product?.id || 'unknown',
        label: product?.name || movement?.product_name || 'Unknown product',
        sub: product?.sku || movement?.sku || '',
      };
    case 'category': {
      const name = (product?.category || '').trim();
      return { key: name.toLowerCase() || 'uncategorized', label: name || 'Uncategorized', sub: '' };
    }
    case 'location':
      return {
        key: location?.id || movement?.location_id || 'unknown',
        label: location ? locationPath(location, locationById) : movement?.location_name || 'Unknown location',
        sub: '',
      };
    case 'type':
      return {
        key: movement?.type || 'unknown',
        label: MOVEMENT_TYPES[movement?.type]?.label || movement?.type || 'Unknown type',
        sub: '',
      };
    case 'supplier': {
      const name = movement?.supplier_name || product?.supplier_name || '';
      return { key: name || 'none', label: name || 'No supplier', sub: '' };
    }
    case 'user':
      return {
        key: movement?.user_name || 'none',
        label: movement?.user_name || 'Not recorded',
        sub: '',
      };
    default:
      return { key: 'all', label: 'All records', sub: '' };
  }
}

/**
 * Builds one report's rows from already-loaded records. Same
 * algorithm as src/lib/reports.js buildReport — the two must agree
 * (tests compare the server report against the server export).
 */
export function buildServerReport({ reportId, groupBy, source, from = '', to = '', locationId = '', category = '' }) {
  if (!source) return null;
  const report = reportDefinition(reportId);
  const resolvedGroup = report.groups.includes(groupBy) ? groupBy : report.defaultGroup;

  const scopeIds = locationId ? descendantIds(source.locations, locationId) : null;
  const categoryKey = (category || '').trim().toLowerCase();
  const productById = new Map(source.products.map((product) => [product.id, product]));
  const locationById = new Map(source.locations.map((location) => [location.id, location]));

  const matchesCategory = (product) => {
    if (!categoryKey) return true;
    if (!product) return false;
    return (product.category || '').trim().toLowerCase() === categoryKey;
  };

  // Money is known only when a figure was actually entered. A missing
  // figure is NOT zero: Number(null) is 0, so the raw value is checked
  // first — the same rule as src/lib/reports.js and server/exportData.js.
  const moneyKnown = (value) =>
    value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const missing = { units: 0, label: report.id === 'sales' ? 'retail price' : 'cost' };

  const buckets = new Map();
  const add = (group, units, value) => {
    const entry = buckets.get(group.key) || {
      key: group.key,
      label: group.label,
      sub: group.sub || '',
      count: 0,
      units: 0,
      value: 0,
    };
    entry.count += 1;
    entry.units += units;
    entry.value += value;
    if (!entry.sub && group.sub) entry.sub = group.sub;
    buckets.set(group.key, entry);
  };

  if (report.snapshot) {
    source.levels.forEach((level) => {
      if (scopeIds && !scopeIds.has(level.location_id)) return;
      const product = productById.get(level.product_id);
      if (!product || !liveProduct(product) || !matchesCategory(product)) return;
      const quantity = Number(level.quantity) || 0;
      if (!quantity) return;
      if (!moneyKnown(product.cost)) missing.units += quantity;
      add(
        resolveGroup(resolvedGroup, { product, location: locationById.get(level.location_id) }, locationById),
        quantity,
        quantity * (Number(product.cost) || 0),
      );
    });
  } else {
    source.movements.forEach((movement) => {
      if (report.types && !report.types.includes(movement.type)) return;
      if (!within(movement.created_at, from, to)) return;
      if (scopeIds && !scopeIds.has(movement.location_id)) return;
      const product = productById.get(movement.product_id) || null;
      if (!matchesCategory(product)) return;
      const units = movedUnits(movement);
      const costKnown = moneyKnown(movement.unit_cost) || moneyKnown(product?.cost);
      if (report.id === 'sales') {
        if (!moneyKnown(product?.price)) missing.units += units;
      } else if (report.id === 'receipts') {
        if (!costKnown) missing.units += units;
      } else if (!moneyKnown(product?.cost)) {
        missing.units += units;
      }
      add(
        resolveGroup(
          resolvedGroup,
          { product, location: locationById.get(movement.location_id), movement },
          locationById,
        ),
        units,
        movedValue(report.id, movement, product, units),
      );
    });
  }

  const rows = [...buckets.values()].sort(
    (a, b) => b.value - a.value || b.units - a.units || a.label.localeCompare(b.label),
  );

  const totals = rows.reduce(
    (acc, row) => {
      acc.count += row.count;
      acc.units += row.units;
      acc.value += row.value;
      return acc;
    },
    { count: 0, units: 0, value: 0 },
  );

  return {
    report: { id: report.id, label: report.label },
    groupBy: resolvedGroup,
    groupLabel: GROUPINGS[resolvedGroup],
    valueLabel: report.valueLabel,
    rows,
    totals,
    missing,
    top: rows[0] || null,
    movementsCapped: source.movementsCapped || false,
  };
}

/** Purchasing summary: open orders, totals by supplier and status, low-stock counts. */
export async function buildPurchasingSummary(pool, businessId) {
  const [pos, products, levels] = await Promise.all([
    pool.query('SELECT * FROM purchase_orders WHERE business_id = $1', [businessId]),
    pool.query('SELECT * FROM products WHERE business_id = $1', [businessId]),
    pool.query('SELECT * FROM stock_levels WHERE business_id = $1', [businessId]),
  ]);
  const qtyByProduct = new Map();
  levels.rows.forEach((level) => {
    qtyByProduct.set(level.product_id, (qtyByProduct.get(level.product_id) || 0) + Number(level.quantity ?? 0));
  });
  const productById = new Map(products.rows.map((p) => [p.id, p]));
  const byStatus = {};
  const bySupplier = {};
  let openLines = 0;
  let openValue = 0;
  pos.rows.forEach((po) => {
    const lines = typeof po.lines === 'string' ? JSON.parse(po.lines || '[]') : po.lines || [];
    byStatus[po.status] = (byStatus[po.status] || 0) + 1;
    const key = po.supplier_name || 'No supplier';
    bySupplier[key] = bySupplier[key] || { orders: 0, openValue: 0 };
    bySupplier[key].orders += 1;
    if (['ordered', 'partial'].includes(po.status)) {
      lines.forEach((line) => {
        const open = Math.max(0, (Number(line.qty_ordered) || 0) - (Number(line.qty_received) || 0));
        openLines += open;
        const value = open * (Number(line.unit_cost) || 0);
        openValue += value;
        bySupplier[key].openValue += value;
      });
    }
  });
  const lowStock = products.rows.filter((product) => {
    const qty = qtyByProduct.get(product.id) || 0;
    return Number(product.reorder_point) > 0 && qty <= Number(product.reorder_point);
  }).length;
  return {
    orders: pos.rows.length,
    byStatus,
    bySupplier,
    openLines,
    openValue: Number(openValue.toFixed(2)),
    lowStockProducts: lowStock,
    products: products.rows.length,
  };
}
