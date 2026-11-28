// t94 — Plan Part 7, item 392: LOT CODES AND THE RECALL
// FINDER (with the receiving smalls) + the owner-ruled
// SUPPLIER TRACEABILITY strengthening. Business-only,
// Restaurant Corner; Stock & Ordering home, Food Safety
// cross-link.
//
// Pinned here:
//   - 65 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 6903
//     (6903 + 65 lot-trace keys); placeholders survive.
//   - The plan presentation carries the lot line on the
//     Business lists only (Plans + Welcome + the matrix
//     ✗/✓) — a Business-only feature, invisible on
//     Essentials.
//   - The training catalogs agree at 136 lessons; the lot
//     lesson rides the owner track under the RESTAURANT
//     heading with 5 steps and the restaurant feature gate.
//   - The pure core: receiving cleaning (per-item supplier
//     + lot; a refusal needs its reason and no lot), catch
//     weight math, the recall finder's three answers, and
//     the traceability log's lines by supplier or lot.
//   - Migration 070 carries the lot columns, the pull
//     records and the receiving check log.
//   - The wiring: the router is registered and plan-gated;
//     receiving stamps the lot onto its movement; a pull
//     locks the batch, writes its record, and flows what
//     was left into the waste log with reason 'recall';
//     the shelves carry the Stock home door and the Food
//     Safety cross-link; the Studio traceability print
//     exists (preview = print); the 10 new server wordings
//     are keyed in apiErrors.
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
  cleanLotQuery,
  cleanPull,
  cleanReceiving,
  cleanReceivingCheck,
  costPerWeight,
  recallAnswer,
  traceLines,
} from '../../server/lotTraceCore.js';
import { productForCode } from '../../src/lib/lotTrace.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'plansLib.businessIncludes.lotTraceability',
  'nav.lotTrace',
  'restaurant.doorLotTrace',
  'ops.waste.reason.recall',
  'lotTrace.title',
  'lotTrace.subtitle',
  'lotTrace.honestNote',
  'lotTrace.receiveTitle',
  'lotTrace.product',
  'lotTrace.supplier',
  'lotTrace.lotCode',
  'lotTrace.quantity',
  'lotTrace.location',
  'lotTrace.expiry',
  'lotTrace.actualWeight',
  'lotTrace.weightUnit',
  'lotTrace.deliveryTemp',
  'lotTrace.refusedToggle',
  'lotTrace.refusalReason',
  'lotTrace.receiveButton',
  'lotTrace.receivedToast',
  'lotTrace.refusedToast',
  'lotTrace.scanHint',
  'lotTrace.scanButton',
  'lotTrace.batchesTitle',
  'lotTrace.batchesEmpty',
  'lotTrace.statusActive',
  'lotTrace.statusPulled',
  'lotTrace.pullButton',
  'lotTrace.pullReason',
  'lotTrace.pulledToast',
  'lotTrace.pullsTitle',
  'lotTrace.finderTitle',
  'lotTrace.finderHelp',
  'lotTrace.finderPlaceholder',
  'lotTrace.finderButton',
  'lotTrace.finderEmpty',
  'lotTrace.finderOnHand',
  'lotTrace.finderMovedTitle',
  'lotTrace.traceTitle',
  'lotTrace.traceHelp',
  'lotTrace.traceEmpty',
  'lotTrace.printButton',
  'lotTrace.checksTitle',
  'lotTrace.checksEmpty',
  'lotTrace.saveFailed',
  'lotTrace.costPerWeight',
  'lotTrace.colWhen',
  'lotTrace.colDetails',
  'training.lessons.owner-lot-traceability.title',
  'training.lessons.owner-lot-traceability.step1',
  'training.lessons.owner-lot-traceability.step2',
  'training.lessons.owner-lot-traceability.step3',
  'training.lessons.owner-lot-traceability.step4',
  'training.lessons.owner-lot-traceability.step5',
  'apiErrors.lotTrace.stockDoor',
  'apiErrors.lotTrace.productNeeded',
  'apiErrors.lotTrace.lotNeeded',
  'apiErrors.lotTrace.quantityNeeded',
  'apiErrors.lotTrace.batchNotHere',
  'apiErrors.lotTrace.alreadyPulled',
  'apiErrors.lotTrace.pullReason',
  'apiErrors.lotTrace.refusalReason',
  'apiErrors.lotTrace.finderNeeded',
  'apiErrors.lotTrace.weightNeeded',
];

