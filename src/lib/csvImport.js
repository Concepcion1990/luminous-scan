/**
 * CSV import helpers. Spreadsheets arrive with their own column names, so the
 * importer maps columns to product fields before anything is written.
 */

import { t } from './i18n.js';

export const IMPORT_FIELDS = [
  { key: 'name', get label() { return t('importLib.field.name'); }, required: true },
  { key: 'sku', get label() { return t('importLib.field.sku'); } },
  { key: 'upc', get label() { return t('importLib.field.upc'); } },
  { key: 'barcode', get label() { return t('importLib.field.barcode'); } },
  { key: 'isbn', get label() { return t('importLib.field.isbn'); } },
  { key: 'author', get label() { return t('importLib.field.author'); } },
  { key: 'category', get label() { return t('importLib.field.category'); } },
  { key: 'subcategory', get label() { return t('importLib.field.subcategory'); } },
  { key: 'tags', get label() { return t('importLib.field.tags'); } },
  { key: 'brand', get label() { return t('importLib.field.brand'); } },
  { key: 'publisher', get label() { return t('importLib.field.publisher'); } },
  { key: 'condition', get label() { return t('importLib.field.condition'); } },
  { key: 'unit', get label() { return t('importLib.field.unit'); } },
  { key: 'cost', get label() { return t('importLib.field.cost'); } },
  { key: 'price', get label() { return t('importLib.field.price'); } },
  { key: 'reorder_point', get label() { return t('importLib.field.reorderPoint'); } },
  { key: 'stock_qty', get label() { return t('importLib.field.stockQty'); } },
  { key: 'description', get label() { return t('importLib.field.description'); } },
];

const UNITS = ['each', 'case', 'pair', 'pack', 'kg'];

const SYNONYMS = {
  name: ['name', 'productname', 'product', 'title', 'item', 'itemname', 'descriptionname'],
  sku: ['sku', 'sku', 'itemcode', 'productcode', 'code', 'id'],
  upc: ['upc', 'ean', 'ean13', 'gtin', 'upccode'],
  barcode: ['barcode', 'barcodeno', 'scan'],
  isbn: ['isbn', 'isbn10', 'isbn13'],
  author: ['author', 'by', 'writer'],
  category: ['category', 'department', 'type', 'collection'],
  subcategory: ['subcategory', 'subtype', 'subdepartment'],
  tags: ['tags', 'tag', 'keywords', 'labels'],
  brand: ['brand', 'make'],
  publisher: ['publisher', 'label', 'imprint'],
  condition: ['condition', 'grade', 'state'],
  unit: ['unit', 'uom', 'unitofmeasure'],
  cost: ['cost', 'unitcost', 'wholesale', 'buyprice', 'purchaseprice'],
  price: ['price', 'retail', 'retailprice', 'sellprice', 'rrp', 'msrp'],
  reorder_point: ['reorderpoint', 'reorder', 'reorderat', 'min', 'minimum', 'minstock'],
  stock_qty: ['stock', 'qty', 'quantity', 'onhand', 'stockqty', 'openingstock', 'units'],
  description: ['description', 'notes', 'details', 'longdescription'],
};

export function normalizeHeader(header) {
  return String(header || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Best-guess field for one spreadsheet column, or '' for "ignore". */
export function guessField(header) {
  const key = normalizeHeader(header);
  if (!key) return '';
  const exact = Object.entries(SYNONYMS).find(([, list]) => list.includes(key));
  if (exact) return exact[0];
  const partial = Object.entries(SYNONYMS).find(([, list]) =>
    list.some((synonym) => key.includes(synonym) && synonym.length > 2)
  );
  return partial ? partial[0] : '';
}

function detectDelimiter(line) {
  const commas = (line.match(/,/g) || []).length;
  const semicolons = (line.match(/;/g) || []).length;
  const tabs = (line.match(/\t/g) || []).length;
  if (tabs > commas && tabs > semicolons) return '\t';
  return semicolons > commas ? ';' : ',';
}

/** RFC-style reader: quoted commas, escaped quotes and line breaks inside cells. */
export function parseCsv(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '');
  if (!clean.trim()) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(clean.slice(0, clean.indexOf('\n') + 1 || clean.length));
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    records.push(row);
  }

  const nonEmpty = records.filter((cells) => cells.some((cell) => String(cell).trim()));
  const [headerRow = [], ...body] = nonEmpty;
  return {
    headers: headerRow.map((header) => String(header).trim()),
    rows: body.map((cells) => headerRow.map((_, index) => String(cells[index] ?? '').trim())),
  };
}

function parseNumber(value) {
  const cleaned = String(value ?? '').replace(/[^0-9.\-]/g, '');
  if (!cleaned) return undefined;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : undefined;
}

function slugSku(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

/** Turns one mapped row into a product payload, or returns why it cannot be imported. */
export function draftFromRow(picked) {
  const name = String(picked.name || '').trim();
  if (!name) return { error: 'Missing product name' };

  const draft = {
    name,
    sku: String(picked.sku || '').trim(),
    upc: String(picked.upc || '').trim(),
    barcode: String(picked.barcode || '').trim(),
    isbn: String(picked.isbn || '').trim(),
    author: String(picked.author || '').trim(),
    category: String(picked.category || '').trim(),
    subcategory: String(picked.subcategory || '').trim(),
    tags: String(picked.tags || '')
      .split(/[,;]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    brand: String(picked.brand || '').trim(),
    publisher: String(picked.publisher || '').trim(),
    condition: String(picked.condition || '').trim(),
    unit: UNITS.includes(String(picked.unit || '').toLowerCase().trim())
      ? String(picked.unit).toLowerCase().trim()
      : 'each',
    cost: parseNumber(picked.cost),
    price: parseNumber(picked.price),
    reorder_point: parseNumber(picked.reorder_point) ?? 0,
    description: String(picked.description || '').trim(),
    status: 'active',
  };

  if (draft.cost === undefined) delete draft.cost;
  if (draft.price === undefined) delete draft.price;

  const quantity = Math.max(0, Math.round(parseNumber(picked.stock_qty) ?? 0));
  return { draft, quantity };
}

/** A SKU that is not already taken by the catalog or earlier rows in the file. */
export function uniqueSku(name, taken, fallbackIndex = 1) {
  const base = slugSku(name) || `ITEM-${fallbackIndex}`;
  let candidate = base;
  let attempt = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base}-${attempt}`;
    attempt += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}