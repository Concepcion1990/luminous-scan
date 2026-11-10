/**
 * The three spreadsheet operations, kept separate on purpose: creating new
 * products, correcting product details, and receiving stock. Each one has its
 * own columns, its own checks and its own write path.
 */

import { normalizeHeader } from '@/lib/csvImport';

const UNITS = ['each', 'case', 'pair', 'pack', 'kg'];
const STATUSES = ['active', 'draft', 'archived', 'discontinued'];

export const IMPORT_MODES = [
  {
    id: 'create',
    label: 'Create new products',
    hint: 'Add products that are not in the catalog yet, with optional opening stock.',
  },
  {
    id: 'update',
    label: 'Update existing products',
    hint: 'Correct names, prices, categories and other details. Quantities are never touched.',
  },
  {
    id: 'receive',
    label: 'Receive stock',
    hint: 'Add arriving quantities to one location and record them in the movement ledger.',
  },
];

/** Fields a product-update sheet can carry. `kind` decides how a cell is read. */
export const UPDATE_FIELDS = [
  { key: 'id', label: 'Record ID', kind: 'id' },
  { key: 'sku', label: 'SKU (match key)', kind: 'sku' },
  { key: 'name', label: 'Product name' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'tags', label: 'Tags (comma separated)', kind: 'tags' },
  { key: 'condition', label: 'Condition' },
  { key: 'cost', label: 'Unit cost', kind: 'number' },
  { key: 'price', label: 'Retail price', kind: 'number' },
  { key: 'supplier_name', label: 'Preferred supplier' },
  { key: 'weight', label: 'Weight' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'notes', label: 'Notes' },
  { key: 'author', label: 'Author' },
  { key: 'brand', label: 'Brand' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'unit', label: 'Unit of measure', kind: 'unit' },
  { key: 'reorder_point', label: 'Reorder point', kind: 'number' },
  { key: 'status', label: 'Product status', kind: 'status' },
];

/** Fields a stock-receipt sheet can carry. */
export const RECEIVE_FIELDS = [
  { key: 'id', label: 'Record ID', kind: 'id' },
  { key: 'sku', label: 'SKU (match key)', kind: 'sku' },
  { key: 'quantity', label: 'Quantity received', kind: 'number' },
  { key: 'unit_cost', label: 'Unit cost', kind: 'number' },
  { key: 'reference', label: 'Reference (PO / invoice)' },
  { key: 'supplier_name', label: 'Supplier' },
  { key: 'note', label: 'Note' },
];

const UPDATE_SYNONYMS = {
  id: ['id', 'recordid', 'productid', 'internalid', 'recordnumber'],
  sku: ['sku', 'itemcode', 'productcode', 'code'],
  name: ['name', 'productname', 'title', 'item', 'itemname'],
  description: ['description', 'details', 'longdescription'],
  category: ['category', 'department'],
  subcategory: ['subcategory', 'subtype'],
  tags: ['tags', 'tag', 'keywords', 'labels'],
  condition: ['condition', 'grade', 'state'],
  cost: ['cost', 'unitcost', 'buyprice', 'wholesale'],
  price: ['price', 'retail', 'retailprice', 'sellprice', 'rrp', 'msrp'],
  supplier_name: ['supplier', 'suppliername', 'preferredsupplier', 'vendor'],
  weight: ['weight', 'shippingweight'],
  dimensions: ['dimensions', 'measurements', 'size'],
  notes: ['notes', 'note', 'memo', 'comments'],
  author: ['author', 'writer'],
  brand: ['brand', 'make'],
  publisher: ['publisher', 'imprint'],
  unit: ['unit', 'uom', 'unitofmeasure'],
  reorder_point: ['reorderpoint', 'reorder', 'min', 'minimum', 'minstock'],
  status: ['status', 'productstatus'],
};

const RECEIVE_SYNONYMS = {
  id: ['id', 'recordid', 'productid', 'internalid', 'recordnumber'],
  sku: ['sku', 'itemcode', 'productcode', 'code', 'upc', 'barcode', 'isbn'],
  quantity: ['quantity', 'qty', 'received', 'receiving', 'receivedqty', 'incoming', 'units', 'count'],
  unit_cost: ['unitcost', 'cost', 'costprice', 'buyprice'],
  reference: ['reference', 'po', 'ponumber', 'purchaseorder', 'invoice', 'invoicenumber', 'orderref'],
  supplier_name: ['supplier', 'suppliername', 'vendor'],
  note: ['note', 'notes', 'comment', 'memo', 'remark'],
};