test('the keyset is uniform at 6903 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 6903, code);
});

test('all 65 lot-trace keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 65);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('English variants and base-riding locales carry the same lot strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('placeholders survive translation in the toast and cost strings', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const ph of ['{product}', '{lot}']) assert.ok(table['lotTrace.receivedToast'].includes(ph), `${code} receivedToast ${ph}`);
    assert.ok(table['lotTrace.refusedToast'].includes('{product}'), `${code} refusedToast`);
    assert.ok(table['lotTrace.pulledToast'].includes('{lot}'), `${code} pulledToast`);
    assert.ok(table['lotTrace.finderOnHand'].includes('{quantity}'), `${code} finderOnHand`);
    for (const ph of ['{cost}', '{unit}']) assert.ok(table['lotTrace.costPerWeight'].includes(ph), `${code} costPerWeight ${ph}`);
  }
});

test('the honest sizing rides the feature copy: a recall drill, not FSMA 204', () => {
  assert.ok(en['lotTrace.honestNote'].includes('recall drill'));
  assert.ok(en['lotTrace.honestNote'].includes('FSMA 204'));
  for (const [code, table] of Object.entries(LOCALES)) {
    assert.ok(table['lotTrace.honestNote'].includes('FSMA') && table['lotTrace.honestNote'].includes('204'), `${code} honestNote keeps the honest boundary`);
  }
});

test('plan presentation: the lot line is Business-only on Plans, Welcome and the matrix', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.lotTraceability').length - 1, 3, 'Plans Business, Welcome Business and the matrix');
  const line = en['plansLib.businessIncludes.lotTraceability'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the lot line');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Plans Essentials never sees it');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the lot line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never sees it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

test('the catalogs agree at 136 lessons and the lot lesson rides the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 136);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-lot-traceability');
  assert.ok(lesson, 'lot lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant', 'the lesson is feature-gated like the corner');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-lot-traceability.title'], 'Lot codes, recalls and supplier traceability');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 115);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 21);
});

test('cleanReceiving: supplier + lot per item, and a refusal needs its reason, not a lot', () => {
  const ok = cleanReceiving({ product_id: 'p1', supplier_name: 'Sysco', lot_code: 'L-9', quantity: 4, actual_weight: 38.5, weight_unit: 'lb' });
  assert.equal(ok.supplier_name, 'Sysco');
  assert.equal(ok.lot_code, 'L-9');
  assert.equal(ok.actual_weight, 38.5);
  assert.throws(() => cleanReceiving({ product_id: 'p1', quantity: 4 }), /lot code/);
  assert.throws(() => cleanReceiving({ product_id: 'p1', lot_code: 'L-9', quantity: 0 }), /greater than zero/);
  assert.throws(() => cleanReceiving({ lot_code: 'L-9', quantity: 4 }), /Choose the product/);
  assert.throws(() => cleanReceiving({ product_id: 'p1', lot_code: 'L-9', quantity: 4, actual_weight: -1 }), /actual weight/);
  const refused = cleanReceiving({ product_id: 'p1', refused: true, refusal_reason: 'Warm on arrival' });
  assert.equal(refused.refused, true);
  assert.equal(refused.lot_code, '', 'a refusal records no lot and no stock');
  assert.throws(() => cleanReceiving({ product_id: 'p1', refused: true }), /reason it was refused/);
});

test('cleanReceivingCheck + cleanPull + cleanLotQuery keep their shapes', () => {
  const check = cleanReceivingCheck({ product_id: 'p1', temperature: 38, scale: 'F' });
  assert.equal(check.temperature, 38);
  assert.throws(() => cleanReceivingCheck({ product_id: 'p1', refused: true }), /reason it was refused/);
  assert.deepEqual(cleanPull({ batch_id: 'b1', reason: 'Supplier recall notice' }), { batch_id: 'b1', reason: 'Supplier recall notice' });
  assert.throws(() => cleanPull({ batch_id: 'b1', reason: ' ' }), /health department and the supplier/);
  assert.equal(cleanLotQuery(' L-9 '), 'L-9');
  assert.throws(() => cleanLotQuery(''), /lot code you are looking for/);
});

