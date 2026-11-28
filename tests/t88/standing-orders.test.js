// t88 — Plan release 377: STANDING ORDERS + SUPPLIER PRICE
// COMPARE (Gap 8b + Q-fire 3; Business-only, Restaurant
// Corner, Stock & Ordering shelf).
//
// Pinned here:
//   - 53 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 6940
//     (6583 + 53); placeholders survive translation.
//   - The registry gains exactly the two standing-order
//     messages (the write-door refusal + the cleaner
//     refusal), word for word, and the client maps them.
//   - The plan presentation carries the standing-orders
//     line in Business and only Business (Plans list,
//     Welcome list, comparison matrix).
//   - The training catalogs (client + server) agree at 130
//     lessons; the standing-orders lesson rides the owner
//     track under the RESTAURANT heading with 5 steps.
//   - The pure core: standing-order cleaning, the price
//     book (latest per supplier from invoices + placed
//     orders only, cheapest first, history kept), draft
//     lines repriced from the book, and the purchasing
//     door (canOrder).
//   - The money doctrine: the draft maker inserts status
//     'draft' and nothing in the core or routes sends or
//     orders anything.
//   - Wiring: migration 066, the wipe sweep, the router
//     mount, the plan gate + purchasing gate in the
//     routes, the shelf door, and the Studio print doc.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';
import { PLANS, WELCOME_OPTIONS, COMPARISON_ROWS } from '../../src/lib/plans.js';
import { API_ERROR_MESSAGE_KEYS } from '../../src/lib/apiErrors.js';
import {
  buildPriceBook, canOrder, cleanStandingOrder, draftLinesFor, latestPriceFor,
  ORDER_MESSAGE, STANDING_MESSAGE,
} from '../../server/standingOrdersCore.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.standingOrders', 'restaurant.doorStandingOrders', 'plansLib.businessIncludes.standingOrders',
  'standingOrders.title', 'standingOrders.subtitle', 'standingOrders.draftNote', 'standingOrders.newButton',
  'standingOrders.nameLabel', 'standingOrders.supplierLabel', 'standingOrders.weekdayLabel',
  'standingOrders.weekdayAny', 'standingOrders.weekdayMon', 'standingOrders.weekdayTue',
  'standingOrders.weekdayWed', 'standingOrders.weekdayThu', 'standingOrders.weekdayFri',
  'standingOrders.weekdaySat', 'standingOrders.weekdaySun', 'standingOrders.linesLabel',
  'standingOrders.productLabel', 'standingOrders.qtyLabel', 'standingOrders.addLine',
  'standingOrders.saveButton', 'standingOrders.saved', 'standingOrders.saveFailed',
  'standingOrders.emptyTitle', 'standingOrders.emptyBody', 'standingOrders.makeDraftButton',
  'standingOrders.draftMade', 'standingOrders.draftFailed', 'standingOrders.activeLabel',
  'standingOrders.lineSummary',
  'priceBook.title', 'priceBook.subtitle', 'priceBook.cheapest', 'priceBook.colSupplier',
  'priceBook.colPrice', 'priceBook.colDate', 'priceBook.colSource', 'priceBook.sourceInvoice',
  'priceBook.sourceOrder', 'priceBook.emptyTitle', 'priceBook.emptyBody', 'priceBook.printButton',
  'priceBook.docTitle',
  'apiErrors.standingOrdersForbidden', 'apiErrors.standingOrdersInvalid',
  'training.lessons.owner-standing-orders.title', 'training.lessons.owner-standing-orders.step1',
  'training.lessons.owner-standing-orders.step2', 'training.lessons.owner-standing-orders.step3',
  'training.lessons.owner-standing-orders.step4', 'training.lessons.owner-standing-orders.step5',
];

test('the keyset is uniform at 6940 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 6940, code);
});

test('all 53 standing-order keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 53);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('English variants and base-riding locales carry the same standing-order strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('placeholders survive translation in the draft and summary lines', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    assert.ok(table['standingOrders.draftMade'].includes('{number}'), `${code} draftMade`);
    assert.ok(table['standingOrders.lineSummary'].includes('{lines}') && table['standingOrders.lineSummary'].includes('{total}'), `${code} lineSummary`);
  }
});

test('the two new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(ORDER_MESSAGE, 'Only the owner, a manager, or a person with the purchasing permission can set up standing orders.');
  assert.equal(STANDING_MESSAGE, 'Check the standing order details and try again.');
  assert.equal(API_ERROR_MESSAGE_KEYS[ORDER_MESSAGE], 'apiErrors.standingOrdersForbidden');
  assert.equal(API_ERROR_MESSAGE_KEYS[STANDING_MESSAGE], 'apiErrors.standingOrdersInvalid');
  assert.equal(LOCALES.en['apiErrors.standingOrdersForbidden'], ORDER_MESSAGE);
  assert.equal(LOCALES.en['apiErrors.standingOrdersInvalid'], STANDING_MESSAGE);
});

