/**
 * The print family (Nov 24, 2026) — the owner's three rulings:
 *
 *   1. BLANK FORMS FOR EVERYONE. Inside the Print Center, its
 *      own area offers blank forms — a picker of documents, each
 *      printing as a clean table (column headers, EMPTY rows to
 *      fill in by hand) wearing the owner's own Studio styling
 *      (DocFrame / DecoHeader / DecoFooter + their logo through
 *      DocHeader). Both plans, no plan gate.
 *
 *   2. PHOTOS ON EVERY PRODUCT SURFACE. Wherever a document
 *      lists a product, its stored photo prints beside the item:
 *      count sheet, pick list, purchase order + supplier packing
 *      slip (screen AND server PDF), customer invoice + packing
 *      slip (screen AND server PDF), the return document's BOTH
 *      tables, the prep sheet's ingredient rows, the transfer
 *      document, the date labels, the recipe card's ingredient
 *      rows, the product-grouped report PDF, the barcode + QR
 *      labels in every path (browser print, labels PDF client +
 *      server, Bluetooth / USB ESC/POS) — and the Print Center
 *      product picker itself. EXCEPTIONS, untouched: shipping
 *      label, price tag, shelf label, bin label, sales receipt.
 *
 *   3. NO LIMITS IN THE PRINT CHAIN. The picker loads the FULL
 *      catalog (cursor-paged behind the scenes — it stopped at
 *      100, so her own 137-product catalog had 37 unpickable
 *      products), and the labels PDF prints ALL selected labels
 *      (the server route silently sliced at 50).
 *
 * The PDF proofs are byte-level: a PDF built with a photo
 * carries an image XObject; one built without does not. The
 * 137-label proof counts the PDF's own page tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLabelsPdf, buildPoPdf, buildPackingSlipPdf, buildReportPdf } from '../../server/printPdf.js';
import { photoIdOf } from '../../server/printPhotos.js';
import { buildLabelsPdfBytes } from '../../src/lib/labelsPdf.js';
import { productToLabel, locationToLabel, toLabel } from '../../src/lib/labelPayload.js';
import { escPosLabelBytes } from '../../src/lib/escPos.js';
import { en } from '../../src/lib/locales/en.js';
import { esMX } from '../../src/lib/locales/es-MX.js';
import { LOCALES } from '../../src/lib/i18n.js';

const read = (file) => readFileSync(file, 'utf8');

// A genuinely valid 2x2 PNG (the t62 1px constant's CRC does not
// satisfy jsPDF's PNG parser — this one is built to spec).
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM/////w8AH+4F+7C4l8kAAAAASUVORK5CYII=';

const hasImage = (buffer) => buffer.toString('latin1').includes('/Subtype /Image');
const pageCount = (buffer) => Number(buffer.toString('latin1').match(/\/Count (\d+)/)?.[1] || 0);

/* ---------------- Part 3 — no limits ---------------- */

test('no limits: the labels route no longer slices the selection at 50', () => {
  const routes = read('server/shopRoutes.js');
  const labelsRoute = routes.slice(
    routes.indexOf("'/businesses/:bid/print/labels'"),
    routes.indexOf("'/businesses/:bid/print/packing-slip'"),
  );
  assert.ok(!labelsRoute.includes('.slice(0, 50)'), 'the 50-label slice is gone from the labels route');
  assert.match(labelsRoute, /photoDataByProductId/);
});

test('no limits: 137 selected labels print as 137 labels (18 pages, not the old 7)', () => {
  const items = Array.from({ length: 137 }, (_, i) => ({
    name: `Book ${i}`,
    sku: `SKU${i}`,
    price: 5,
    barcode: '123456789012',
  }));
  const all = buildLabelsPdf(items, { copies: 1, businessName: 'Test', language: 'en' });
  assert.equal(pageCount(all), 18);
  const fifty = buildLabelsPdf(items.slice(0, 50), { copies: 1, businessName: 'Test', language: 'en' });
  assert.equal(pageCount(fifty), 7);
  const clientAll = Buffer.from(buildLabelsPdfBytes(items, { copies: 1, businessName: 'Test' }));
  assert.equal(pageCount(clientAll), 18);
});

test('no limits: the picker loads the full catalog through the cursor pager', () => {
  const inventory = read('src/lib/inventory.js');
  assert.match(inventory, /export async function listAllProducts/);
  assert.match(inventory, /next_cursor/);
  const center = read('src/pages/PrintCenter.jsx');
  assert.match(center, /listAllProducts\(\{ search: debounced, businessId: activeId \|\| '' \}\)/);
  assert.ok(!center.includes('limit: 100'), 'the 100-product picker cap is gone');
});

/* ---------------- Part 2 — photos on the label paths ---------------- */

