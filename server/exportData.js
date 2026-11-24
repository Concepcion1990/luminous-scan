/**
 * Server-side export datasets — T3 (plan §2.11).
 *
 * Mirrors the column definitions in src/lib/exportData.js so a
 * server-built export matches the figures the pages show, including
 * the missing-money rule: a product with no recorded cost or price
 * leaves its money columns blank instead of showing invented $0
 * figures. Cap: 20,000 rows per entity, with a "truncated" flag.
 */
import { publicRow, entityDef } from './entities.js';
import { attributionName } from './profilePhotos.js';
import { recipeCostPerUnit } from './recipes.js';
import { parseJsonArray } from './authz.js';

export const EXPORT_ROW_CAP = 20000;

const iso = (value) => (value ? new Date(value).toISOString() : '');
const yesNo = (value) => (value === false ? 'No' : 'Yes');
const code = (label, pick) => ({ label, value: pick, text: true });

async function allRows(pool, name, businessId) {
  const def = entityDef(name);
  const { rows } = await pool.query(
    `SELECT * FROM ${def.table} WHERE business_id = $1 ORDER BY created_at ASC LIMIT ${EXPORT_ROW_CAP + 1}`,
    [businessId],
  );
  const mapped = rows.map((row) => publicRow(def, row));
  return { rows: mapped.slice(0, EXPORT_ROW_CAP), truncated: mapped.length > EXPORT_ROW_CAP };
}

async function levelsByProduct(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM stock_levels WHERE business_id = $1',
    [businessId],
  );
  const totals = new Map();
  const perLocation = new Map();
  rows.forEach((level) => {
    const qty = Number(level.quantity ?? 0);
    totals.set(level.product_id, (totals.get(level.product_id) || 0) + qty);
    const byLocation = perLocation.get(level.product_id) || new Map();
    byLocation.set(level.location_id, (byLocation.get(level.location_id) || 0) + qty);
    perLocation.set(level.product_id, byLocation);
  });
  return { rows, totals, perLocation };
}

/** Valuation rows: missing cost/price is never treated as zero. */
export async function buildValuation(pool, businessId) {
  const [{ rows: products, truncated }, { rows: levels }] = await Promise.all([
    allRows(pool, 'Product', businessId),
    levelsByProduct(pool, businessId),
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
    const qty = Number(level.quantity ?? 0);
    entry.units += qty;
    entry.held += Number(level.reserved ?? 0);
    entry.cost += qty * (Number(product.cost) || 0);
    entry.retail += qty * (Number(product.price) || 0);
    totals.set(product.id, entry);
  });
  const rows = [...totals.values()]
    .filter((entry) => entry.units > 0)
    .sort((a, b) => b.cost - a.cost);
  return { rows, truncated };
}