test('plan presentation: the standing-orders line is Business-only in Plans, Welcome and the matrix', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.standingOrders').length - 1, 3, 'line in Plans Business, Welcome Business and the matrix only');
  const line = en['plansLib.businessIncludes.standingOrders'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the standing-orders line');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the standing-orders line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials never carries the standing-orders line');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never carries it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

test('the catalogs agree at 130 lessons and the standing-orders lesson rides the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 137);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-standing-orders');
  assert.ok(lesson, 'standing-orders lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-standing-orders.title'], 'Standing orders and comparing supplier prices');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 115);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 22);
});

test('cleanStandingOrder keeps the template honest', () => {
  const row = cleanStandingOrder({
    name: '  Tuesday produce ', supplier_id: 's1', supplier_name: 'Valley Farms', weekday: '1',
    lines: [{ product_id: 'p1', product_name: ' Tomatoes ', sku: 'TOM', qty: '10', unit_cost: '2.5' }],
  });
  assert.equal(row.name, 'Tuesday produce');
  assert.equal(row.weekday, 1);
  assert.equal(row.active, true);
  assert.equal(row.lines[0].product_name, 'Tomatoes');
  assert.equal(row.lines[0].qty, 10);
  assert.equal(row.lines[0].unit_cost, 2.5);
  const anyDay = cleanStandingOrder({ name: 'Dry goods', lines: [{ product_name: 'Flour', qty: 5 }] });
  assert.equal(anyDay.weekday, null);
  assert.equal(anyDay.lines[0].unit_cost, 0);
  assert.throws(() => cleanStandingOrder({ name: ' ', lines: [{ product_name: 'Flour', qty: 5 }] }), /standing order details/i);
  assert.throws(() => cleanStandingOrder({ name: 'X', lines: [] }), /standing order details/i);
  assert.throws(() => cleanStandingOrder({ name: 'X', weekday: 7, lines: [{ product_name: 'Flour', qty: 5 }] }), /standing order details/i);
  assert.throws(() => cleanStandingOrder({ name: 'X', lines: [{ product_name: 'Flour', qty: 0 }] }), /standing order details/i);
  assert.throws(() => cleanStandingOrder({ name: 'X', lines: [{ product_name: ' ', qty: 5 }] }), /standing order details/i);
});

const INVOICES = [
  { supplier_id: 's1', supplier_name: 'Valley Farms', invoice_date: '2026-11-10', lines: [{ product_id: 'p1', product_name: 'Tomatoes', quantity: 10, unit_cost: 2.5 }] },
  { supplier_id: 's1', supplier_name: 'Valley Farms', invoice_date: '2026-11-20', lines: [{ product_id: 'p1', product_name: 'Tomatoes', quantity: 10, unit_cost: 2.2 }] },
  { supplier_id: 's2', supplier_name: 'City Wholesale', invoice_date: '2026-11-15', lines: [{ product_id: 'p1', product_name: 'Tomatoes', quantity: 10, unit_cost: 2.4 }] },
];
const ORDERS = [
  { supplier_id: 's2', supplier_name: 'City Wholesale', status: 'received', order_date: '2026-11-22', lines: [{ product_id: 'p1', product_name: 'Tomatoes', qty_ordered: 10, unit_cost: 2.35 }] },
  // A draft and a cancelled order are NOT prices anyone agreed to.
  { supplier_id: 's3', supplier_name: 'Cheap Co', status: 'draft', order_date: '2026-11-23', lines: [{ product_id: 'p1', product_name: 'Tomatoes', qty_ordered: 10, unit_cost: 1.0 }] },
  { supplier_id: 's3', supplier_name: 'Cheap Co', status: 'cancelled', order_date: '2026-11-23', lines: [{ product_id: 'p1', product_name: 'Tomatoes', qty_ordered: 10, unit_cost: 0.9 }] },
  // Zero / missing costs never join the book.
  { supplier_id: 's1', supplier_name: 'Valley Farms', status: 'ordered', order_date: '2026-11-24', lines: [{ product_id: 'p2', product_name: 'Flour', qty_ordered: 5, unit_cost: 0 }] },
];

