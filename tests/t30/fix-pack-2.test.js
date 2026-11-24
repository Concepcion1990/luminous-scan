/**
 * T30 — Lap-3 fix pack, second half (Nov 15, 2026):
 *  item 6 — bulk edit gains a Quantity on hand control (SET
 *           semantics, one ledger movement per real change,
 *           archived skipped, cap 200,000);
 *  item 7 — plan-scoped example copy (bulk 'clearance', receive
 *           'PO-1043', the Scan hint's 'transfer');
 *  item 8 — Create/Update imports leave ONE activity line
 *           (ImportEvent) in the feeds; never a stock movement.
 *  item 9 — counting tops closed by the owner (no header/count
 *           changes); the Scan shelf part REOPENED Nov 15 ~01:05:
 *           the shelf covers the whole catalog, unplaced products
 *           labeled 'No stock placed'.
 *  item 10 — imports decode HTML entities at parse time, so the
 *           preview and the write carry the true text.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownerWithBusiness, req, close } from './helpers.js';

// Teardown (added Nov 15, 2026, code-generator run): every sibling
// suite registers after(close); without it this file's tests all
// pass but the process never exits (the booted server pends).
after(close);
import { parseCsv, decodeHtmlEntities, draftFromRow } from '../../src/lib/csvImport.js';

test('import events: the entity round-trips and stays out of the ledger', async () => {
  const { cookie, business } = await ownerWithBusiness('t30-events@example.com', 'Events Co');
  const created = await req('/api/entities/ImportEvent', {
    method: 'POST',
    cookie,
    body: {
      business_id: business.id,
      kind: 'create',
      product_count: 46,
      file_name: 'books.csv',
    },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.product_count, 46);
  assert.equal(created.json.kind, 'create');

  const page = await req('/api/entities/ImportEvent/query', {
    method: 'POST', cookie, body: { filter: { business_id: business.id }, limit: 100 },
  });
  assert.equal(page.status, 200);
  assert.equal((page.json.items ?? []).length, 1);

  // The event is NOT a stock movement: the ledger stays empty.
  const movements = await req('/api/entities/StockMovement/query', {
    method: 'POST', cookie, body: { filter: { business_id: business.id }, limit: 100 },
  });
  assert.equal((movements.json.items ?? []).length, 0);
});

test('import events: a stranger business cannot read or write them', async () => {
  const a = await ownerWithBusiness('t30-a@example.com', 'A Co');
  const b = await ownerWithBusiness('t30-b@example.com', 'B Co');
  const made = await req('/api/entities/ImportEvent', {
    method: 'POST',
    cookie: a.cookie,
    body: { business_id: a.business.id, kind: 'update', product_count: 4 },
  });
  assert.equal(made.status, 201, made.text);
  const read = await req('/api/entities/ImportEvent/query', {
    method: 'POST', cookie: b.cookie, body: { filter: { business_id: a.business.id }, limit: 100 },
  });
  assert.ok(read.status === 403 || (read.json?.items ?? []).length === 0, `stranger read: ${read.status}`);
  const write = await req('/api/entities/ImportEvent', {
    method: 'POST',
    cookie: b.cookie,
    body: { business_id: a.business.id, kind: 'create', product_count: 1 },
  });
  assert.equal(write.status, 403);
});

test('import events: the server Create-import endpoint records one line', async () => {
  const { cookie, business } = await ownerWithBusiness('t30-import@example.com', 'Import Co');
  const res = await req(`/api/businesses/${business.id}/import`, {
    method: 'POST',
    cookie,
    body: {
      batchRef: 'T30-BATCH-1',
      fileName: 'books.csv',
      rows: [
        { name: 'Book One', sku: 'BK-T30-1' },
        { name: 'Book Two', sku: 'BK-T30-2' },
      ],
    },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.created, 2);
  const events = await req('/api/entities/ImportEvent/query', {
    method: 'POST', cookie, body: { filter: { business_id: business.id }, limit: 100 },
  });
  const items = events.json.items ?? [];
  assert.equal(items.length, 1, 'exactly one activity line for the whole import');
  assert.equal(items[0].kind, 'create');
  assert.equal(items[0].product_count, 2);
  // Zero-stock import: no movements were written by the endpoint.
  const movements = await req('/api/entities/StockMovement/query', {
    method: 'POST', cookie, body: { filter: { business_id: business.id }, limit: 100 },
  });
  assert.equal((movements.json.items ?? []).length, 0);
});

test('bulk quantity: the dialog carries the whole discipline', () => {
  const bulk = readFileSync('src/components/products/BulkEditDialog.jsx', 'utf8');
  // SET semantics through the one movement funnel, Edit-form style.
  assert.match(bulk, /import \{ recordMovement \} from '@\/lib\/inventory'/);
  assert.match(bulk, /type: 'receive',\s*quantity: quantityTarget - current/);
  assert.match(bulk, /type: 'correction',\s*quantity: quantityTarget/);
  assert.match(bulk, /note: t\('products\.bulkQuantityNote'\)/);
  // Products already at the target record nothing.
  assert.match(bulk, /if \(current === quantityTarget\) \{\s*set \+= 1;\s*continue;/);
  // Archived products are skipped and counted for the banner.
  assert.match(bulk, /\(product\.status \|\| 'active'\) === 'archived'\) \{\s*skipped \+= 1;/);
  // The cap and the whole-number rule refuse in plain words.
  assert.match(bulk, /quantityTarget > 200000/);
  assert.match(bulk, /products\.bulkQuantityTooBig/);
  assert.match(bulk, /productForm\.quantityInvalid/);
  // The location picker is preselected: remembered, else first.
  assert.match(bulk, /localStorage\.getItem\('stockroom\.location'\)/);
  assert.match(bulk, /locations\[0\]\?\.id/);
  // The preview speaks the owner's sentence shape.
  assert.match(bulk, /products\.bulkChangeQuantity/);
  // The summary reaches the page for the result banner.
  assert.match(bulk, /onDone\?\.\(\{ count: products\.length, quantity: quantitySummary \}\)/);
  const products = readFileSync('src/pages/Products.jsx', 'utf8');
  assert.match(products, /locations=\{locations\}/);
  assert.match(products, /levels=\{levels\}/);
  assert.match(products, /planKey=\{planKey\}/);
  assert.match(products, /products\.bulkQuantityResult/);
  assert.match(products, /products\.bulkMovementsRecorded/);
  assert.match(products, /products\.bulkArchivedSkipped/);
});

test('plan-scoped examples: Business vocabulary stays off Essentials surfaces', () => {
  const bulk = readFileSync('src/components/products/BulkEditDialog.jsx', 'utf8');
  // Nov 15, 2026 (translation sweep): the plan-scoped examples now
  // render through locale keys — the scoping itself is unchanged
  // (Business sees the clearance example, Essentials the seasonal
  // one; the PO reference stays Business-only vocabulary).
  assert.match(bulk, /placeholder=\{planKey === 'business' \? t\('products\.bulkTagExampleBusiness'\) : t\('products\.bulkTagExampleEssentials'\)\}/,
    'the Remove tags example is clearance only on Business');
  const receive = readFileSync('src/components/import/ReceiveWorkbench.jsx', 'utf8');
  assert.match(receive, /placeholder=\{planKey === 'business' \? t\('import\.referencePlaceholderBusiness'\) : t\('import\.referencePlaceholderEssentials'\)\}/);
  assert.match(receive, /useEntitlements/);
  const scan = readFileSync('src/pages/Scan.jsx', 'utf8');
  assert.match(scan, /planKey === 'business' \? 'scan\.neverChangesStock' : 'scan\.neverChangesStockEssentials'/,
    'the Scan hint names transfer only where transfers exist');
});

test('import activity: every write and render site is wired', () => {
  const commit = readFileSync('src/lib/importCommit.js', 'utf8');
  assert.match(commit, /export async function recordImportEvent/);
  assert.match(commit, /kind: 'update', count: updated/);
  const create = readFileSync('src/components/import/ImportWorkbench.jsx', 'utf8');
  // Release 365 (Nov 23, 2026): the Create commit rides the
  // server's one-send import door, and the door itself writes the
  // activity event (the INSERT pinned below against shopRoutes) —
  // the client no longer records it after the fact, so a refused
  // send can never leave a phantom "Imported N products" line.
  assert.match(create, /apiRequest\(`\/api\/businesses\/\$\{encodeURIComponent\(businessId\)\}\/import`/);
  assert.ok(!create.includes('recordImportEvent'), 'the create event is the server door’s to write');
  // Receive imports write NO event — their receipts already speak.
  const receiveCommit = commit.slice(commit.indexOf('export async function applyReceipts'));
  assert.ok(!receiveCommit.includes('recordImportEvent'), 'receive stays movement-only');

  const inventory = readFileSync('src/lib/inventory.js', 'utf8');
  assert.match(inventory, /importEvents: importEvents\.items \?\? \[\]/);
  const feed = readFileSync('src/components/dashboard/ActivityFeed.jsx', 'utf8');
  assert.match(feed, /dashboard\.activityImported/);
  assert.match(feed, /dashboard\.activityUpdated/);
  const movements = readFileSync('src/pages/Movements.jsx', 'utf8');
  assert.match(movements, /const showImportEvents = type === 'all' && locationId === 'all'/);
  assert.match(movements, /entities\.ImportEvent/);
  const client = readFileSync('src/api/client.js', 'utf8');
  assert.match(client, /'ImportEvent'/);
  const migration = readFileSync('migrations/026_import_events.sql', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS import_events/);
  const billing = readFileSync('server/billing.js', 'utf8');
  assert.match(billing, /DELETE FROM import_events WHERE business_id/);
  const shop = readFileSync('server/shopRoutes.js', 'utf8');
  assert.match(shop, /INSERT INTO import_events/);
});

test('scan shelf (item 9 reopened): whole catalog, truthful labels', () => {
  const scan = readFileSync('src/components/scan/ScanProductList.jsx', 'utf8');
  assert.ok(!scan.includes('locationIds: ids'), 'the shelf no longer filters the catalog by placement');
  assert.match(scan, /placedAnywhere/);
  assert.match(scan, /t\('inventory\.noStockPlaced'\)/);
  assert.match(scan, /t\('scan\.notCountedHere'\)/);
  assert.match(scan, /digits=\{2\}/, 'exact prices ride along (item 3)');
});

test('imports decode HTML entities before anything is written (item 10)', () => {
  assert.equal(decodeHtmlEntities('Legends &amp; Lattes'), 'Legends & Lattes');
  assert.equal(decodeHtmlEntities('&lt;Sale&gt; &quot;Final&quot;'), '<Sale> "Final"');
  assert.equal(decodeHtmlEntities('It&#39;s &apos;ok&apos;'), "It's 'ok'");
  assert.equal(decodeHtmlEntities('Fish &#38; Chips &#x26; More'), 'Fish & Chips & More');
  assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;', 'one pass only — never double-decoded');
  assert.equal(decodeHtmlEntities('A &copy; B'), 'A &copy; B', 'unknown entities pass through');
  assert.equal(decodeHtmlEntities('Plain name'), 'Plain name');

  // The CSV parser decodes cells (and headers), so the preview,
  // the dry run and the commit all carry the true text.
  const sheet = parseCsv('name,author\n"Legends &amp; Lattes","Travis &amp; Co"\n');
  assert.equal(sheet.rows[0][0], 'Legends & Lattes');
  const { draft } = draftFromRow({ name: sheet.rows[0][0], author: sheet.rows[0][1] });
  assert.equal(draft.name, 'Legends & Lattes');
  assert.equal(draft.author, 'Travis & Co');

  // The Excel reader decodes the same way.
  const xlsx = readFileSync('src/lib/xlsx.js', 'utf8');
  assert.match(xlsx, /decodeHtmlEntities\(grid\[headerIndex\]\[index\]/);
  assert.match(xlsx, /decodeHtmlEntities\(row\[index\]/);
});

test('item 11: the Uncategorized bucket carries the pencil filing door', () => {
  const categories = readFileSync('src/pages/Categories.jsx', 'utf8');
  const bucketAt = categories.indexOf('to="/inventory/categories?group=Uncategorized"');
  assert.ok(bucketAt > 0, 'the bucket door link exists');
  const bucket = categories.slice(bucketAt, bucketAt + 1600);
  assert.match(bucket, /<Pencil className="h-3\.5 w-3\.5" \/>/, 'the bucket row wears the pencil');
  assert.match(bucket, /aria-label=\{t\('categories\.editAria', \{ name: t\('inventory\.uncategorized'\) \}\)\}/);
  assert.ok(!bucket.includes('Trash2'), 'the bucket still has NO delete door — it is not a real category');
  assert.ok(!categories.includes('ChevronRight'), 'the chevron is gone from the page');
  // The landing: the door group scrolls into view once rendered.
  const landing = readFileSync('src/pages/InventoryCategories.jsx', 'utf8');
  assert.match(landing, /doorScrolledFor/);
  assert.match(landing, /scrollIntoView\(\{ block: 'start' \}\)/);
  assert.match(landing, /scroll-mt-24/);
  assert.match(landing, /groupRefs/);
});

test('item 12: the count sheet row region pans both ways, vertical untouched', () => {
  const sheet = readFileSync('src/components/counts/CountSheet.jsx', 'utf8');
  assert.match(sheet, /max-h-\[320px\] overflow-auto pr-1/);
  assert.match(sheet, /min-w-\[21rem\]/);
  assert.ok(!sheet.includes('stockhaven-scroll-list'), 'no overscroll containment added — the Nov 14 freeze fix stands');
  assert.ok(!/touch-(none|pan-x|pan-y)/.test(sheet), 'no touch-action restriction swallows vertical drags');
});

test('bulk edit: the dialog works on the opened-for snapshot', () => {
  const products = readFileSync('src/pages/Products.jsx', 'utf8');
  assert.match(products, /const \[bulkSnapshot, setBulkSnapshot\] = useState\(\[\]\)/);
  assert.match(products, /setBulkSnapshot\(selectedProducts\)/);
  assert.match(products, /products=\{bulkSnapshot\}/);
});