export const EXPORTS = {
  products: {
    title: 'Products',
    async build(pool, businessId) {
      const [{ rows: products, truncated }, { totals, perLocation }, { rows: locations }] = await Promise.all([
        allRows(pool, 'Product', businessId),
        levelsByProduct(pool, businessId),
        allRows(pool, 'Location', businessId),
      ]);
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
      const sorted = [...products].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      return { columns, rows: sorted, truncated };
    },
  },

  valuation: {
    title: 'Stock valuation',
    async build(pool, businessId) {
      const { rows, truncated } = await buildValuation(pool, businessId);
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
        { label: 'Cost value', value: (row) => (row.costKnown ? Number(row.cost.toFixed(2)) : '') },
        { label: 'Retail value', value: (row) => (row.priceKnown ? Number(row.retail.toFixed(2)) : '') },
        {
          label: 'Margin',
          value: (row) => (row.costKnown && row.priceKnown ? Number((row.retail - row.cost).toFixed(2)) : ''),
        },
      ];
      return { columns, rows, truncated };
    },
  },

  'stock-by-location': {
    title: 'Stock by location',
    async build(pool, businessId) {
      const [{ rows: levels }, { rows: products }, { rows: locations }] = await Promise.all([
        allRows(pool, 'StockLevel', businessId),
        allRows(pool, 'Product', businessId),
        allRows(pool, 'Location', businessId),
      ]);
      const productById = new Map(products.map((p) => [p.id, p]));
      const locationById = new Map(locations.map((l) => [l.id, l]));
      const rows = levels
        .map((level) => ({ ...level, product: productById.get(level.product_id), location: locationById.get(level.location_id) }))
        .filter((row) => row.product && row.location)
        .sort((a, b) => `${a.product.name}${a.location.name}`.localeCompare(`${b.product.name}${b.location.name}`));
      const columns = [
        code('SKU', (row) => row.product.sku),
        { label: 'Product', value: (row) => row.product.name },
        { label: 'Location', value: (row) => row.location.name },
        { label: 'On hand', value: (row) => Number(row.quantity ?? 0) },
        { label: 'Held', value: (row) => Number(row.reserved ?? 0) },
        { label: 'Available', value: (row) => Math.max(Number(row.quantity ?? 0) - Number(row.reserved ?? 0), 0) },
      ];
      return { columns, rows, truncated: false };
    },
  },

  movements: {
    title: 'Movements',
    async build(pool, businessId, nameMap = null) {
      const { rows, truncated } = await allRows(pool, 'StockMovement', businessId);
      const columns = [
        { label: 'Date', value: (m) => iso(m.created_date) },
        { label: 'Product', value: (m) => m.product_name || '' },
        code('SKU', (m) => m.sku),
        { label: 'Type', value: (m) => m.type },
        { label: 'Quantity', value: (m) => Number(m.quantity ?? 0) },
        { label: 'Previous', value: (m) => Number(m.previous_qty ?? 0) },
        { label: 'New', value: (m) => Number(m.new_qty ?? 0) },
        { label: 'Location', value: (m) => m.location_name || '' },
        { label: 'To location', value: (m) => m.to_location_name || '' },
        code('Scanned code', (m) => m.scanned_code),
        { label: 'Reference', value: (m) => m.reference || '' },
        { label: 'Note', value: (m) => m.note || '' },
        // Attribution prints a NAME, never an email: when the
        // exporter is a non-owner the route passes the business's
        // name map and stored emails resolve through it (owner's
        // email-exposure rule, Nov 21, 2026).
        { label: 'By', value: (m) => (nameMap ? attributionName(nameMap, m.user_name || '') : m.user_name || '') },
      ];
      return { columns, rows, truncated };
    },
  },

  suppliers: {
    title: 'Suppliers',
    async build(pool, businessId) {
      const { rows, truncated } = await allRows(pool, 'Supplier', businessId);
      const columns = [
        { label: 'Name', value: (s) => s.name },
        { label: 'Contact', value: (s) => s.contact_name || '' },
        { label: 'Email', value: (s) => s.email || '' },
        { label: 'Phone', value: (s) => s.phone || '' },
        { label: 'Account number', value: (s) => s.account_number || '' },
        { label: 'Lead time (days)', value: (s) => s.lead_time_days ?? '' },
        { label: 'Active', value: (s) => yesNo(s.active) },
      ];
      return { columns, rows, truncated };
    },
  },

  'purchase-orders': {
    title: 'Purchase orders',
    async build(pool, businessId, nameMap = null) {
      const { rows: orders, truncated } = await allRows(pool, 'PurchaseOrder', businessId);
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
            r.line ? Number((r.line.qty_ordered || 0) * (r.line.unit_cost || 0)).toFixed(2) : '',
        },
        { label: 'Order subtotal', value: (r) => r.order.subtotal ?? '' },
        { label: 'Shipping', value: (r) => r.order.shipping ?? '' },
        { label: 'Tax', value: (r) => r.order.tax ?? '' },
        { label: 'Order total', value: (r) => r.order.total ?? '' },
        { label: 'Note', value: (r) => r.order.note || '' },
        { label: 'Received by', value: (r) => (nameMap ? attributionName(nameMap, r.order.received_by || '') : r.order.received_by || '') },
        { label: 'Created', value: (r) => iso(r.order.created_date) },
      ];
      return { columns, rows, truncated };
    },
  },

  // Restaurant ledger (release 361): one row per kitchen
  // money event, in the four sections the bookkeeper files
  // by — Purchases (received PO lines at their line cost),
  // Waste (the costed waste log), Staff meals (valued at the
  // dish's true recipe cost where a recipe exists, else the
  // product's cost) and Depletion (the cause-linked consume
  // rows 359's depletion writes). Server-built like every
  // dataset here, so it inherits the export route's
  // Business-only gate (featureAllowed 'exports') exactly
  // like the other money datasets. Columns mirror
  // src/lib/exportData.js dataset 'restaurantLedger'.
  restaurantLedger: {
    title: 'Restaurant ledger',
    async build(pool, businessId) {
      const money = (value) => (value === null || value === undefined ? '' : Number(Number(value).toFixed(2)));
      const columns = [
        { label: 'Section', value: (r) => r.section },
        { label: 'Date', value: (r) => iso(r.date) },
        { label: 'Item', value: (r) => r.item || '' },
        { label: 'Quantity', value: (r) => r.quantity ?? '' },
        { label: 'Unit cost', value: (r) => money(r.unit_cost) },
        { label: 'Total cost', value: (r) => money(r.total_cost) },
        { label: 'Reference', value: (r) => r.reference || '' },
      ];
      const rows = [];
      const truncatedFlags = [];

      const { rows: poRows, truncated: poTruncated } = await allRows(pool, 'PurchaseOrder', businessId);
      truncatedFlags.push(poTruncated);
      for (const order of poRows) {
        for (const line of Array.isArray(order.lines) ? order.lines : []) {
          const received = Number(line?.qty_received) || 0;
          if (!(received > 0)) continue;
          const unitCost = line.unit_cost === null || line.unit_cost === undefined ? null : Number(line.unit_cost);
          rows.push({
            section: 'Purchases',
            date: order.received_date || order.updated_date || order.created_date,
            item: line.product_name || '',
            quantity: received,
            unit_cost: unitCost,
            total_cost: unitCost === null ? null : received * unitCost,
            reference: order.number || '',
          });
        }
      }

      const { rows: wasteRows, truncated: wasteTruncated } = await allRows(pool, 'WasteEntry', businessId);
      truncatedFlags.push(wasteTruncated);
      for (const entry of wasteRows) {
        const qty = Number(entry.quantity) || 0;
        const unitCost = entry.unit_cost === null || entry.unit_cost === undefined ? null : Number(entry.unit_cost);
        rows.push({
          section: 'Waste',
          date: entry.created_date,
          item: entry.product_name || '',
          quantity: qty,
          unit_cost: unitCost,
          total_cost: unitCost === null ? null : qty * unitCost,
          reference: entry.id,
        });
      }

      const [{ rows: mealRows, truncated: mealTruncated }, { rows: productRows }, { rows: recipeRows }] =
        await Promise.all([
          allRows(pool, 'StaffMeal', businessId),
          allRows(pool, 'Product', businessId),
          allRows(pool, 'Recipe', businessId),
        ]);
      truncatedFlags.push(mealTruncated);
      const productsById = new Map(productRows.map((row) => [row.id, row]));
      // Recipe rows arrive with unit_conversions still TEXT
      // (allRows reads through the Product def only for
      // products) — the cost math parses them defensively.
      const rawRecipes = recipeRows.map((row) => ({ ...row, lines: parseJsonArray(row.lines) }));
      const recipesById = new Map(rawRecipes.map((row) => [row.id, row]));
      const recipeByProduct = new Map();
      for (const recipe of rawRecipes) {
        if (recipe.product_id && recipe.status === 'active' && !recipeByProduct.has(recipe.product_id)) {
          recipeByProduct.set(recipe.product_id, recipe);
        }
      }
      for (const meal of mealRows) {
        const qty = Number(meal.quantity) || 0;
        const product = productsById.get(meal.product_id);
        const recipe = recipeByProduct.get(meal.product_id);
        const unitCost = recipe
          ? recipeCostPerUnit(recipesById, productsById, recipe)
          : product?.cost === null || product?.cost === undefined
            ? null
            : Number(product.cost);
        rows.push({
          section: 'Staff meals',
          date: meal.created_date,
          item: meal.product_name || product?.name || '',
          quantity: qty,
          unit_cost: unitCost,
          total_cost: unitCost === null ? null : qty * unitCost,
          reference: meal.id,
        });
      }

      const { rows: movementRows, truncated: movementTruncated } = await allRows(pool, 'StockMovement', businessId);
      truncatedFlags.push(movementTruncated);
      for (const movement of movementRows) {
        if (movement.type !== 'consume' || !movement.cause_movement_id) continue;
        const qty = Number(movement.quantity) || 0;
        const unitCost = movement.unit_cost === null || movement.unit_cost === undefined ? null : Number(movement.unit_cost);
        rows.push({
          section: 'Depletion',
          date: movement.created_date,
          item: movement.product_name || '',
          quantity: qty,
          unit_cost: unitCost,
          total_cost: unitCost === null ? null : qty * unitCost,
          reference: movement.reference || movement.cause_movement_id,
        });
      }

      rows.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
      return { columns, rows, truncated: truncatedFlags.some(Boolean) };
    },
  },

  locations: {
    title: 'Locations',
    async build(pool, businessId) {
      const { rows, truncated } = await allRows(pool, 'Location', businessId);
      const columns = [
        { label: 'Name', value: (l) => l.name },
        { label: 'Code', value: (l) => l.code || '' },
        { label: 'Kind', value: (l) => l.kind || '' },
        { label: 'Parent', value: (l) => l.parent_name || '' },
        { label: 'Address', value: (l) => l.address || '' },
        { label: 'Active', value: (l) => yesNo(l.active) },
      ];
      return { columns, rows, truncated };
    },
  },

  categories: {
    title: 'Categories',
    async build(pool, businessId) {
      const { rows, truncated } = await allRows(pool, 'Category', businessId);
      const columns = [
        { label: 'Name', value: (c) => c.name },
        { label: 'Kind', value: (c) => c.kind || '' },
        { label: 'Parent', value: (c) => c.parent_name || '' },
      ];
      return { columns, rows, truncated };
    },
  },

  'business-profile': {
    title: 'Business profile',
    async build(pool, businessId) {
      const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1 LIMIT 1', [businessId]);
      const business = rows[0] ?? {};
      const columns = [
        { label: 'Field', value: (r) => r.field },
        { label: 'Value', value: (r) => r.value },
      ];
      const rowsOut = [
        { field: 'Name', value: business.name || '' },
        { field: 'Tagline', value: business.tagline || '' },
        { field: 'Currency', value: business.currency || '' },
      ];
      return { columns, rows: rowsOut, truncated: false };
    },
  },
};

export function truncatedFilename(base, truncated) {
  return truncated ? `${base}-truncated-${EXPORT_ROW_CAP}` : base;
}
