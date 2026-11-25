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
  { key: 'format', get label() { return t('importLib.field.format'); } },
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
  { key: 'photo', get label() { return t('importLib.field.photo'); } },
];

/**
 * The mapping targets a plan may see (owner ruling, Nov 20, 2026):
 * the reorder point is a Business low-stock surface, so off
 * Business it is not offered as a mapping target and not printed
 * in the downloadable template. A reorder column that arrives in
 * a sheet anyway is simply never mapped there — the parse path
 * below is unchanged, and any value that reaches a product
 * through another path still stores harmlessly.
 */
export function importFieldsForPlan(planKey) {
  return planKey === 'business'
    ? IMPORT_FIELDS
    : IMPORT_FIELDS.filter((field) => field.key !== 'reorder_point');
}

const UNITS = ['each', 'case', 'pair', 'pack', 'kg'];

const SYNONYMS = {
  name: ['name', 'productname', 'product', 'title', 'item', 'itemname', 'descriptionname', 'producttitle', 'listingtitle', 'itemtitle', 'booktitle'],
  sku: ['sku', 'itemcode', 'productcode', 'code', 'id', 'customlabelsku', 'customlabel', 'sellersku', 'merchantsku'],
  upc: ['upc', 'ean', 'ean13', 'gtin', 'upccode', 'pupc', 'pean'],
  barcode: ['barcode', 'barcodeno', 'scan'],
  isbn: ['isbn', 'isbn10', 'isbn13', 'pisbn', 'isbnnumber'],
  author: ['author', 'by', 'writer'],
  format: ['bookformat', 'binding'],
  category: ['category', 'department', 'type', 'collection', 'categoryname', 'category1name', 'storecategory'],
  subcategory: ['subcategory', 'subtype', 'subdepartment'],
  tags: ['tags', 'tag', 'keywords', 'labels'],
  brand: ['brand', 'make'],
  publisher: ['publisher', 'label', 'imprint'],
  condition: ['condition', 'grade', 'state', 'itemcondition'],
  unit: ['unit', 'uom', 'unitofmeasure'],
  cost: ['cost', 'unitcost', 'wholesale', 'buyprice', 'purchaseprice'],
  price: ['price', 'retail', 'retailprice', 'sellprice', 'rrp', 'msrp', 'startprice', 'currentprice', 'buyitnowprice', 'listprice'],
  reorder_point: ['reorderpoint', 'reorder', 'reorderat', 'min', 'minimum', 'minstock'],
  stock_qty: ['stock', 'qty', 'quantity', 'onhand', 'stockqty', 'openingstock', 'units', 'availablequantity', 'quantityavailable', 'qtyavailable', 'unitsonhand', 'stockonhand', 'inventory'],
  description: ['description', 'notes', 'details', 'longdescription'],
  photo: ['image', 'imageurl', 'photo', 'photourl', 'picture', 'pictureurl', 'mainimage', 'primaryimage', 'image1', 'pic'],
};

/**
 * Columns that carry a marketplace's own bookkeeping, never a product
 * field (owner's import night, Nov 23, 2026): an eBay "Item number"
 * is an identifier for eBay's shelf, not the product's name — the old
 * loose matching read it (and the ePID column, through the word
 * "product") AS the name, so rows wore catalog numbers as names and
 * every row without one was "missing" its name. "Format" on a
 * marketplace sheet is the listing type (fixed price / auction),
 * never the product's format, and "Variation details" is not a
 * description. These never auto-match; the owner can still marry
 * any of them by hand.
 *
 * The guard matters MORE, not less, since the product gained a
 * real Format field of its own (Nov 24, 2026): 'format' stays in
 * this set, so a marketplace "Format" column still never marries
 * the product's Format on its own — and the field's synonyms
 * ('bookformat', 'binding') deliberately exclude the bare word,
 * so no header that normalizes to 'format' can score for it
 * either. A sheet whose column genuinely names the book's format
 * ("Book format", "Binding") auto-matches; the owner marries a
 * bare "Format" column by hand only when it truly is one.
 */
const NEVER_AUTO_MATCH = new Set([
  'itemnumber',
  'itemid',
  'listingid',
  'ebayproductidepid',
  'epid',
  'format',
  'variationdetails',
]);

