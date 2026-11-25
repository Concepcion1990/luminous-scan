/**
 * The product form batch (Nov 24, 2026) — the owner's two rulings
 * from her Nov 23 hand-testing:
 *
 *   1. STACKING. The product form's fields stack — every field
 *      its own full-width row, on the website too, not just on
 *      narrow screens (the Nov 20 ruling stacked them below the
 *      sm breakpoint only; this one removes the pairs at every
 *      width), in HER field order: Product name → SKU → Category
 *      → ISBN → Author → UPC/EAN → Barcode → QR code value
 *      (directly under Barcode) → then the rest as they were.
 *      Both plans, staff included — anyone who can open the form
 *      sees the same stacked form.
 *
 *   2. THE FORMAT FIELD. A new Format row in the form (Paperback
 *      / Hardcover — her own book-trade field), both plans: a
 *      real product field (migration 053), stored on the product
 *      and carried everywhere Author is carried — the form, the
 *      product view, the create + update importers and the
 *      exports. The importer's guard survives it: eBay's "Format"
 *      column (the listing type, fixed price vs auction) still
 *      NEVER auto-matches, in either importer — it stays Ignored
 *      unless the owner marries it by hand.
 *
 *   OWNER CORRECTION (Nov 24, 2026, mid-build): Format is a
 *   PICK-LIST, not free text. The dropdown starts with Paperback
 *   and Hardcover and carries an "Add a format…" row: the name
 *   typed there joins THAT BUSINESS's format list, pickable from
 *   then on. Owner-added formats ride the app's existing
 *   per-business vocabulary machinery — the Category entity with
 *   kind 'format', created through the same AddVocabularyDialog
 *   door and the same categories.manage gate as a new category —
 *   and the form's list is the built-ins plus that business's
 *   vocabulary formats. The pick-list is proven by behavior
 *   below (HTTP level, through the real routes), not only by
 *   source pins: an added format persists, is pickable for
 *   another product afterwards, a chosen format saves and reads
 *   back, and an untouched product stays unset.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, req, resetRateLimits, close } from '../t2/helpers.js';
import { ownerWithBusiness, createProducts } from '../t3/helpers.js';
import {
  IMPORT_FIELDS,
  guessField,
  guessFields,
  draftFromRow,
} from '../../src/lib/csvImport.js';

// importModes.js imports through the '@' alias; rewrite it to a
// relative path in a temp copy so node can load the real module
// (the t61 trick).
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const modesSrc = readFileSync(path.join(repoRoot, 'src/lib/importModes.js'), 'utf8')
  .replace('@/lib/csvImport', path.join(repoRoot, 'src/lib/csvImport.js'))
  .replace('./i18n.js', path.join(repoRoot, 'src/lib/i18n.js'));
const modesTmp = path.join(tmpdir(), 'importModes64.testable.mjs');
writeFileSync(modesTmp, modesSrc);
const { UPDATE_FIELDS, guessUpdateField } = await import(pathToFileURL(modesTmp).href);
import { EXPORTS } from '../../server/exportData.js';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';

after(close);
beforeEach(() => resetRateLimits());

const dialog = readFileSync(
  new URL('../../src/components/products/ProductFormDialog.jsx', import.meta.url),
  'utf8',
);
const details = readFileSync(
  new URL('../../src/components/products/ProductDetailsFields.jsx', import.meta.url),
  'utf8',
);
const detailsDialog = readFileSync(
  new URL('../../src/components/products/ProductDetailsDialog.jsx', import.meta.url),
  'utf8',
);
const shopRoutes = readFileSync(
  new URL('../../server/shopRoutes.js', import.meta.url),
  'utf8',
);
const clientExports = readFileSync(
  new URL('../../src/lib/exportData.js', import.meta.url),
  'utf8',
);

test('stacking: no multi-column field grid survives anywhere in the form, at any width', () => {
  for (const [name, source] of [['dialog', dialog], ['details', details]]) {
    assert.ok(!/grid-cols-[23]/.test(source), `${name}: a paired grid survives`);
    assert.ok(!/sm:grid-cols/.test(source), `${name}: a breakpoint pair survives`);
  }
});

test('stacking: the head of the form reads in her field order, QR directly under Barcode', () => {
  const markers = [
    'id="name"',
    'id="sku"',
    'id="category"',
    'id="isbn"',
    'id="author"',
    "t('productForm.formatLabel')",
    'id="upc"',
    'id="barcode"',
    'id="qr_code"',
  ];
  const positions = markers.map((marker) => dialog.indexOf(marker));
  positions.forEach((position, i) => {
    assert.ok(position > -1, `marker missing from the form: ${markers[i]}`);
    if (i > 0) {
      assert.ok(position > positions[i - 1], `${markers[i]} must come after ${markers[i - 1]}`);
    }
  });
});

test('stacking: the More-details fields keep their old order, one per row', () => {
  const markers = [
    'id="brand"', 'id="manufacturer"', 'id="publisher"', 'id="edition"',
    'id="subcategory"', 'id="tags"', "t('productForm.statusLabel')",
    "t('productForm.fulfillmentLabel')", 'id="acquired"', 'id="expires"',
    'id="batch"', 'id="serial"', 'id="weight"', 'id="dimensions"',
    'id="warranty"',
  ];
  const positions = markers.map((marker) => details.indexOf(marker));
  positions.forEach((position, i) => {
    assert.ok(position > -1, `marker missing from More details: ${markers[i]}`);
    if (i > 0) {
      assert.ok(position > positions[i - 1], `${markers[i]} must come after ${markers[i - 1]}`);
    }
  });
});

test('format field: the form holds it, seeds it, saves it, and offers Paperback / Hardcover', () => {
  assert.ok(dialog.includes("const FORMATS = ['Paperback', 'Hardcover'];"), 'the two formats are the picker values');
  assert.ok(dialog.includes("format: '',"), 'a new product starts with no format');
  assert.ok(dialog.includes("format: product.format || '',"), 'editing opens with the stored format');
  assert.ok(dialog.includes("format: seed.format || '',"), 'a seeded form carries the format');
  assert.ok(dialog.includes('format: form.format,'), 'the save payload carries the format');
  assert.ok(dialog.includes("t('productForm.formatPaperback')"), 'the Paperback label translates');
  assert.ok(dialog.includes("t('productForm.formatHardcover')"), 'the Hardcover label translates');
  // No plan gate touches the field: it renders for every plan,
  // like Author beside it.
  const formatRow = dialog.slice(dialog.indexOf("t('productForm.formatLabel')"));
  assert.ok(!/can\(|canPricing|canSuppliers|canAlerts/.test(formatRow.slice(0, 900)), 'the Format row is not plan-gated');
});

test('format pick-list: the dropdown carries the business list and the "Add a format…" door', () => {
  // The list is the built-ins plus THIS BUSINESS's vocabulary
  // formats (kind 'format' in the Category entity, read through
  // the shared vocabulary hook) plus anything born this session.
  assert.ok(dialog.includes('...(vocabulary.formats || [])'), 'the business’s own formats join the built-ins');
  assert.ok(dialog.includes('value="__add_format__"'), 'the picker carries the add-a-format row');
  assert.ok(dialog.includes("t('productForm.addFormatOption')"), 'the add-a-format row speaks through its key');
  assert.ok(dialog.includes("setAddFormatOpen(true)"), 'picking the row opens the add window, it does not become a value');
  // The door is the app's own vocabulary window, on the same
  // entity and the same gate as minting a category.
  assert.ok(dialog.includes('kind="format"'), 'the add window creates a format vocabulary entry');
  const hook = readFileSync(new URL('../../src/hooks/useCatalogVocabulary.js', import.meta.url), 'utf8');
  assert.ok(hook.includes("formats: names('format')"), 'the vocabulary hook serves the business’s format list');
  const addRow = dialog.slice(dialog.indexOf('value="__add_format__"') - 200, dialog.indexOf('value="__add_format__"'));
  assert.ok(addRow.includes('canManageCategories'), 'the add row rides the categories.manage gate, like minting a category');
});

test('format pick-list (behavior): an added format persists per business and is pickable for another product afterwards', async () => {
  const owner = await ownerWithBusiness('t64-formats@example.com');
  // "Add a format…" — the exact write the vocabulary window makes.
  const added = await req('/api/entities/Category', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      name: 'Spiral-bound',
      kind: 'format',
      parent_id: '',
      parent_name: '',
    },
    cookie: owner.cookie,
  });
  assert.equal(added.status, 201, added.text);
  assert.equal(added.json.name, 'Spiral-bound');

  // The business's format list, read back through the same query
  // the vocabulary hook makes, now carries it.
  const list = await req('/api/entities/Category/query', {
    method: 'POST',
    body: { filter: { business_id: owner.business.id, kind: 'format' } },
    cookie: owner.cookie,
  });
  assert.equal(list.status, 200, list.text);
  const names = (list.json.items ?? list.json).map((row) => row.name);
  assert.ok(names.includes('Spiral-bound'), 'the added format reads back on the business’s list');

  // Pickable for a product — and then for ANOTHER product.
  const [first, second] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'First Spiral', sku: 'T64-FMT-1', format: 'Spiral-bound' },
    { name: 'Second Spiral', sku: 'T64-FMT-2', format: 'Spiral-bound' },
  ]);
  assert.equal(first.format, 'Spiral-bound', 'the first product keeps the added format');
  assert.equal(second.format, 'Spiral-bound', 'the added format is pickable again afterwards');

  // It reads back on the product's own read surface.
  const readBack = await req(`/api/entities/Product/${first.id}`, { cookie: owner.cookie });
  assert.equal(readBack.status, 200, readBack.text);
  assert.equal(readBack.json.format, 'Spiral-bound', 'the product read carries the chosen format');

  // Per business: another owner's business has no such format.
  const other = await ownerWithBusiness('t64-formats-other@example.com');
  const otherList = await req('/api/entities/Category/query', {
    method: 'POST',
    body: { filter: { business_id: other.business.id, kind: 'format' } },
    cookie: other.cookie,
  });
  const otherNames = (otherList.json.items ?? otherList.json).map((row) => row.name);
  assert.ok(!otherNames.includes('Spiral-bound'), 'the format list belongs to its own business only');

  // No default sneaks in: a product that never chose stays unset.
  const [plain] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'No Format Chosen', sku: 'T64-FMT-3' },
  ]);
  assert.equal(plain.format ?? '', '', 'an untouched product’s format stays empty');
});

test('format field: the product view shows it, right after Author', () => {
  const authorAt = detailsDialog.indexOf("t('productDetails.rowAuthor')");
  const formatAt = detailsDialog.indexOf("t('productDetails.rowFormat')");
  assert.ok(authorAt > -1 && formatAt > authorAt, 'the Format row follows the Author row');
  assert.ok(detailsDialog.includes('value={product.format}'), 'the row reads the stored format');
});

test('format field: migration 053 adds the column, empty by default', () => {
  const migration = readFileSync(
    new URL('../../migrations/053_product_format.sql', import.meta.url),
    'utf8',
  );
  assert.ok(
    migration.includes("ALTER TABLE products ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT '';"),
    'the column lands in the sibling text columns’ own shape',
  );
});

test('format field: a product created through the entity door stores it; unset starts empty; an edit changes it', async () => {
  const owner = await ownerWithBusiness('t64-entity@example.com');
  const [book] = await createProducts(owner.cookie, owner.business.id, [
    { name: 'The Bound Book', sku: 'T64-1', format: 'Hardcover' },
    { name: 'The Plain Book', sku: 'T64-2' },
  ]);
  assert.equal(book.format, 'Hardcover', 'the created product carries its format');

  const { rows } = await pool.query(
    'SELECT sku, format FROM products WHERE business_id = $1 ORDER BY sku',
    [owner.business.id],
  );
  assert.deepEqual(
    rows.map((r) => [r.sku, r.format]),
    [['T64-1', 'Hardcover'], ['T64-2', '']],
    'the column stores the format; a product that never said starts empty',
  );

  const edited = await req(`/api/entities/Product/${book.id}`, {
    method: 'PATCH',
    body: { format: 'Paperback' },
    cookie: owner.cookie,
  });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.json.format, 'Paperback', 'an edit rewrites the format like any field');
});

test('format field: the spreadsheet import carries it onto the product', async () => {
  const owner = await ownerWithBusiness('t64-import@example.com');
  const res = await req(`/api/businesses/${owner.business.id}/import`, {
    method: 'POST',
    body: {
      batchRef: 't64-import-1',
      rows: [{ name: 'Imported Tales', sku: 'T64-IMP-1', author: 'Ada Mercer', format: 'Paperback' }],
    },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 201, res.text);
  const { rows } = await pool.query(
    'SELECT format FROM products WHERE business_id = $1 AND sku = $2',
    [owner.business.id, 'T64-IMP-1'],
  );
  assert.equal(rows[0]?.format, 'Paperback', 'the imported row’s format landed on the product');
  assert.ok(
    shopRoutes.includes("format: String(row.format || '').trim(),"),
    'the import draft reads the format cell beside the author cell',
  );
});

test('importer guard: a marketplace "Format" column still never auto-matches — the product’s Format field notwithstanding', () => {
  // The create importer (release 365's NEVER_AUTO_MATCH road).
  assert.equal(guessField('Format'), '', 'a bare Format column is ignored, exactly as before');
  assert.equal(guessField('Item number'), '', 'the sibling guards stand');
  const married = guessFields(['Item number', 'Title', 'Format', 'Start price']);
  assert.equal(married[2], '', 'in a whole eBay-shaped sheet, Format stays unclaimed');
  // Headers that genuinely name the book's format DO marry it.
  assert.equal(guessField('Book Format'), 'format');
  assert.equal(guessField('Binding'), 'format');
  // The update importer keeps the same care: its synonym table
  // never held the bare word, so its guesser cannot marry it.
  assert.equal(guessUpdateField('Format'), '', 'the update guesser ignores a bare Format column too');
  assert.equal(guessUpdateField('Binding'), 'format');
  assert.equal(guessUpdateField('Book Format'), 'format');
});

test('importer: format is a mappable field beside author in both importers, and a mapped row drafts it', () => {
  const createKeys = IMPORT_FIELDS.map((f) => f.key);
  assert.equal(createKeys[createKeys.indexOf('author') + 1], 'format', 'create fields: format follows author');
  const updateKeys = UPDATE_FIELDS.map((f) => f.key);
  assert.equal(updateKeys[updateKeys.indexOf('author') + 1], 'format', 'update fields: format follows author');
  const { draft } = draftFromRow({ name: 'Drafted', format: ' Hardcover ' });
  assert.equal(draft.format, 'Hardcover', 'a mapped format cell drafts onto the product');
});

test('exports: the products export carries a Format column right after Author, with the stored value', async () => {
  const owner = await ownerWithBusiness('t64-export@example.com', 'Export Shop', { plan: 'business' });
  await createProducts(owner.cookie, owner.business.id, [
    { name: 'Exportable', sku: 'T64-EXP-1', author: 'Ada Mercer', format: 'Hardcover' },
  ]);
  const built = await EXPORTS.products.build(pool, owner.business.id);
  const labels = built.columns.map((c) => c.label);
  assert.equal(labels[labels.indexOf('Author') + 1], 'Format', 'Format follows Author in the export');
  const formatColumn = built.columns[labels.indexOf('Format')];
  const row = built.rows.find((p) => p.sku === 'T64-EXP-1');
  assert.equal(formatColumn.value(row), 'Hardcover', 'the export prints the stored format');
  // The client-side export builders carry the same column.
  const firstAuthor = clientExports.indexOf("{ label: 'Author'");
  const firstFormat = clientExports.indexOf("{ label: 'Format'");
  assert.ok(firstAuthor > -1 && firstFormat > firstAuthor, 'the client products export carries Format after Author');
  assert.ok(clientExports.indexOf("{ label: 'Format'", firstFormat + 1) > -1, 'the workbook Products sheet carries it too');
});

test('strings: the seven format keys exist in English and in every one of the 52 locales', () => {
  const keys = [
    'productForm.formatLabel',
    'productForm.formatPaperback',
    'productForm.formatHardcover',
    'productForm.addFormatOption',
    'productDetails.rowFormat',
    'importLib.field.format',
    'importLib.updateField.format',
  ];
  assert.equal(Object.keys(en).length, 5818, 'the keyset stands at 5818');
  for (const key of keys) assert.ok(en[key], `en missing ${key}`);
  assert.equal(en['productForm.formatPaperback'], 'Paperback');
  assert.equal(en['productForm.formatHardcover'], 'Hardcover');
  assert.equal(en['productForm.addFormatOption'], 'Add a format…');
  for (const [code, dict] of Object.entries(LOCALES)) {
    assert.equal(Object.keys(dict).length, 5818, `${code} keyset`);
    for (const key of keys) assert.ok(dict[key], `${code} missing ${key}`);
  }
});
