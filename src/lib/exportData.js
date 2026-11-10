import { base44 } from '@/api/client';
import { downloadCsv, downloadText, fileSlug, fileStamp, toCsv } from '@/lib/csv';
import { scoped } from '@/lib/scoped';
import { t } from './i18n.js';

/** Stable UTC timestamps so a spreadsheet can sort them. */
const iso = (value) => (value ? new Date(value).toISOString() : '');

const FETCH_ALL_PAGE_LIMIT = 40;
const FETCH_ALL_PAGE_SIZE = 500;

/** 40 pages × 500 rows: anything past this is left unread, and flagged. */
export const EXPORT_ROW_CAP = FETCH_ALL_PAGE_LIMIT * FETCH_ALL_PAGE_SIZE;

/** Reads every record of one entity for one business, following pagination. */
async function fetchAll(entityName, businessId, { sort = 'created_date', query = {} } = {}) {
  const rows = [];
  let cursor = null;
  let truncated = false;
  for (let page = 0; page < FETCH_ALL_PAGE_LIMIT; page += 1) {
    const result = await base44.entities[entityName].filter(scoped(query, businessId), {
      sort,
      limit: FETCH_ALL_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    const items = result?.items ?? (Array.isArray(result) ? result : []);
    rows.push(...items);
    cursor = result?.next_cursor;
    if (!cursor || items.length === 0) break;
    // Pages ran out while more rows still exist: the export is incomplete.
    if (page === FETCH_ALL_PAGE_LIMIT - 1) truncated = true;
  }
  return { rows, truncated };
}

/** A file name that says so when its dataset stopped at the 20,000-row cap. */
export function truncatedFilename(base, truncated) {
  return truncated ? `${base}-truncated-${EXPORT_ROW_CAP}` : base;
}

const yesNo = (value) => (value === false ? 'No' : 'Yes');

const code = (label, pick) => ({ label, value: pick, text: true });

export const EXPORTS = [
  {
    id: 'products',
    get title() { return t('exportsLib.products.title'); },
    get description() { return t('exportsLib.products.description'); },
    async build({ businessId }) {
      const [{ rows: products, truncated: productsTruncated }, { rows: levels }, { rows: locations }] =
        await Promise.all([
          fetchAll('Product', businessId, { sort: 'name' }),
          fetchAll('StockLevel', businessId),
          fetchAll('Location', businessId, { sort: 'name' }),
        ]);

      const totals = new Map();
      const perLocation = new Map();
      levels.forEach((level) => {
        totals.set(level.product_id, (totals.get(level.product_id) || 0) + (level.quantity || 0));
        const byLocation = perLocation.get(level.product_id) || new Map();
        byLocation.set(level.location_id, (byLocation.get(level.location_id) || 0) + (level.quantity || 0));
        perLocation.set(level.product_id, byLocation);
      });

      const columns = [
        { label: 'Product ID', value: (p) => p.id, text: true },
        { label: 'Name', value: (p) => p.name },
        code('SKU', (p) => p.sku),
        code('UPC / EAN', (p) => p.upc),
        code('ISBN', (p) => p.isbn),
        code('Barcode', (p) => p.barcode),
        code('QR code', (p) => p.qr_code),
        { label: 'Author', value: (p) => p.author || '' },
        { label: 'Category', value: (p) => p.category || '' },
        { label: 'Condition', value: (p) => p.condition || '' },
        { label: 'Unit', value: (p) => p.unit || 'each' },
        { label: 'Cost', value: (p) => p.cost ?? '' },
        { label: 'Price', value: (p) => p.price ?? '' },
        { label: 'Reorder point', value: (p) => p.reorder_point ?? 0 },
        { label: 'On hand', value: (p) => totals.get(p.id) || 0 },
        ...locations.map((location) => ({
          label: `On hand — ${location.name}`,
          value: (p) => perLocation.get(p.id)?.get(location.id) || 0,
        })),
        { label: 'Supplier', value: (p) => p.supplier_name || '' },
        { label: 'Notes', value: (p) => p.notes || '' },
        { label: 'Active', value: (p) => yesNo(p.active) },
        { label: 'Created', value: (p) => iso(p.created_date) },
        { label: 'Updated', value: (p) => iso(p.updated_date) },
      ];
      return { columns, rows: products, truncated: productsTruncated };
    },
  },
  {
    id: 'valuation',
    get title() { return t('exportsLib.valuation.title'); },
    get description() { return t('exportsLib.valuation.description'); },
    async build({ businessId }) {
      const [{ rows: products, truncated: productsTruncated }, { rows: levels }] = await Promise.all([
        fetchAll('Product', businessId, { sort: 'name' }),
        fetchAll('StockLevel', businessId),
      ]);

      const productById = new Map(products.map((product) => [product.id, product]));
      const known = (value) => typeof value === 'number' && Number.isFinite(value);
      const totals = new Map();
      levels.forEach((level) => {
        const product = productById.get(level.product_id);
        if (!product) return;
        const entry = totals.get(product.id) || {
          product,
          units: 0,
          held: 0,
          cost: 0,
          retail: 0,
          costKnown: known(product.cost),
          priceKnown: known(product.price),
        };
        const qty = level.quantity || 0;
        entry.units += qty;
        entry.held += level.reserved || 0;
        entry.cost += qty * (product.cost || 0);
        entry.retail += qty * (product.price || 0);
        totals.set(product.id, entry);
      });

      const rows = [...totals.values()]
        .filter((entry) => entry.units > 0)
        .sort((a, b) => b.cost - a.cost);

      const columns = [
        code('SKU', (row) => row.product.sku),
        { label: 'Name', value: (row) => row.product.name },
        { label: 'Category', value: (row) => row.product.category || '' },
        { label: 'Condition', value: (row) => row.product.condition || '' },
        { label: 'Unit cost', value: (row) => row.product.cost ?? '' },
        { label: 'Unit price', value: (row) => row.product.price ?? '' },
        { label: 'On hand', value: (row) => row.units },
        { label: 'Held', value: (row) => row.held },
        { label: 'Available', value: (row) => Math.max(row.units - row.held, 0) },
        // Missing money is never treated as zero (same rule as the Valuation
        // page): a product with no recorded cost or price leaves its money
        // columns blank instead of showing invented $0 figures.
        { label: 'Cost value', value: (row) => (row.costKnown ? Number(row.cost.toFixed(2)) : '') },
        { label: 'Retail value', value: (row) => (row.priceKnown ? Number(row.retail.toFixed(2)) : '') },
        {
          label: 'Margin',
          value: (row) =>
            row.costKnown && row.priceKnown ? Number((row.retail - row.cost).toFixed(2)) : '',
        },
      ];
      return { columns, rows, truncated: productsTruncated };
    },
  },
  {
    id: 'stock-by-location',
    get title() { return t('exportsLib.stockByLocation.title'); },
    get description() { return t('exportsLib.stockByLocation.description'); },
    async build({ businessId }) {
      const [{ rows: levels }, { rows: products }, { rows: locations }] = await Promise.all([
        fetchAll('StockLevel', businessId),
        fetchAll('Product', businessId, { sort: 'name' }),
        fetchAll('Location', businessId, { sort: 'name' }),
      ]);
      const productById = new Map(products.map((p) => [p.id, p]));
      const locationById = new Map(locations.map((l) => [l.id, l]));

      const rows = levels
        .map((level) => ({
          ...level,
          product: productById.get(level.product_id),
          location: locationById.get(level.location_id),
        }))
        .filter((row) => row.product && row.location)
        .sort((a, b) =>
          `${a.product.name}${a.location.name}`.localeCompare(`${b.product.name}${b.location.name}`)
        );

      const columns = [
        { label: 'Product ID', value: (r) => r.product_id, text: true },
        { label: 'Product', value: (r) => r.product.name },
        code('SKU', (r) => r.product.sku),
        code('UPC / EAN', (r) => r.product.upc),
        { label: 'Location ID', value: (r) => r.location_id, text: true },
        { label: 'Location', value: (r) => r.location.name },
        code('Location code', (r) => r.location.code),
        { label: 'Location type', value: (r) => r.location.kind || 'store' },
        { label: 'Quantity', value: (r) => r.quantity ?? 0 },
        { label: 'Reorder point', value: (r) => r.product.reorder_point ?? 0 },
        { label: 'Supplier', value: (r) => r.product.supplier_name || '' },
        { label: 'Updated', value: (r) => iso(r.updated_date) },
      ];
      return { columns, rows };
    },
  },
  {
    id: 'movements',
    get title() { return t('exportsLib.movements.title'); },
    get description() { return t('exportsLib.movements.description'); },
    async build({ businessId }) {
      const { rows, truncated } = await fetchAll('StockMovement', businessId, { sort: '-created_date' });
      const columns = [
        { label: 'Movement ID', value: (m) => m.id, text: true },
        { label: 'Recorded at', value: (m) => iso(m.created_date) },
        { label: 'Type', value: (m) => m.type || '' },
        { label: 'Product', value: (m) => m.product_name || '' },
        code('SKU', (m) => m.sku),
        { label: 'Product ID', value: (m) => m.product_id, text: true },
        { label: 'Quantity', value: (m) => m.quantity ?? '' },
        { label: 'Previous', value: (m) => m.previous_qty ?? '' },
        { label: 'New', value: (m) => m.new_qty ?? '' },
        { label: 'Location', value: (m) => m.location_name || '' },
        { label: 'Location ID', value: (m) => m.location_id, text: true },
        { label: 'Destination', value: (m) => m.to_location_name || '' },
        code('Scanned code', (m) => m.scanned_code),
        code('Reference', (m) => m.reference),
        { label: 'Supplier', value: (m) => m.supplier_name || '' },
        { label: 'Unit cost', value: (m) => m.unit_cost ?? '' },
        { label: 'Note', value: (m) => m.note || '' },
        { label: 'Recorded by', value: (m) => m.user_name || '' },
      ];
      return { columns, rows, truncated };
    },
  },
  {
    id: 'suppliers',
    get title() { return t('exportsLib.suppliers.title'); },
    get description() { return t('exportsLib.suppliers.description'); },
    async build({ businessId }) {
      const { rows, truncated } = await fetchAll('Supplier', businessId, { sort: 'name' });
      const columns = [
        { label: 'Supplier ID', value: (s) => s.id, text: true },
        { label: 'Name', value: (s) => s.name },
        { label: 'Contact', value: (s) => s.contact_name || '' },
        { label: 'Email', value: (s) => s.email || '' },
        { label: 'Phone', value: (s) => s.phone || '' },
        code('Account number', (s) => s.account_number),
        { label: 'Lead time (days)', value: (s) => s.lead_time_days ?? '' },
        { label: 'Address', value: (s) => s.address || '' },
        { label: 'Website', value: (s) => s.website || '' },
        { label: 'Notes', value: (s) => s.notes || '' },
        { label: 'Active', value: (s) => yesNo(s.active) },
        { label: 'Created', value: (s) => iso(s.created_date) },
      ];
      return { columns, rows, truncated };
    },
  },
  {
    id: 'purchase-orders',
    get title() { return t('exportsLib.purchaseOrders.title'); },
    get description() { return t('exportsLib.purchaseOrders.description'); },
    async build({ businessId }) {
      const { rows: orders, truncated } = await fetchAll('PurchaseOrder', businessId, { sort: '-created_date' });
      const rows = orders.flatMap((order) => {
        const lines = order.lines?.length ? order.lines : [null];
        return lines.map((line) => ({ order, line }));
      });

      const columns = [
        code('PO number', (r) => r.order.number),
        { label: 'Status', value: (r) => r.order.status || '' },
        { label: 'Supplier', value: (r) => r.order.supplier_name || '' },
        { label: 'Order date', value: (r) => r.order.order_date || '' },
        { label: 'Expected', value: (r) => r.order.expected_date || '' },
        { label: 'Received on', value: (r) => r.order.received_date || '' },
        { label: 'Receiving location', value: (r) => r.order.location_name || '' },
        code('Product SKU', (r) => r.line?.sku),
        { label: 'Product', value: (r) => r.line?.product_name || '' },
        { label: 'Product ID', value: (r) => r.line?.product_id || '', text: true },
        { label: 'Qty ordered', value: (r) => r.line?.qty_ordered ?? '' },
        { label: 'Qty received', value: (r) => r.line?.qty_received ?? '' },
        { label: 'Unit cost', value: (r) => r.line?.unit_cost ?? '' },
        {
          label: 'Line total',
          value: (r) =>
            r.line
              ? Number((r.line.qty_ordered || 0) * (r.line.unit_cost || 0)).toFixed(2)
              : '',
        },
        { label: 'Order subtotal', value: (r) => r.order.subtotal ?? '' },
        { label: 'Shipping', value: (r) => r.order.shipping ?? '' },
        { label: 'Tax', value: (r) => r.order.tax ?? '' },
        { label: 'Order total', value: (r) => r.order.total ?? '' },
        { label: 'Note', value: (r) => r.order.note || '' },
        { label: 'Received by', value: (r) => r.order.received_by || '' },
        { label: 'Created', value: (r) => iso(r.order.created_date) },
      ];
      return { columns, rows, truncated };
    },
  },
  {
    id: 'locations',
    get title() { return t('exportsLib.locations.title'); },
    get description() { return t('exportsLib.locations.description'); },
    async build({ businessId }) {
      const [{ rows: locations }, { rows: levels }, { rows: products }] = await Promise.all([
        fetchAll('Location', businessId, { sort: 'name' }),
        fetchAll('StockLevel', businessId),
        fetchAll('Product', businessId),
      ]);
      const reorderByProduct = new Map(products.map((p) => [p.id, p.reorder_point || 0]));
      const stats = new Map();
      levels.forEach((level) => {
        const entry = stats.get(level.location_id) || { units: 0, skus: 0, low: 0 };
        entry.units += level.quantity || 0;
        entry.skus += (level.quantity || 0) > 0 ? 1 : 0;
        const point = reorderByProduct.get(level.product_id) || 0;
        if (point > 0 && (level.quantity || 0) <= point) entry.low += 1;
        stats.set(level.location_id, entry);
      });

      const columns = [
        { label: 'Location ID', value: (l) => l.id, text: true },
        { label: 'Name', value: (l) => l.name },
        code('Code', (l) => l.code),
        { label: 'Type', value: (l) => l.kind || 'store' },
        { label: 'Address', value: (l) => l.address || '' },
        { label: 'Units on hand', value: (l) => stats.get(l.id)?.units ?? 0 },
        { label: 'SKUs stocked', value: (l) => stats.get(l.id)?.skus ?? 0 },
        { label: 'At or below reorder', value: (l) => stats.get(l.id)?.low ?? 0 },
        { label: 'Active', value: (l) => yesNo(l.active) },
        { label: 'Created', value: (l) => iso(l.created_date) },
      ];
      return { columns, rows: locations };
    },
  },
  {
    id: 'categories',
    get title() { return t('exportsLib.categories.title'); },
    get description() { return t('exportsLib.categories.description'); },
    async build({ businessId }) {
      const [{ rows: products }, { rows: levels }] = await Promise.all([
        fetchAll('Product', businessId),
        fetchAll('StockLevel', businessId),
      ]);
      const onHand = new Map();
      levels.forEach((level) => {
        onHand.set(level.product_id, (onHand.get(level.product_id) || 0) + (level.quantity || 0));
      });

      const groups = new Map();
      products.forEach((product) => {
        const key = product.category?.trim() || 'Uncategorized';
        const entry = groups.get(key) || { category: key, products: 0, active: 0, units: 0, low: 0 };
        entry.products += 1;
        if (product.active !== false) entry.active += 1;
        entry.units += onHand.get(product.id) || 0;
        const point = product.reorder_point || 0;
        if (point > 0 && (onHand.get(product.id) || 0) <= point) entry.low += 1;
        groups.set(key, entry);
      });

      const rows = [...groups.values()].sort((a, b) => a.category.localeCompare(b.category));
      const columns = [
        { label: 'Category', value: (r) => r.category },
        { label: 'Products', value: (r) => r.products },
        { label: 'Active products', value: (r) => r.active },
        { label: 'Units on hand', value: (r) => r.units },
        { label: 'At or below reorder', value: (r) => r.low },
      ];
      return { columns, rows };
    },
  },
  {
    id: 'business-profile',
    get title() { return t('exportsLib.businessProfile.title'); },
    get description() { return t('exportsLib.businessProfile.description'); },
    async build({ businessId, profile }) {
      const rows = [profile];
      const columns = [
        { label: 'Business ID', value: () => businessId || '', text: true },
        { label: 'Name', value: (p) => p.name },
        { label: 'Tagline', value: (p) => p.tagline || '' },
        { label: 'Logo URL', value: (p) => p.logo_url || '' },
        { label: 'Brand color', value: (p) => p.brand_color || '' },
        { label: 'Contact email', value: (p) => p.contact_email || '' },
        { label: 'Contact phone', value: (p) => p.contact_phone || '' },
        { label: 'Website', value: (p) => p.website || '' },
        { label: 'Address', value: (p) => p.address || '' },
        { label: 'Currency', value: (p) => p.currency || 'USD' },
        { label: 'Timezone', value: (p) => p.timezone || '' },
        { label: 'Date format', value: (p) => p.date_format || '' },
        { label: 'Measurement units', value: (p) => p.unit_system || 'imperial' },
        { label: 'Language', value: (p) => p.language || 'en' },
        { label: 'Exported', value: () => iso(new Date()) },
      ];
      return { columns, rows };
    },
  },
  {
    id: 'inventory-workbook',
    get title() { return t('exportsLib.inventoryWorkbook.title'); },
    get description() { return t('exportsLib.inventoryWorkbook.description'); },
    async buildSheets({ businessId }) {
      const [{ rows: products }, { rows: levels }, { rows: locations }, { rows: movements, truncated }] =
        await Promise.all([
          fetchAll('Product', businessId, { sort: 'name' }),
          fetchAll('StockLevel', businessId),
          fetchAll('Location', businessId, { sort: 'name' }),
          fetchAll('StockMovement', businessId, { sort: '-created_date' }),
        ]);
      const productById = new Map(products.map((product) => [product.id, product]));
      const locationById = new Map(locations.map((location) => [location.id, location]));

      return {
        sheets: [
          {
            name: 'Products',
          rows: products,
          columns: [
            { label: 'Name', value: (p) => p.name },
            code('SKU', (p) => p.sku),
            code('UPC / EAN', (p) => p.upc),
            code('ISBN', (p) => p.isbn),
            code('Barcode', (p) => p.barcode),
            code('QR code', (p) => p.qr_code),
            { label: 'Author', value: (p) => p.author || '' },
            { label: 'Category', value: (p) => p.category || '' },
            { label: 'Condition', value: (p) => p.condition || '' },
            { label: 'Unit', value: (p) => p.unit || 'each' },
            { label: 'Cost', value: (p) => p.cost ?? '' },
            { label: 'Price', value: (p) => p.price ?? '' },
            { label: 'Reorder point', value: (p) => p.reorder_point ?? 0 },
            { label: 'Supplier', value: (p) => p.supplier_name || '' },
            { label: 'Notes', value: (p) => p.notes || '' },
            { label: 'Active', value: (p) => yesNo(p.active) },
            code('Product ID', (p) => p.id),
          ],
        },
        {
          name: 'Stock levels',
          rows: levels.filter((level) => productById.has(level.product_id)),
          columns: [
            code('SKU', (l) => productById.get(l.product_id)?.sku),
            { label: 'Product', value: (l) => productById.get(l.product_id)?.name || '' },
            code('UPC / EAN', (l) => productById.get(l.product_id)?.upc),
            { label: 'Location', value: (l) => locationById.get(l.location_id)?.name || '' },
            code('Location code', (l) => locationById.get(l.location_id)?.code),
            { label: 'Quantity on hand', value: (l) => l.quantity ?? 0 },
            { label: 'Reserved', value: (l) => l.reserved ?? 0 },
            code('Product ID', (l) => l.product_id),
            code('Location ID', (l) => l.location_id),
          ],
        },
        {
          name: 'Locations',
          rows: locations,
          columns: [
            { label: 'Name', value: (l) => l.name },
            code('Code', (l) => l.code),
            { label: 'Type', value: (l) => l.kind || 'store' },
            { label: 'Inside', value: (l) => l.parent_name || '' },
            { label: 'Address', value: (l) => l.address || '' },
            { label: 'Active', value: (l) => yesNo(l.active) },
            code('Location ID', (l) => l.id),
          ],
        },
        {
          name: 'Movements',
          rows: movements,
          columns: [
            { label: 'Recorded at', value: (m) => iso(m.created_date) },
            { label: 'Type', value: (m) => m.type || '' },
            { label: 'Product', value: (m) => m.product_name || '' },
            code('SKU', (m) => m.sku),
            { label: 'Quantity', value: (m) => m.quantity ?? '' },
            { label: 'Previous', value: (m) => m.previous_qty ?? '' },
            { label: 'New', value: (m) => m.new_qty ?? '' },
            { label: 'Location', value: (m) => m.location_name || '' },
            { label: 'Destination', value: (m) => m.to_location_name || '' },
            code('Reference', (m) => m.reference),
            { label: 'Note', value: (m) => m.note || '' },
            { label: 'Recorded by', value: (m) => m.user_name || '' },
          ],
        },
        ],
        truncated,
      };
    },
  },
];

/**
 * Builds and downloads one dataset for the active business.
 * format: 'csv' (default) or 'xlsx'. Datasets with buildSheets are Excel-only.
 */
export async function exportDataset(dataset, { businessId, businessName, profile }, format = 'csv') {
  const base = `${fileSlug(businessName) || 'business'}-${dataset.id}-${fileStamp()}`;

  if (dataset.buildSheets) {
    const { downloadSheets } = await import('@/lib/xlsx');
    const { sheets, truncated } = await dataset.buildSheets({ businessId, businessName, profile });
    const filename = downloadSheets(sheets, `${truncatedFilename(base, truncated)}.xlsx`);
    return {
      count: sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
      filename,
      truncated,
    };
  }

  const { columns, rows, truncated } = await dataset.build({ businessId, businessName, profile });

  if (format === 'xlsx') {
    const { downloadSheets } = await import('@/lib/xlsx');
    const filename = downloadSheets(
      [{ name: dataset.title, columns, rows }],
      `${truncatedFilename(base, truncated)}.xlsx`
    );
    return { count: rows.length, filename, truncated };
  }

  const filename = `${truncatedFilename(base, truncated)}.csv`;
  downloadCsv(filename, toCsv(columns, rows));
  return { count: rows.length, filename, truncated };
}

const BACKUP_ENTITIES = {
  products: ['Product', { sort: 'name' }],
  locations: ['Location', { sort: 'name' }],
  stock_levels: ['StockLevel', {}],
  stock_movements: ['StockMovement', { sort: '-created_date' }],
  suppliers: ['Supplier', { sort: 'name' }],
  purchase_orders: ['PurchaseOrder', { sort: '-created_date' }],
  customer_orders: ['Order', { sort: '-created_date' }],
  returns: ['Return', { sort: '-created_date' }],
  stock_counts: ['CountSession', { sort: '-created_date' }],
  categories: ['Category', { sort: 'name' }],
  listings: ['Listing', {}],
  bills_of_materials: ['Bom', {}],
  alert_rules: ['AlertRule', {}],
};

/** One JSON package holding everything this business stores in the app. */
export async function downloadBackup({ businessId, businessName, profile }) {
  const fetched = await Promise.all(
    Object.entries(BACKUP_ENTITIES).map(async ([key, [entityName, options]]) => [
      key,
      await fetchAll(entityName, businessId, options),
    ])
  );
  const entries = fetched.map(([key, { rows }]) => [key, rows]);
  const truncated = fetched.some(([, { truncated: hit }]) => hit);
  const data = Object.fromEntries(entries);
  const counts = Object.fromEntries(entries.map(([key, rows]) => [key, rows.length]));

  const payload = {
    format: 'luminous-stockhaven-backup',
    format_version: 1,
    generated_at: new Date().toISOString(),
    business: { id: businessId, name: businessName },
    profile,
    counts,
    truncated,
    data,
  };

  const filename = `${truncatedFilename(`${fileSlug(businessName) || 'business'}-backup-${fileStamp()}`, truncated)}.json`;
  downloadText(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8;');
  return { counts, filename, truncated };
}

/** Columns derived from the records themselves, for entity snapshots. */
const CODE_KEYS = new Set([
  'id',
  'business_id',
  'product_id',
  'location_id',
  'supplier_id',
  'to_location_id',
  'order_id',
  'role_id',
  'sku',
  'upc',
  'barcode',
  'qr_code',
  'isbn',
  'code',
  'number',
  'account_number',
  'external_id',
  'tracking_ref',
  'reference',
  'scanned_code',
  'reversal_of_id',
]);

function recordColumns(records) {
  const keys = [];
  records.forEach((record) => {
    Object.keys(record || {}).forEach((key) => {
      if (!keys.includes(key)) keys.push(key);
    });
  });
  return keys.slice(0, 45).map((key) => ({
    label: key.replace(/_/g, ' ').replace(/^\w/, (character) => character.toUpperCase()),
    text: CODE_KEYS.has(key),
    value: (record) => {
      const value = record?.[key];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return value;
    },
  }));
}

/** Same snapshot as the JSON backup, as a real Excel workbook with one sheet per record type. */
export async function downloadBackupWorkbook({ businessId, businessName, profile }) {
  const fetched = await Promise.all(
    Object.entries(BACKUP_ENTITIES).map(async ([key, [entityName, options]]) => [
      key,
      await fetchAll(entityName, businessId, options),
    ])
  );
  const entries = fetched.map(([key, { rows }]) => [key, rows]);
  const truncated = fetched.some(([, { truncated: hit }]) => hit);

  const sheets = entries.map(([key, records]) => ({
    name: key.replace(/_/g, ' '),
    columns: recordColumns(records),
    rows: records,
  }));
  sheets.push({ name: 'Business profile', columns: recordColumns([profile]), rows: [profile] });

  const { downloadSheets } = await import('@/lib/xlsx');
  const filename = `${truncatedFilename(`${fileSlug(businessName) || 'business'}-backup-${fileStamp()}`, truncated)}.xlsx`;
  downloadSheets(sheets, filename);
  return {
    counts: Object.fromEntries(entries.map(([key, rows]) => [key, rows.length])),
    filename,
    truncated,
  };
}