export function normalizeHeader(header) {
  return String(header || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * How strongly one normalized header speaks for one field: an exact
 * synonym is a shout, a synonym at either edge is a statement, a
 * synonym buried mid-word is only a hint. The old matcher took the
 * FIRST field with any buried hint — field order, not meaning,
 * decided — which is how a price column could be read as a cost and
 * an identifier as a name.
 */
function guessScore(key, synonyms) {
  let best = 0;
  for (const synonym of synonyms) {
    // An exact synonym match is an exact match: no length bonus,
    // so when two columns both name a field exactly (a seller
    // sheet's Start price AND Current price), the EARLIER column
    // wins the claim in guessFields — the listing's start price,
    // not whichever synonym happens to be longer.
    if (key === synonym) best = Math.max(best, 1000);
    else if (synonym.length > 2 && (key.startsWith(synonym) || key.endsWith(synonym))) {
      best = Math.max(best, 100 + synonym.length);
    } else if (synonym.length >= 4 && key.includes(synonym)) {
      best = Math.max(best, 10 + synonym.length);
    }
  }
  return best;
}

/** Best-guess field for one spreadsheet column, or '' for "ignore". */
export function guessField(header) {
  const key = normalizeHeader(header);
  if (!key || NEVER_AUTO_MATCH.has(key)) return '';
  let field = '';
  let score = 0;
  for (const [candidate, synonyms] of Object.entries(SYNONYMS)) {
    const candidateScore = guessScore(key, synonyms);
    if (candidateScore > score) {
      field = candidate;
      score = candidateScore;
    }
  }
  return field;
}

/**
 * Guesses for a whole sheet, with one rule the single-column guess
 * cannot know: a field can be married to only ONE column. When two
 * columns speak for the same field (an eBay sheet carries Start
 * price, Buy It Now price, Reserve price AND Current price), the
 * strongest voice keeps the field and the rest fall back to Ignore —
 * visible in the mapper, never silently overwritten at read time
 * (the old last-column-wins read is what married a name column to a
 * catalog number). Ties go to the earlier column.
 */
export function guessFields(headers) {
  const scored = headers.map((header) => {
    const key = normalizeHeader(header);
    if (!key || NEVER_AUTO_MATCH.has(key)) return { field: '', score: 0 };
    let field = '';
    let score = 0;
    for (const [candidate, synonyms] of Object.entries(SYNONYMS)) {
      const candidateScore = guessScore(key, synonyms);
      if (candidateScore > score) {
        field = candidate;
        score = candidateScore;
      }
    }
    return { field, score };
  });
  const claimed = new Set();
  const order = scored
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.field)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const entry of order) {
    if (claimed.has(entry.field)) scored[entry.index] = { field: '', score: 0 };
    else claimed.add(entry.field);
  }
  return scored.map((entry) => entry.field);
}

/**
 * The quantity marriage guard (owner ruling, Nov 23, 2026): a column
 * that plainly holds quantities but is currently married to some
 * OTHER field would strand every unit in the file — the products
 * would be created with no stock counted and nothing would say so.
 * Returns that column's header, or null when the road is clear (the
 * column is married to Opening stock quantity, or the owner has
 * deliberately set it to Ignore).
 */
export function unmarriedQuantityColumn(headers, mapping) {
  for (let index = 0; index < headers.length; index += 1) {
    const married = mapping[index] || '';
    if (married !== 'stock_qty' && married !== 'ignore' && guessField(headers[index]) === 'stock_qty') {
      return headers[index];
    }
  }
  return null;
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Source files often arrive web-escaped ('Legends &amp; Lattes').
 * The catalog must hold the true text, so every cell is decoded
 * once, at parse time — the preview, the dry run and the write
 * all see the same decoded value (owner ruling, Nov 15, 2026:
 * 'customers shouldn't have to go in and edit it'). One pass:
 * '&amp;lt;' decodes to the literal '&lt;', never to '<'.
 * Unknown entities pass through untouched.
 */
export function decodeHtmlEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
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
  // An exported CSV's trailing "Exported at: <ISO>" stamp line
  // (release 357) is file metadata, not data: it is dropped
  // before the header/body split, so re-importing a file this
  // app exported stays exactly as clean as before. The match
  // is deliberately narrow — a FINAL record of one cell holding
  // the stamp and nothing else — so a user's own sheet can only
  // lose a row that is the stamp itself. (A leading line would
  // have been mistaken for the header row; that is why the
  // stamp trails the data instead.)
  const lastRecord = nonEmpty[nonEmpty.length - 1];
  if (
    lastRecord
    && lastRecord.length === 1
    && /^Exported at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(lastRecord[0]).trim())
  ) {
    nonEmpty.pop();
  }
  const [headerRow = [], ...body] = nonEmpty;
  return {
    headers: headerRow.map((header) => decodeHtmlEntities(String(header).trim())),
    rows: body.map((cells) =>
      headerRow.map((_, index) => decodeHtmlEntities(String(cells[index] ?? '').trim())),
    ),
  };
}

export function parseNumber(value) {
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

/**
 * The identity the importer itself derives for a row with no SKU of
 * its own: the generated SKU's base, before any uniqueness suffix.
 * Duplicate judgment (client and server alike) reads a row by this
 * identity, so re-importing the same file recognizes its own
 * products instead of twinning them (owner ruling, Nov 23, 2026).
 */
export function generatedSkuFor(name) {
  return slugSku(name);
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
    format: String(picked.format || '').trim(),
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
  // A photo link is not a product field — it rides beside the draft
  // and the commit fetches it into the app's own photo storage.
  const photoUrl = String(picked.photo || '').trim();
  return { draft, quantity, photoUrl };
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