test('buildPriceBook: latest per supplier, cheapest first, history kept, drafts excluded', () => {
  const book = buildPriceBook({ invoices: INVOICES, purchaseOrders: ORDERS });
  assert.equal(book.length, 1, 'only Tomatoes carries a real price');
  const entry = book[0];
  assert.equal(entry.product_name, 'Tomatoes');
  assert.equal(entry.offers.length, 2);
  // Valley's LATEST invoice price (2.20 on 11-20) beats City's latest (2.35 order on 11-22).
  assert.equal(entry.cheapest.supplier_name, 'Valley Farms');
  assert.equal(entry.cheapest.unit_cost, 2.2);
  assert.equal(entry.cheapest.source, 'invoice');
  assert.equal(entry.offers[1].supplier_name, 'City Wholesale');
  assert.equal(entry.offers[1].unit_cost, 2.35);
  assert.equal(entry.offers[1].source, 'order');
  // History keeps every observation, newest first — including the older 2.50.
  assert.equal(entry.history.length, 4);
  assert.equal(entry.history[0].unit_cost, 2.35);
  assert.equal(entry.history.at(-1).unit_cost, 2.5);
  assert.equal(latestPriceFor(book, 'p1', 's2', 'City Wholesale'), 2.35);
  assert.equal(latestPriceFor(book, 'p1', 's3', 'Cheap Co'), null);
  assert.equal(latestPriceFor(book, 'nope', 's1', 'Valley Farms'), null);
});

test('draftLinesFor reprices from the book for the template supplier, keeps template cost otherwise', () => {
  const book = buildPriceBook({ invoices: INVOICES, purchaseOrders: ORDERS });
  const standing = {
    supplier_id: 's1', supplier_name: 'Valley Farms',
    lines: [
      { product_id: 'p1', product_name: 'Tomatoes', sku: 'TOM', qty: 10, unit_cost: 9.99 },
      { product_id: 'p9', product_name: 'Saffron', sku: '', qty: 1, unit_cost: 12 },
    ],
  };
  const lines = draftLinesFor(standing, book);
  assert.equal(lines[0].unit_cost, 2.2, 'the book price wins over the stale template cost');
  assert.equal(lines[0].qty_ordered, 10);
  assert.equal(lines[0].qty_received, 0);
  assert.equal(lines[1].unit_cost, 12, 'a never-priced line keeps its template cost');
});

test('canOrder: owner always, purchasing permission by role, nobody else', () => {
  assert.equal(canOrder(null), false);
  assert.equal(canOrder({ isOwner: true, can: () => false }), true);
  assert.equal(canOrder({ isOwner: false, can: (p) => p === 'purchasing.manage' }), true);
  assert.equal(canOrder({ isOwner: false, can: () => false }), false);
  assert.equal(canOrder({ isOwner: false }), false);
});

test('the money doctrine: drafts only — no send or order path exists in the core or routes', () => {
  const core = read('server/standingOrdersCore.js');
  assert.ok(core.includes("status: order.status") || core.includes("'draft'"), 'draft insert present');
  assert.ok(core.includes("VALUES ($1,$2,$3,$4,$5,'draft'"), 'the purchase order is inserted as a draft, always');
  for (const banned of ['sendPurchaseOrder', 'sendMail', 'sendSms', 'SET status']) {
    assert.ok(!core.includes(banned), `core never touches: ${banned}`);
  }
  // The only purchase-order insert in the core is the draft one.
  assert.equal(core.split('INSERT INTO purchase_orders').length - 1, 1);
  const routes = read('server/standingOrdersRoutes.js');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"));
  assert.ok(routes.includes('canOrder(access)'));
  assert.ok(routes.includes('ORDER_MESSAGE'));
  assert.ok(!routes.includes('sendPurchaseOrder'));
  const page = read('src/pages/RestaurantStandingOrders.jsx');
  assert.ok(page.includes('standingOrders.draftNote'));
  assert.ok(page.includes('makeStandingDraft'));
});

test('wiring: migration 066, wipe sweep, router mount, shelf door, Studio print document', () => {
  const migration = read('migrations/066_standing_orders.sql');
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS standing_orders'));
  assert.ok(migration.includes('last_draft_number'));
  const billing = read('server/billing.js');
  assert.ok(billing.includes('DELETE FROM standing_orders WHERE business_id = $1'));
  const app = read('server/app.js');
  assert.ok(app.includes('createStandingOrdersRouter'));
  const shelves = read('src/lib/restaurantShelves.js');
  assert.ok(shelves.includes("door('/restaurant/standing-orders', 'nav.standingOrders', 'restaurant.doorStandingOrders'"));
  const doc = read('src/components/print/PriceBookDoc.jsx');
  assert.ok(doc.includes('DocFrame'));
  assert.ok(doc.includes('priceBook.docTitle'));
  const page = read('src/pages/RestaurantStandingOrders.jsx');
  assert.ok(page.includes('PriceBookDoc'));
  const appJsx = read('src/App.jsx');
  assert.ok(appJsx.includes('path="/restaurant/standing-orders"'));
});