test('photos: the shared label payload carries the product photo; a location label carries none', () => {
  const label = productToLabel({ name: 'Book', sku: 'S1', price: 5, photo_urls: ['/api/photos/abc'] });
  assert.equal(label.photo, '/api/photos/abc');
  const attached = productToLabel({ name: 'Book', sku: 'S1', photoData: PNG_DATA_URL });
  assert.equal(attached.photoData, PNG_DATA_URL);
  const location = locationToLabel({ name: 'Aisle 1', code: 'A1' });
  assert.ok(!location.photo && !location.photoData);
  // A pre-built payload passes through with its photo fields intact.
  const passthrough = toLabel({ title: 'Book', lines: [], code: 'S1', photoData: PNG_DATA_URL });
  assert.equal(passthrough.photoData, PNG_DATA_URL);
});

test('photos: both labels PDFs embed the photo, and print the plain label without one', () => {
  const withPhoto = { name: 'Book', sku: 'S1', price: 5, barcode: '123456789012', photoData: PNG_DATA_URL };
  const plain = { name: 'Book', sku: 'S1', price: 5, barcode: '123456789012' };
  assert.ok(hasImage(buildLabelsPdf([withPhoto], { language: 'en' })));
  assert.ok(!hasImage(buildLabelsPdf([plain], { language: 'en' })));
  assert.ok(hasImage(Buffer.from(buildLabelsPdfBytes([withPhoto], {}))));
  assert.ok(!hasImage(Buffer.from(buildLabelsPdfBytes([plain], {}))));
});

test('photos: the ESC/POS bytes carry the photo raster only when one rides the payload', () => {
  const raster = new Uint8Array([0x1d, 0x76, 0x30, 0x00, 20, 0, 8, 0, ...new Array(160).fill(0)]);
  const hasGsRaster = (bytes) => {
    for (let i = 0; i + 3 < bytes.length; i += 1) {
      if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) return true;
    }
    return false;
  };
  const product = { name: 'Book', sku: 'S1', price: 5, barcode: '123456789012' };
  assert.ok(hasGsRaster(escPosLabelBytes({ ...product, photoRaster: raster })));
  assert.ok(!hasGsRaster(escPosLabelBytes(product)));
  // Both direct-printer callers prepare the rasters first.
  assert.match(read('src/lib/bluetoothPrint.js'), /withLabelRasters\(products\)/);
  assert.match(read('src/lib/usbPrint.js'), /withLabelRasters\(products\)/);
});

test('photos: the server document PDFs embed line photos (PO, both packing slips, product report)', () => {
  const business = { name: 'Biz', currency: 'USD', language: 'en' };
  const po = {
    number: 'PO-1',
    supplier_name: 'Sup',
    status: 'ordered',
    lines: [{ product_id: 'p1', product_name: 'Book', qty_ordered: 2, unit_cost: 3 }],
  };
  assert.ok(hasImage(buildPoPdf(po, business, { mode: 'po', photoDataById: { p1: PNG_DATA_URL } })));
  assert.ok(hasImage(buildPoPdf(po, business, { mode: 'packing', photoDataById: { p1: PNG_DATA_URL } })));
  assert.ok(!hasImage(buildPoPdf(po, business, { mode: 'po' })));
  const order = { number: 'O-1', customer_name: 'C', lines: [{ product_id: 'p1', product_name: 'Book', quantity: 1 }] };
  assert.ok(hasImage(buildPackingSlipPdf(order, business, { photoDataById: { p1: PNG_DATA_URL } })));
  assert.ok(!hasImage(buildPackingSlipPdf(order, business)));
  const report = {
    report: { label: 'Stock' },
    groupLabel: 'Product',
    rows: [{ key: 'p1', label: 'Book', count: 1, units: 2, value: 10 }],
    totals: { count: 1, units: 2, value: 10 },
  };
  assert.ok(hasImage(buildReportPdf(report, business, { photoDataById: { p1: PNG_DATA_URL } })));
  assert.ok(!hasImage(buildReportPdf(report, business, {})));
});

test('photos: the server resolver reads parsed and string photo_urls alike', () => {
  assert.equal(photoIdOf({ photo_urls: ['/api/photos/abc-123'] }), 'abc-123');
  assert.equal(photoIdOf({ photo_urls: '["/api/photos/xyz"]' }), 'xyz');
  assert.equal(photoIdOf({ photo_urls: [] }), null);
  assert.equal(photoIdOf({ photo_urls: ['https://cdn.example/cover.jpg'] }), null);
  assert.equal(photoIdOf({}), null);
});