test('costPerWeight: the catch-weight truth, never invented', () => {
  assert.equal(costPerWeight(120, 40), 3);
  assert.equal(costPerWeight(100, 30), 3.33);
  assert.equal(costPerWeight(100, 0), null);
  assert.equal(costPerWeight(null, 10), null);
  assert.equal(costPerWeight(100, null), null);
});

const BATCHES = [
  { id: 'b1', product_name: 'Chicken', lot_code: 'L-9', supplier_name: 'Sysco', location_name: 'Walk-in', quantity: 6, status: 'active' },
  { id: 'b2', product_name: 'Chicken', lot_code: 'L-9', supplier_name: 'Sysco', location_name: 'Freezer', quantity: 4, status: 'active' },
  { id: 'b3', product_name: 'Chicken', lot_code: 'L-9', supplier_name: 'Sysco', location_name: 'Walk-in', quantity: 0, status: 'pulled' },
  { id: 'b4', product_name: 'Beef', lot_code: 'B-2', supplier_name: 'US Foods', location_name: 'Walk-in', quantity: 9, status: 'active' },
];
const MOVEMENTS = [
  { id: 'm1', product_name: 'Chicken', lot_code: 'L-9', supplier_name: 'Sysco', type: 'receive', quantity: 10, location_name: 'Walk-in', created_at: '2026-11-20T08:00:00Z' },
  { id: 'm2', product_name: 'Chicken', lot_code: 'L-9', supplier_name: 'Sysco', type: 'write_off', quantity: 3, location_name: 'Walk-in', created_at: '2026-11-21T08:00:00Z' },
  { id: 'm3', product_name: 'Beef', lot_code: 'B-2', supplier_name: 'US Foods', type: 'receive', quantity: 9, location_name: 'Walk-in', created_at: '2026-11-20T09:00:00Z' },
];

test('recallAnswer answers the three questions: have it, where, did it move', () => {
  const answer = recallAnswer({ batches: BATCHES, movements: MOVEMENTS, pulls: [], waste: [] }, 'l-9');
  assert.equal(answer.found, true);
  assert.equal(answer.batches.length, 3, 'all three L-9 batches, pulled included');
  assert.equal(answer.onHand, 10, 'on hand counts the ACTIVE batches only — the pulled lot is locked out');
  assert.equal(answer.movements.length, 2, 'the lot moved: a receive and a write-off');
  const none = recallAnswer({ batches: BATCHES, movements: MOVEMENTS, pulls: [], waste: [] }, 'ZZZ');
  assert.equal(none.found, false);
  assert.equal(none.onHand, 0);
});

test('traceLines: pick a supplier or a lot and see where it went', () => {
  const bySupplier = traceLines({ batches: BATCHES, movements: MOVEMENTS, pulls: [], waste: [], checks: [] }, { supplier: 'Sysco' });
  assert.ok(bySupplier.length >= 5, 'receivings + movements for the supplier');
  assert.ok(bySupplier.every((l) => l.supplier_name === 'Sysco' || l.kind === 'movement'));
  const byLot = traceLines({ batches: BATCHES, movements: MOVEMENTS, pulls: [{ product_name: 'Chicken', lot_code: 'L-9', supplier_name: 'Sysco', quantity: 3, reason: 'Recall notice', created_at: '2026-11-22T08:00:00Z' }], waste: [], checks: [] }, { lot: 'L-9' });
  assert.ok(byLot.some((l) => l.kind === 'pull' && l.detail === 'Recall notice'), 'the pull is a line of the log');
  assert.ok(byLot.every((l) => l.lot_code === 'L-9'));
  const all = traceLines({ batches: BATCHES, movements: MOVEMENTS, pulls: [], waste: [], checks: [] }, {});
  assert.equal(all.length, BATCHES.length + MOVEMENTS.length, 'no pick = the whole log');
});

test('productForCode: the in-place case scan matches barcode, UPC or SKU — never guesses', () => {
  const products = [{ id: 'p1', name: 'Chicken', barcode: '111', upc: '222', sku: 'CHK-1' }];
  assert.equal(productForCode(products, '111')?.id, 'p1');
  assert.equal(productForCode(products, '222')?.id, 'p1');
  assert.equal(productForCode(products, 'CHK-1')?.id, 'p1');
  assert.equal(productForCode(products, '999'), null);
  assert.equal(productForCode(products, ''), null);
});