function guessFrom(header, table) {
  const key = normalizeHeader(header);
  if (!key) return '';
  const exact = Object.entries(table).find(([, list]) => list.includes(key));
  if (exact) return exact[0];
  const partial = Object.entries(table).find(([, list]) =>
    list.some((synonym) => synonym.length > 2 && key.includes(synonym))
  );
  return partial ? partial[0] : '';
}

export const guessUpdateField = (header) => guessFrom(header, UPDATE_SYNONYMS);
export const guessReceiveField = (header) => guessFrom(header, RECEIVE_SYNONYMS);

export const normalizeText = (value) => String(value ?? '').trim();

export function toNumber(value) {
  const cleaned = String(value ?? '').replace(/[^0-9.\-]/g, '');
  if (!cleaned) return undefined;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : undefined;
}

function display(kind, value) {
  if (kind === 'tags') return (Array.isArray(value) ? value : []).join(', ');
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function productIndex(products) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const bySku = new Map();
  products.forEach((product) => {
    const key = normalizeText(product.sku).toLowerCase();
    if (!key) return;
    const list = bySku.get(key) || [];
    list.push(product);
    bySku.set(key, list);
  });
  return { byId, bySku };
}

function pickCells(cells, mapping) {
  const picked = {};
  mapping.forEach((field, column) => {
    if (field) picked[field] = cells[column] || '';
  });
  return picked;
}