test('photos: every ruled screen document renders the photo beside the item', () => {
  for (const file of [
    'src/components/print/CountSheet.jsx',
    'src/components/print/PickList.jsx',
    'src/components/print/CustomerDoc.jsx',
    'src/components/print/PurchaseOrderDoc.jsx',
    'src/components/print/ReturnDoc.jsx',
    'src/components/print/RecipeDoc.jsx',
    'src/components/print/PrepSheetDoc.jsx',
    'src/components/print/TransferDoc.jsx',
    'src/components/print/DateLabelDoc.jsx',
  ]) {
    assert.match(read(file), /DocPhoto/, `${file} renders DocPhoto`);
  }
  // The return document's BOTH tables (returns + exchange replacements).
  const returnDoc = read('src/components/print/ReturnDoc.jsx');
  assert.equal(returnDoc.match(/DocPhoto url=\{photoById\[line\.product_id\]\}/g)?.length, 2);
  // The restaurant row builders attach the photo where the data lives.
  assert.match(read('src/pages/RecipeDetail.jsx'), /photo_url: product\?\.photo_urls\?\.\[0\]/);
  assert.match(read('src/lib/restaurantOps.js'), /photo_url: product\?\.photo_urls\?\.\[0\]/);
  assert.match(read('src/pages/RestaurantTransfers.jsx'), /photo_url: productsById\.get\(movement\.product_id\)/);
  assert.match(read('src/pages/RestaurantExpiry.jsx'), /photo_url: productsById\.get\(batch\.product_id\)/);
  // The Print Center joins order-line photos by product_id and
  // passes the map into the three order documents.
  const center = read('src/pages/PrintCenter.jsx');
  assert.match(center, /photoById=\{photoById\}/);
  // The picker itself shows each product's photo beside its name.
  assert.match(read('src/components/print/ProductPicker.jsx'), /product\.photo_urls\?\.\[0\]/);
});

test('photos: the barcode and QR label templates carry the photo; the exceptions do not', () => {
  const card = read('src/components/print/LabelCard.jsx');
  const branch = (from, to) => card.slice(card.indexOf(from), to ? card.indexOf(to) : undefined);
  assert.match(branch("template === 'barcode'", "template === 'qr'"), /photo_urls/);
  assert.match(branch("template === 'qr'", "template === 'bin'"), /photo_urls/);
  // The five exceptions stay exactly as they were.
  assert.ok(!branch("template === 'price'", "template === 'shelf'").includes('photo'), 'price tag: no photo');
  assert.ok(!branch("template === 'shelf'", "template === 'barcode'").includes('photo'), 'shelf label: no photo');
  assert.ok(!branch("template === 'bin'", '// Product sheet').includes('photo'), 'bin label: no photo');
  assert.ok(!read('src/components/print/ShippingLabelDoc.jsx').includes('photo'), 'shipping label: no photo');
  const customer = read('src/components/print/CustomerDoc.jsx');
  // The receipt is the 80mm early return; the full-page document
  // (w-[180mm]) that follows it is where photos belong.
  const receiptBranch = customer.slice(customer.indexOf('if (receipt)'), customer.indexOf('w-[180mm]'));
  assert.ok(!receiptBranch.includes('DocPhoto') && !receiptBranch.includes('photoById'), 'sales receipt: no product photos');
});

/* ---------------- Part 1 — blank forms ---------------- */

test('blank forms: the Studio-styled blank form covers count sheet, pick list and temperature log', () => {
  const doc = read('src/components/print/BlankFormDoc.jsx');
  assert.match(doc, /DocFrame/);
  assert.match(doc, /DecoHeader/);
  assert.match(doc, /DecoFooter/);
  assert.match(doc, /DocHeader/);
  assert.match(doc, /logoUrl=\{business\?\.logo_url/);
  for (const key of ['countSheetTitle', 'pickListTitle']) assert.ok(doc.includes(`print.${key}`));
  assert.ok(doc.includes('ops.tempLogs.title'));
  // Empty rows only: the form takes no products and prints no data rows.
  assert.ok(!doc.includes('products.map'));
  assert.match(doc, /FORM_ROWS/);
});

test('blank forms: the Print Center area is its own, for everyone — no plan gate', () => {
  const center = read('src/pages/PrintCenter.jsx');
  const areaStart = center.indexOf("t('print.blankFormsTitle')");
  assert.ok(areaStart > 0, 'the blank-forms area exists');
  const area = center.slice(areaStart, areaStart + 1600);
  assert.ok(!area.includes('isEssentials') && !area.includes('showSupplierDocs'), 'no plan gate on blank forms');
  assert.match(center, /<BlankFormDoc kind=\{blankKind\}/);
  assert.match(center, /pickBlankForm/);
  // A blank form never routes to a server PDF. (The barcode-pool
  // build, Nov 25, 2026, added poolActive to the same guard: a
  // minted pool batch has no server PDF either — its PDF is the
  // client labels PDF, built from the batch itself.)
  assert.match(center, /if \(!activeId \|\| blankKind \|\| poolActive\) return null;/);
});

test('blank forms: the five new wordings exist in all 52 languages, genuinely translated', () => {
  const keys = [
    'print.blankFormsTitle',
    'print.blankFormsHint',
    'print.blankFormSubtitle',
    'print.colProductName',
    'print.colTime',
  ];
  assert.equal(Object.keys(en).length, 6838);
  for (const [code, strings] of Object.entries(LOCALES)) {
    assert.equal(Object.keys(strings).length, 6838, code);
    for (const key of keys) assert.ok(strings[key], `${code} carries ${key}`);
  }
  // The Spanish wordings are Spanish, not English copies.
  for (const key of keys) assert.notEqual(esMX[key], en[key], `es-MX truly translates ${key}`);
});
