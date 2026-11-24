/**
 * Release 365 — import robustness, the reading half (owner rulings,
 * Nov 23, 2026, from her own night importing her real eBay catalog):
 *
 *   (1) her real eBay report auto-marries by MEANING and dry-runs
 *       to 138 to create / 148 units — Title is the name (never an
 *       ISBN or a catalog number), Custom label the SKU, Available
 *       quantity the Opening stock quantity, Start price the
 *       Retail price, eBay category 1 name the Category, Condition
 *       the Condition, P:ISBN the ISBN on the 11 rows that carry it;
 *   (4-lib) the same file dry-run against the catalog it created
 *       names EVERY row already-in-catalog — a repeat import is a
 *       visible no-op, never a twinned catalog;
 *   (5) a quantity column married to anything but Opening stock
 *       quantity blocks the road with the plain-words notice until
 *       it is married right or deliberately ignored;
 *   (6) changing a mapping after a dry run changes the setup
 *       signature the workbench compares — the stale check dies;
 *   (7-lib) the owner's definitive files (with the harvested Image
 *       column) marry Image → Photo on all 138 rows;
 *   (8) the Overview stock-value math: at cost and at selling
 *       price are two different, correct sums over one fixture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const userFiles = path.join(here, '../../../user/files');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

const csvImport = await import(pathToFileURL(path.join(repoRoot, 'src/lib/csvImport.js')).href);
const { parseCsv, guessFields, guessField, unmarriedQuantityColumn, generatedSkuFor } = csvImport;

// importProducts.js imports through the '@' alias; rewrite it to a
// relative path in a temp copy so node can load the real module
// (the t6 trick).
const libSrc = read('src/lib/importProducts.js').replace(
  '@/lib/csvImport',
  path.join(repoRoot, 'src/lib/csvImport.js'),
);
const tmp = path.join(tmpdir(), 'importProducts365.testable.mjs');
writeFileSync(tmp, libSrc);
const { evaluateRows } = await import(pathToFileURL(tmp).href);

const EBAY_FILE = 'eBay-all-active-listings-report-2026-11-23-13343696180_45_hiyd.csv';

function loadSheet(file) {
  const text = readFileSync(path.join(userFiles, file), 'utf8');
  const sheet = parseCsv(text);
  assert.ok(sheet.headers.length > 0);
  return sheet;
}

test('365 (1): her real eBay report auto-marries by meaning and dry-runs to 138 / 148', () => {
  const sheet = loadSheet(EBAY_FILE);
  assert.equal(sheet.rows.length, 138);
  const mapping = guessFields(sheet.headers);
  const at = (header) => mapping[sheet.headers.indexOf(header)];
  assert.equal(at('Title'), 'name');
  assert.equal(at('Custom label (SKU)'), 'sku');
  assert.equal(at('Available quantity'), 'stock_qty');
  assert.equal(at('Start price'), 'price');
  assert.equal(at('eBay category 1 name'), 'category');
  assert.equal(at('Condition'), 'condition');
  assert.equal(at('P:ISBN'), 'isbn');
  // The night's poison columns marry NOTHING: the listing's own
  // catalog numbers are not product fields.
  assert.equal(at('Item number'), '');
  assert.equal(at('eBay Product ID(ePID)'), '');
  assert.equal(at('Format'), '');

  const verdict = evaluateRows({ table: sheet, mapping, existing: {}, room: null });
  assert.equal(verdict.ready, 138, `problems: ${JSON.stringify(verdict.rows.filter((r) => r.status !== 'ready').slice(0, 5))}`);
  assert.equal(verdict.units, 148);
  // No row wears a number as its name: every ready row's name is
  // its Title text.
  for (const row of verdict.rows) {
    assert.equal(row.status, 'ready');
    assert.ok(row.name && !/^\d{9,}$/.test(row.name), `numeric name: ${row.name}`);
    assert.equal(row.draft.name, row.name);
  }
  // The 11 ISBN rows carry their ISBNs as codes, not names.
  const withIsbn = verdict.rows.filter((r) => r.draft.isbn);
  assert.equal(withIsbn.length, 11);
  // Her one real-SKU row keeps its SKU; the rest derive identities.
  const bundle = verdict.rows.find((r) => r.draft.sku === '052828629');
  assert.ok(bundle, 'the Paws and Pages bundle row keeps SKU 052828629');
  assert.equal(bundle.quantity, 10);
});

test('365 (4-lib): re-running the same file names every row already in the catalog', () => {
  const sheet = loadSheet(EBAY_FILE);
  const mapping = guessFields(sheet.headers);
  const first = evaluateRows({ table: sheet, mapping, existing: {}, room: null });
  // The catalog the first import created: every SKU it assigned.
  const catalogSkus = first.rows.map((r) => r.draft.sku);
  const second = evaluateRows({
    table: sheet,
    mapping,
    existing: { skus: catalogSkus, codes: [] },
    room: null,
  });
  assert.equal(second.ready, 0);
  assert.equal(second.skipped, 138);
  for (const row of second.rows) {
    assert.equal(row.status, 'skip');
    assert.match(row.problem, /already in the catalog/);
  }
});

test('365 (5): an unmarried quantity column blocks until married or ignored', () => {
  const headers = ['Title', 'Available quantity', 'Start price'];
  const married = guessFields(headers);
  assert.equal(married[1], 'stock_qty');
  assert.equal(unmarriedQuantityColumn(headers, married), null);
  // Married to the WRONG field (the night's stranding): blocked.
  const wrong = ['name', 'price', 'price'];
  assert.equal(unmarriedQuantityColumn(headers, wrong), 'Available quantity');
  // Married to nothing: blocked.
  assert.equal(unmarriedQuantityColumn(headers, ['name', '', 'price']), 'Available quantity');
  // Deliberately ignored: the owner's choice, the road opens.
  assert.equal(unmarriedQuantityColumn(headers, ['name', 'ignore', 'price']), null);
  // A file with no quantity column at all: nothing to guard.
  assert.equal(unmarriedQuantityColumn(['Title', 'Start price'], ['name', 'price']), null);
});

test('365 (6): the dry-run signature moves when any marriage, location or pick changes', () => {
  // The workbench's own formula (ImportWorkbench.jsx): a dry run
  // is only in force while file, mapping, location and row picks
  // are exactly what they were when it ran.
  const signature = (fileName, mapping, locationId, excluded) =>
    `${fileName}|${mapping.join(',')}|${locationId}|${[...excluded].sort((a, b) => a - b).join(',')}`;
  const base = signature('f.csv', ['name', 'stock_qty'], 'loc-1', []);
  assert.notEqual(signature('f.csv', ['name', 'price'], 'loc-1', []), base);
  assert.notEqual(signature('f.csv', ['name', 'stock_qty'], 'loc-2', []), base);
  assert.notEqual(signature('f.csv', ['name', 'stock_qty'], 'loc-1', [3]), base);
  // And the workbench source clears the verdict on every change.
  const workbench = read('src/components/import/ImportWorkbench.jsx');
  assert.match(workbench, /const changeMapping[\s\S]*?setDryRun\(null\)/);
  assert.match(workbench, /onValueChange=\{\(value\) => \{\s*setLocationId\(value\);\s*setDryRun\(null\)/);
  assert.match(workbench, /const toggleRow[\s\S]*?setDryRun\(null\)/);
});

test('365 (7-lib): the definitive files marry Image to Photo on all 138 rows', () => {
  const sheets = ['luminous-ebay-definitive-part1.csv', 'luminous-ebay-definitive-part2.csv'].map(loadSheet);
  let ready = 0;
  let units = 0;
  for (const sheet of sheets) {
    const mapping = guessFields(sheet.headers);
    const at = (header) => mapping[sheet.headers.indexOf(header)];
    assert.equal(at('Product name'), 'name');
    assert.equal(at('Units on hand'), 'stock_qty');
    assert.equal(at('Price'), 'price');
    assert.equal(at('Image'), 'photo');
    const verdict = evaluateRows({ table: sheet, mapping, existing: {}, room: null });
    assert.equal(verdict.skipped, 0);
    ready += verdict.ready;
    units += verdict.units;
    for (const row of verdict.rows) {
      assert.match(row.photoUrl, /^https:\/\/i\.ebayimg\.com\//);
    }
  }
  assert.equal(ready, 138);
  assert.equal(units, 148);
});

test('365 (8): Overview stock value — at cost and at selling price, one fixture, two sums', () => {
  // Mixed fixture: quantities × cost vs quantities × price.
  const products = [
    { id: 'a', cost: 2.5, price: 9.5 },
    { id: 'b', cost: 0, price: 12.0 },
    { id: 'c', cost: 4.0, price: 4.0 },
    { id: 'd', cost: null, price: 3.25 },
  ];
  const levels = [
    { product_id: 'a', quantity: 10 },
    { product_id: 'b', quantity: 3 },
    { product_id: 'c', quantity: 5 },
    { product_id: 'd', quantity: 8 },
  ];
  const byId = new Map(products.map((p) => [p.id, p]));
  const stockValue = levels.reduce((s, l) => s + (l.quantity || 0) * (byId.get(l.product_id)?.cost || 0), 0);
  const retailValue = levels.reduce((s, l) => s + (l.quantity || 0) * (byId.get(l.product_id)?.price || 0), 0);
  assert.equal(stockValue, 45); // 10×2.50 + 3×0 + 5×4 + 8×0
  assert.equal(retailValue, 177); // 10×9.50 + 3×12 + 5×4 + 8×3.25
  // The formulas stay the app's own, and the card shows BOTH.
  const inventory = read('src/lib/inventory.js');
  assert.match(inventory, /stockValue = levels\.reduce[\s\S]*?\(product\?\.cost \|\| 0\)/);
  assert.match(inventory, /retailValue = levels\.reduce[\s\S]*?\(product\?\.price \|\| 0\)/);
  const dashboard = read('src/pages/Dashboard.jsx');
  assert.match(dashboard, /dashboard\.atCurrentCost/);
  assert.match(dashboard, /dashboard\.atSellingPrice/);
  assert.match(dashboard, /stats\.retailValue/);
});

test('365: generated identity is the slug the importer assigns', () => {
  assert.equal(generatedSkuFor('The Night Before Kindergarten'), 'THE-NIGHT-BEFORE-KINDERG');
  assert.equal(generatedSkuFor('Paws & Pages Cat Stationery Gift Bundle'), 'PAWS-PAGES-CAT-STATIONER');
  // The matcher never auto-marries a listing-type column to a
  // product field: 'Format' in a seller file is FIXED_PRICE, not
  // Paperback/Hardcover.
  assert.equal(guessField('Format'), '');
  assert.equal(guessField('Item number'), '');
});
