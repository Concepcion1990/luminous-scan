import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';
import { descendantIds, locationPath } from '@/lib/locations';
import { MOVEMENT_TYPES } from '@/lib/inventory';
import { fetchMovements } from '@/lib/movementHistory';

/** How a report's rows can be grouped. */
export const GROUPINGS = {
  product: 'Product',
  category: 'Category',
  location: 'Location',
  type: 'Movement type',
  supplier: 'Supplier',
  user: 'Recorded by',
};

export const REPORT_TYPES = [
  {
    id: 'stock',
    label: 'Stock on hand',
    hint: 'What each place, category or product holds right now, valued at cost.',
    valueLabel: 'Cost value',
    snapshot: true,
    defaultGroup: 'location',
    groups: ['location', 'category', 'product', 'supplier'],
  },
  {
    id: 'movements',
    label: 'Movement activity',
    hint: 'Every stock change in the period, counted by type.',
    valueLabel: 'Cost moved',
    defaultGroup: 'type',
    groups: ['type', 'location', 'category', 'product', 'user'],
  },
  {
    id: 'sales',
    label: 'Units sold',
    hint: 'Stock taken out by sales, valued at each product’s retail price.',
    valueLabel: 'Sale value',
    defaultGroup: 'product',
    groups: ['product', 'category', 'location', 'user'],
    types: ['sale'],
  },
  {
    id: 'receipts',
    label: 'Receipts',
    hint: 'What arrived in the period, at the cost recorded when it landed.',
    valueLabel: 'Cost received',
    defaultGroup: 'supplier',
    groups: ['supplier', 'product', 'category', 'location'],
    types: ['receive'],
  },
  {
    id: 'losses',
    label: 'Losses & corrections',
    hint: 'Damaged, lost, written-off and corrected stock, at cost.',
    valueLabel: 'Value affected',
    defaultGroup: 'type',
    groups: ['type', 'product', 'category', 'location', 'user'],
    types: ['damaged', 'lost', 'write_off', 'correction', 'count'],
  },
];

export const PERIODS = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '365', label: 'Last 12 months', days: 365 },
  { id: 'all', label: 'All time', days: 0 },
  { id: 'custom', label: 'Custom dates', days: 0 },
];

const isoDay = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

/** The date window a period choice covers, as plain yyyy-mm-dd days. */
export function periodRange(periodId, customFrom = '', customTo = '') {
  if (periodId === 'custom') return { from: customFrom, to: customTo };
  const preset = PERIODS.find((period) => period.id === periodId);
  if (!preset || !preset.days) return { from: '', to: '' };
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (preset.days - 1));
  return { from: isoDay(start), to: isoDay(today) };
}

export function defaultReportId() {
  return REPORT_TYPES[0].id;
}

export function reportDefinition(reportId) {
  return REPORT_TYPES.find((report) => report.id === reportId) || REPORT_TYPES[0];
}

const MOVEMENT_PAGES = 12;
const MOVEMENT_PAGE_SIZE = 500;

/** How much ledger history a report reads, newest first. */
export const MOVEMENT_CAP = MOVEMENT_PAGES * MOVEMENT_PAGE_SIZE;

/** Every record a report can draw on, for one business. */
export async function loadReportSource(businessId) {
  const [products, levels, locations, movements] = await Promise.all([
    base44.entities.Product.filter(scoped({}, businessId), { sort: 'name', limit: 500 }),
    base44.entities.StockLevel.filter(scoped({}, businessId), { limit: 2000 }),
    base44.entities.Location.filter(scoped({}, businessId), { sort: 'name', limit: 100 }),
    fetchMovements(businessId, { pages: MOVEMENT_PAGES, pageSize: MOVEMENT_PAGE_SIZE }),
  ]);
  return {
    products: products.items ?? [],
    levels: levels.items ?? [],
    locations: locations.items ?? [],
    movements,
    // Older entries exist but were not read: say so instead of totalling quietly.
    movementsCapped: movements.length >= MOVEMENT_CAP,
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
 * Builds one report's rows from already-loaded records. Rows are grouped,
 * counted, summed in units and given a money value that depends on the report.
 */
export function buildReport({ reportId, groupBy, source, from = '', to = '', locationId = '', category = '' }) {
  if (!source) return null;
  const report = reportDefinition(reportId);
  const resolvedGroup = report.groups.includes(groupBy) ? groupBy : report.defaultGroup;

  const scopeIds = locationId ? new Set(descendantIds(source.locations, locationId)) : null;
  const categoryKey = (category || '').trim().toLowerCase();
  const productById = new Map(source.products.map((product) => [product.id, product]));
  const locationById = new Map(source.locations.map((location) => [location.id, location]));

  const matchesCategory = (product) => {
    if (!categoryKey) return true;
    if (!product) return false;
    return (product.category || '').trim().toLowerCase() === categoryKey;
  };

  // A figure nobody entered is not a figure of zero: units counted without one
  // are tracked so the report can say how much of it is blank.
  const known = (value) => typeof value === 'number' && Number.isFinite(value);
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
      const quantity = level.quantity || 0;
      if (!quantity) return;
      if (!known(product.cost)) missing.units += quantity;
      add(
        resolveGroup(resolvedGroup, { product, location: locationById.get(level.location_id) }, locationById),
        quantity,
        quantity * (product.cost || 0)
      );
    });
  } else {
    source.movements.forEach((movement) => {
      if (report.types && !report.types.includes(movement.type)) return;
      if (!within(movement.created_date, from, to)) return;
      if (scopeIds && !scopeIds.has(movement.location_id)) return;
      const product = productById.get(movement.product_id) || null;
      // A movement already happened: archiving the product must not erase its history.
      if (!matchesCategory(product)) return;
      const units = movedUnits(movement);
      if (report.id === 'sales') {
        if (!known(product?.price)) missing.units += units;
      } else if (report.id === 'receipts') {
        if (!known(movement.unit_cost) && !known(product?.cost)) missing.units += units;
      } else if (!known(product?.cost)) {
        missing.units += units;
      }
      add(
        resolveGroup(
          resolvedGroup,
          { product, location: locationById.get(movement.location_id), movement },
          locationById
        ),
        units,
        movedValue(report.id, movement, product, units)
      );
    });
  }

  const rows = [...buckets.values()].sort(
    (a, b) => b.value - a.value || b.units - a.units || a.label.localeCompare(b.label)
  );

  const totals = rows.reduce(
    (acc, row) => {
      acc.count += row.count;
      acc.units += row.units;
      acc.value += row.value;
      return acc;
    },
    { count: 0, units: 0, value: 0 }
  );

  return {
    report,
    groupBy: resolvedGroup,
    groupLabel: GROUPINGS[resolvedGroup],
    valueLabel: report.valueLabel,
    rows,
    totals,
    missing,
    top: rows[0] || null,
  };
}

/** Columns for exporting whatever a report currently shows. */
export function reportColumns(valueLabel) {
  return [
    { label: 'Group', value: (row) => row.label },
    { label: 'Detail', value: (row) => row.sub || '' },
    { label: 'Records', value: (row) => row.count },
    { label: 'Units', value: (row) => row.units },
    { label: valueLabel, value: (row) => Number(row.value.toFixed(2)) },
  ];
}