test('migration 070 carries the lot columns, the pulls and the receiving checks', () => {
  const sql = read('migrations/070_lot_traceability.sql');
  for (const needle of [
    'ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS lot_code',
    'ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS supplier_name',
    "status TEXT NOT NULL DEFAULT 'active'",
    'ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS actual_weight',
    'ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS lot_code',
    'ALTER TABLE waste_entries ADD COLUMN IF NOT EXISTS lot_code',
    'CREATE TABLE IF NOT EXISTS lot_pulls',
    'CREATE TABLE IF NOT EXISTS receiving_checks',
    'refusal_reason',
  ]) {
    assert.ok(sql.includes(needle), needle);
  }
});

test('the 10 new server wordings are keyed in the apiErrors registry', () => {
  const pairs = [
    ['Only the owner, a manager, or a person with the stock-building permission can record a delivery or pull a lot.', 'apiErrors.lotTrace.stockDoor'],
    ['Choose the product this delivery belongs to.', 'apiErrors.lotTrace.productNeeded'],
    ['A delivery needs its lot code — read it off the stamp on the case.', 'apiErrors.lotTrace.lotNeeded'],
    ['Enter how much arrived — a quantity greater than zero.', 'apiErrors.lotTrace.quantityNeeded'],
    ['That batch is not in this business.', 'apiErrors.lotTrace.batchNotHere'],
    ['This lot has already been pulled.', 'apiErrors.lotTrace.alreadyPulled'],
    ['A pulled lot needs its reason — the health department and the supplier will ask for it.', 'apiErrors.lotTrace.pullReason'],
    ['A refused delivery needs the reason it was refused.', 'apiErrors.lotTrace.refusalReason'],
    ['Type the lot code you are looking for.', 'apiErrors.lotTrace.finderNeeded'],
    ['The actual weight must be greater than zero when it is recorded.', 'apiErrors.lotTrace.weightNeeded'],
  ];
  assert.equal(pairs.length, 10);
  for (const [message, key] of pairs) assert.equal(API_ERROR_MESSAGE_KEYS[message], key, message);
});

test('wiring: plan gate, lot-stamped movements, the pull record and the waste flow', () => {
  const routes = read('server/lotTraceRoutes.js');
  const app = read('server/app.js');
  assert.ok(app.includes('createLotTraceRouter'), 'the router is registered');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"), 'every door sits behind the restaurant plan gate');
  assert.ok(routes.includes("type: 'receive'"), 'receiving stocks in through the movement funnel');
  assert.ok(routes.includes('UPDATE stock_movements SET lot_code'), 'the lot is stamped onto its movements — carried through');
  assert.ok(routes.includes('INSERT INTO receiving_checks'), 'the receiving check log is written at the back door');
  const pullAt = routes.indexOf("`${base}/pull`");
  assert.ok(pullAt > 0);
  assert.ok(routes.indexOf("status = 'pulled'", pullAt) > pullAt, 'the pull locks the batch');
  assert.ok(routes.indexOf('INSERT INTO lot_pulls', pullAt) > pullAt, 'the pull itself becomes a record');
  assert.ok(routes.indexOf("'recall'", pullAt) > pullAt, 'what was left flows into the waste log as a recall');
  assert.ok(routes.includes('recallAnswer') && routes.includes('traceLines'), 'the finder and the log read through the pure core');
});

test('wiring: the page, the shelves and the Studio print exist', () => {
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/restaurant/lot-trace"'), 'the route exists behind the restaurant PlanRedirect');
  const page = read('src/pages/RestaurantLotTrace.jsx');
  assert.ok(page.includes('BarcodeScanner'), 'the Corner Scanner Rule: scanning happens in place on the receiving surface');
  assert.ok(page.includes('productForCode'), 'a case scan finds its product on this surface');
  assert.ok(page.includes('TraceabilityDoc'), 'the traceability log prints as a Studio document');
  const doc = read('src/components/print/TraceabilityDoc.jsx');
  assert.ok(doc.includes('export default function TraceabilityDoc'), 'the Studio traceability sheet exists (preview = print)');
  const shelves = read('src/lib/restaurantShelves.js');
  assert.ok(shelves.includes("door('/restaurant/lot-trace', 'nav.lotTrace', 'restaurant.doorLotTrace', SearchCheck)"), 'the Stock & Ordering shelf is its home');
  assert.ok(shelves.includes("door('/restaurant/lot-trace', 'nav.lotTrace', 'restaurant.doorLotTrace', SearchCheck, { crossLink: true })"), 'the Food Safety shelf cross-links it');
});