/** Turns one cell into the value a product field should hold, or explains why not. */
function proposeValue(definition, text) {
  if (definition.kind === 'number') {
    const number = toNumber(text);
    if (number === undefined) return { error: `${definition.label} is not a number` };
    return { value: number };
  }
  if (definition.kind === 'tags') {
    return {
      value: text
        .split(/[,;]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
  }
  if (definition.kind === 'unit') {
    const unit = text.toLowerCase();
    if (!UNITS.includes(unit)) return { error: `Unit of measure must be one of ${UNITS.join(', ')}` };
    return { value: unit };
  }
  if (definition.kind === 'status') {
    const status = text.toLowerCase();
    if (!STATUSES.includes(status)) return { error: `Product status must be one of ${STATUSES.join(', ')}` };
    return { value: status };
  }
  return { value: text };
}

/**
 * Every row of an update sheet with the changes it would make: the old value,
 * the proposed new value and nothing else. Nothing is written here.
 */
export function evaluateUpdates({ table, mapping, products = [], clearBlanks = false }) {
  const empty = { rows: [], changed: 0, same: 0, skipped: 0, fieldCount: 0, problems: [] };
  if (!table) return empty;

  const { byId, bySku } = productIndex(products);
  const keyField = mapping.includes('id') ? 'id' : mapping.includes('sku') ? 'sku' : '';

  const rows = table.rows.map((cells, index) => {
    const picked = pickCells(cells, mapping);
    if (!keyField) {
      return { index, name: '', status: 'skip', problem: 'Match a SKU or Record ID column first' };
    }
    const key = normalizeText(picked[keyField]);
    if (!key) {
      return {
        index,
        name: normalizeText(picked.name),
        status: 'skip',
        problem: keyField === 'id' ? 'Missing record ID' : 'Missing SKU',
      };
    }

    let product = null;
    if (keyField === 'id') {
      product = byId.get(key) || null;
    } else {
      const matches = bySku.get(key.toLowerCase()) || [];
      if (matches.length > 1) {
        return {
          index,
          name: normalizeText(picked.name) || key,
          status: 'skip',
          problem: `SKU ${key} belongs to ${matches.length} products — match by record ID instead`,
        };
      }
      product = matches[0] || null;
    }

    if (!product) {
      return {
        index,
        name: normalizeText(picked.name) || key,
        status: 'skip',
        problem:
          keyField === 'id'
            ? 'No product in this business has that record ID'
            : `No product in this business has SKU ${key}`,
      };
    }

    const changes = [];
    const values = {};
    let failure = '';

    UPDATE_FIELDS.forEach((definition) => {
      const field = definition.key;
      if (field === 'id' || field === 'sku') return;
      if (!mapping.includes(field)) return;

      const text = normalizeText(picked[field]);
      if (!text) {
        // A blank cell leaves the field alone unless the merchant asked to clear blanks.
        if (!clearBlanks || definition.kind === 'number') return;
      }

      const proposed = proposeValue(definition, text);
      if (proposed.error) {
        failure = proposed.error;
        return;
      }

      const before = product[field];
      if (definition.kind === 'number') {
        if (Number(before || 0) === Number(proposed.value)) return;
      } else if (definition.kind === 'tags') {
        const beforeList = Array.isArray(before) ? before : [];
        if (beforeList.join('|').toLowerCase() === proposed.value.join('|').toLowerCase()) return;
      } else if (normalizeText(before) === normalizeText(proposed.value)) {
        return;
      }

      changes.push({
        field,
        label: definition.label,
        before: display(definition.kind, before),
        after: display(definition.kind, proposed.value),
      });
      values[field] = proposed.value;
    });

    if (failure) return { index, name: product.name, status: 'skip', problem: failure };
    if (!changes.length) return { index, name: product.name, status: 'same', product };
    return { index, name: product.name, status: 'change', product, changes, values };
  });

  const changed = rows.filter((row) => row.status === 'change');
  return {
    rows,
    changed: changed.length,
    same: rows.filter((row) => row.status === 'same').length,
    skipped: rows.filter((row) => row.status === 'skip').length,
    fieldCount: changed.reduce((sum, row) => sum + row.changes.length, 0),
    problems: rows.filter((row) => row.problem),
  };
}

/**
 * Every row of a receipt sheet: which product it matched, what is on hand now
 * and what would be on hand afterwards. Nothing is written here.
 */
export function evaluateReceipts({ table, mapping, products = [], levels = [], locationId = '' }) {
  const empty = { rows: [], ready: 0, skipped: 0, units: 0, problems: [] };
  if (!table) return empty;

  const { byId, bySku } = productIndex(products);
  const keyField = mapping.includes('id') ? 'id' : mapping.includes('sku') ? 'sku' : '';
  const levelByProduct = new Map(
    levels.filter((level) => !locationId || level.location_id === locationId).map((level) => [level.product_id, level])
  );
  const firstRowFor = new Map();

  const rows = table.rows.map((cells, index) => {
    const picked = pickCells(cells, mapping);
    if (!keyField) {
      return { index, name: '', status: 'skip', problem: 'Match a SKU or Record ID column first' };
    }

    const key = normalizeText(picked[keyField]);
    if (!key) {
      return {
        index,
        name: normalizeText(picked.name),
        status: 'skip',
        problem: keyField === 'id' ? 'Missing record ID' : 'Missing SKU',
      };
    }

    let product = null;
    if (keyField === 'id') {
      product = byId.get(key) || null;
    } else {
      const matches = bySku.get(key.toLowerCase()) || [];
      if (matches.length > 1) {
        return {
          index,
          name: key,
          status: 'skip',
          problem: `SKU ${key} belongs to ${matches.length} products — receive it by record ID instead`,
        };
      }
      product = matches[0] || null;
    }

    if (!product) {
      return {
        index,
        name: key,
        status: 'skip',
        problem:
          keyField === 'id'
            ? 'No product in this business has that record ID'
            : `No product in this business has SKU ${key}`,
      };
    }

    if (firstRowFor.has(product.id)) {
      return {
        index,
        name: product.name,
        status: 'skip',
        problem: `Already on row ${firstRowFor.get(product.id) + 2} — combine both rows into one`,
      };
    }

    const incoming = toNumber(picked.quantity);
    if (incoming === undefined) return { index, name: product.name, status: 'skip', problem: 'Quantity received is missing' };
    if (incoming <= 0) return { index, name: product.name, status: 'skip', problem: 'Receive more than zero' };
    if (!Number.isInteger(incoming)) {
      return { index, name: product.name, status: 'skip', problem: 'Receive whole units only' };
    }
    if (!locationId) return { index, name: product.name, status: 'skip', problem: 'Choose a location first' };

    firstRowFor.set(product.id, index);
    const previous = levelByProduct.get(product.id)?.quantity ?? 0;
    return {
      index,
      name: product.name,
      sku: product.sku || '',
      status: 'ready',
      product,
      incoming,
      previous,
      next: previous + incoming,
      unitCost: toNumber(picked.unit_cost),
      reference: normalizeText(picked.reference),
      supplier: normalizeText(picked.supplier_name),
      note: normalizeText(picked.note),
    };
  });

  const ready = rows.filter((row) => row.status === 'ready');
  return {
    rows,
    ready: ready.length,
    skipped: rows.length - ready.length,
    units: ready.reduce((sum, row) => sum + row.incoming, 0),
    problems: rows.filter((row) => row.problem),
  };
}