// t89 — Plan release 378: ORDER BY PRODUCTION (Gap 8c) +
// its Part 7 rider, PREP SHEETS THAT FILL THEMSELVES
// (Business-only, Restaurant Corner).
//
// Pinned here:
//   - 42 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 6838
//     (6838 + 42); placeholders survive translation.
//   - The registry gains exactly the two production-order
//     messages (the write-door refusal + the cleaner
//     refusal), word for word, and the client maps them.
//   - The plan presentation carries the production-order
//     line in Business and only Business (Plans list,
//     Welcome list, comparison matrix).
//   - The training catalogs (client + server) agree at 131
//     lessons; the production-order lesson rides the owner
//     track under the RESTAURANT heading with 5 steps.
//   - The pure core: source cleaning, the plan arithmetic
//     (recipe expansion × makes, event totals, needed −
//     on-hand, pack rounding, supplier grouping), and the
//     prep-suggestion arithmetic (pars, booked events,
//     already prepped — shown, never written).
//   - The money doctrine: the draft maker inserts status
//     'draft' only, and nothing in the core or routes
//     sends or orders anything.
//   - Wiring: NO migration (drafts are purchase_orders
//     rows), the router mount, the plan gate + purchasing
//     gate in the routes, the shelf door, both Studio
//     print faces.
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
  buildProductionPlan, cleanProductionSource, PLAN_MESSAGE, PRODUCTION_MESSAGE,
} from '../../server/productionOrderCore.js';
import { prepSuggestions } from '../../src/lib/restaurantOps.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.productionOrder', 'restaurant.doorProductionOrder', 'plansLib.businessIncludes.productionOrder',
  'productionOrder.title', 'productionOrder.subtitle', 'productionOrder.draftNote',
  'productionOrder.sourceLabel', 'productionOrder.sourceBatch', 'productionOrder.sourceEvent',
  'productionOrder.recipeLabel', 'productionOrder.makesLabel', 'productionOrder.eventLabel',
  'productionOrder.planButton', 'productionOrder.colIngredient', 'productionOrder.colNeeded',
  'productionOrder.colOnHand', 'productionOrder.colOrder', 'productionOrder.colSupplier',
  'productionOrder.coveredNote', 'productionOrder.makeDraftsButton', 'productionOrder.draftsMade',
  'productionOrder.draftFailed', 'productionOrder.emptyTitle', 'productionOrder.emptyBody',
  'productionOrder.printButton', 'productionOrder.docTitle', 'productionOrder.batchSummary',
  'productionOrder.eventSummary',
  'apiErrors.productionOrderForbidden', 'apiErrors.productionOrderInvalid',
  'prepSuggest.title', 'prepSuggest.subtitle', 'prepSuggest.bookedLine', 'prepSuggest.suggested',
  'prepSuggest.whyLine', 'prepSuggest.none',
  'training.lessons.owner-production-order.title', 'training.lessons.owner-production-order.step1',
  'training.lessons.owner-production-order.step2', 'training.lessons.owner-production-order.step3',
  'training.lessons.owner-production-order.step4', 'training.lessons.owner-production-order.step5',
];

test('the keyset is uniform at 6838 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 6838, code);
});

test('all 42 production-order keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 42);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('English variants and base-riding locales carry the same production-order strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('placeholders survive translation in the summary and suggestion lines', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    assert.ok(table['productionOrder.draftsMade'].includes('{numbers}'), `${code} draftsMade`);
    assert.ok(table['productionOrder.batchSummary'].includes('{name}') && table['productionOrder.batchSummary'].includes('{makes}'), `${code} batchSummary`);
    assert.ok(table['productionOrder.eventSummary'].includes('{name}') && table['productionOrder.eventSummary'].includes('{date}'), `${code} eventSummary`);
    assert.ok(table['prepSuggest.bookedLine'].includes('{guests}') && table['prepSuggest.bookedLine'].includes('{events}'), `${code} bookedLine`);
    assert.ok(table['prepSuggest.suggested'].includes('{makes}'), `${code} suggested`);
    assert.ok(table['prepSuggest.whyLine'].includes('{par}') && table['prepSuggest.whyLine'].includes('{events}') && table['prepSuggest.whyLine'].includes('{prepped}'), `${code} whyLine`);
  }
});

test('the two new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(PRODUCTION_MESSAGE, 'Only the owner, a manager, or a person with the purchasing permission can order by production.');
  assert.equal(PLAN_MESSAGE, 'Check the production plan and try again.');
  assert.equal(API_ERROR_MESSAGE_KEYS[PRODUCTION_MESSAGE], 'apiErrors.productionOrderForbidden');
  assert.equal(API_ERROR_MESSAGE_KEYS[PLAN_MESSAGE], 'apiErrors.productionOrderInvalid');
  assert.equal(LOCALES.en['apiErrors.productionOrderForbidden'], PRODUCTION_MESSAGE);
  assert.equal(LOCALES.en['apiErrors.productionOrderInvalid'], PLAN_MESSAGE);
});

test('plan presentation: the production-order line is Business-only in Plans, Welcome and the matrix', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.productionOrder').length - 1, 3, 'line in Plans Business, Welcome Business and the matrix only');
  const line = en['plansLib.businessIncludes.productionOrder'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the production-order line');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the production-order line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials never carries the production-order line');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never carries it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

test('the catalogs agree at 131 lessons and the production-order lesson rides the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 135);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-production-order');
  assert.ok(lesson, 'production-order lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-production-order.title'], 'Ordering by production and prep sheets that fill themselves');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 115);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 20);
});

test('cleanProductionSource keeps the plan honest', () => {
  assert.deepEqual(cleanProductionSource({ kind: 'batch', recipe_id: 'r1', makes: '3' }), { kind: 'batch', recipe_id: 'r1', makes: 3 });
  assert.deepEqual(cleanProductionSource({ kind: 'batch', recipe_id: 'r1', makes: 2.2 }), { kind: 'batch', recipe_id: 'r1', makes: 3 }, 'a part-make is still a make');
  assert.deepEqual(cleanProductionSource({ kind: 'event', event_id: 'e1' }), { kind: 'event', event_id: 'e1' });
  assert.throws(() => cleanProductionSource({ kind: 'batch', recipe_id: 'r1', makes: 0 }), /production plan/i);
  assert.throws(() => cleanProductionSource({ kind: 'batch', makes: 2 }), /production plan/i);
  assert.throws(() => cleanProductionSource({ kind: 'event' }), /production plan/i);
  assert.throws(() => cleanProductionSource({ kind: 'guess' }), /production plan/i);
  assert.throws(() => cleanProductionSource(null), /production plan/i);
});

const RECIPES = [
  { id: 'r-sauce', name: 'House sauce', yield_qty: 10, product_id: 'p-sauce', lines: [{ kind: 'product', product_id: 'p-tomato', quantity: 4 }, { kind: 'product', product_id: 'p-oil', quantity: 1 }] },
  { id: 'r-pasta', name: 'Pasta plate', yield_qty: 1, lines: [{ kind: 'recipe', recipe_id: 'r-sauce', quantity: 2 }, { kind: 'product', product_id: 'p-pasta', quantity: 1 }] },
];
const PRODUCTS = [
  { id: 'p-tomato', name: 'Tomatoes', sku: 'TOM', unit: 'kg', cost: 2, supplier_id: 's1', supplier_name: 'Valley Farms' },
  { id: 'p-oil', name: 'Olive oil', sku: 'OIL', unit: 'l', cost: 8, supplier_id: 's2', supplier_name: 'City Wholesale' },
  { id: 'p-pasta', name: 'Pasta', sku: 'PAS', unit: 'kg', cost: 3, supplier_id: 's1', supplier_name: 'Valley Farms' },
  { id: 'p-sauce', name: 'House sauce (prep)', sku: '', unit: 'l', cost: 0 },
];
const PARS = [
  { product_id: 'p-tomato', par_qty: 20, pack_size: 5, supplier_id: 's1', supplier_name: 'Valley Farms' },
];
const LEVELS = [
  { product_id: 'p-tomato', quantity: 3 },
  { product_id: 'p-tomato', quantity: 2 },
  { product_id: 'p-oil', quantity: 10 },
];

test('buildProductionPlan (batch): expansion × makes, needed − on-hand, pack rounding, supplier groups', () => {
  const plan = buildProductionPlan({
    recipes: RECIPES, products: PRODUCTS, pars: PARS, levels: LEVELS,
    source: { kind: 'batch', recipe_id: 'r-pasta', makes: 10 },
  });
  assert.equal(plan.source.name, 'Pasta plate');
  // 10 makes of pasta: 10 kg pasta; sauce 2/make ÷ yield 10 = 0.2 sauce-makes per
  // make → 2 sauce makes → 8 kg tomatoes, 2 l oil.
  const tomato = plan.lines.find((l) => l.product_id === 'p-tomato');
  assert.equal(tomato.needed, 8);
  assert.equal(tomato.onHand, 5, 'on hand sums every location');
  assert.equal(tomato.need, 3);
  assert.equal(tomato.orderQty, 5, 'need rounds UP to the par pack of 5');
  const oil = plan.lines.find((l) => l.product_id === 'p-oil');
  assert.equal(oil.needed, 2);
  assert.equal(oil.orderQty, 0, 'the shelf covers the oil — it stays on the plan at 0');
  const pasta = plan.lines.find((l) => l.product_id === 'p-pasta');
  assert.equal(pasta.orderQty, 10, 'no par pack — rounds to whole units');
  assert.equal(plan.covered, false);
  assert.equal(plan.groups.length, 1, 'only Valley Farms has anything to order');
  assert.equal(plan.groups[0].supplier_name, 'Valley Farms');
  assert.equal(plan.groups[0].total, 5 * 2 + 10 * 3);
});

test('buildProductionPlan (event): the 375 menu pull, and a cancelled event pulls nothing', () => {
  const event = { id: 'e1', name: 'Wedding', status: 'booked', event_date: '2026-12-05', menu: [{ recipe_id: 'r-sauce', servings: 25 }] };
  const plan = buildProductionPlan({
    recipes: RECIPES, products: PRODUCTS, pars: PARS, levels: LEVELS,
    source: { kind: 'event', event_id: 'e1' }, event,
  });
  assert.equal(plan.source.name, 'Wedding');
  // 25 servings ÷ yield 10 = 3 makes (rounded up by the 375 arithmetic):
  // 12 kg tomatoes, 3 l oil.
  const tomato = plan.lines.find((l) => l.product_id === 'p-tomato');
  assert.equal(tomato.needed, 12);
  assert.equal(tomato.orderQty, 10, 'need 7 rounds up to two packs of 5');
  const cancelled = buildProductionPlan({
    recipes: RECIPES, products: PRODUCTS, pars: PARS, levels: LEVELS,
    source: { kind: 'event', event_id: 'e1' }, event: { ...event, status: 'cancelled' },
  });
  assert.equal(cancelled.lines.length, 0);
  assert.equal(cancelled.covered, true, 'a covered plan makes no drafts');
  assert.throws(() => buildProductionPlan({
    recipes: RECIPES, products: PRODUCTS, pars: PARS, levels: LEVELS,
    source: { kind: 'batch', recipe_id: 'nope', makes: 1 },
  }), /production plan/i);
});

test('prepSuggestions: par shortfall, booked events lift the want, already-prepped comes off', () => {
  const pars = [{ product_id: 'p-sauce', par_qty: 30, location_id: null }];
  const levels = [{ product_id: 'p-sauce', quantity: 12, location_id: 'l1' }];
  const noEvents = prepSuggestions(pars, RECIPES, PRODUCTS, levels, []);
  assert.equal(noEvents.length, 1);
  assert.equal(noEvents[0].parMakes, 2, 'par 30 − prepped 12 = 18 servings = 2 makes of 10');
  assert.equal(noEvents[0].suggestedMakes, 2);
  const withEvent = prepSuggestions(pars, RECIPES, PRODUCTS, levels, [
    { event: { id: 'e1' }, prep: { dishes: [{ recipe_id: 'r-sauce', servings: 50, makes: 5 }] } },
  ]);
  assert.equal(withEvent[0].eventMakes, 5);
  // Want = max(par 30, prepped 12 + booked 50) = 62 → 50 short = 5 makes.
  assert.equal(withEvent[0].suggestedMakes, 5);
  const tomato = withEvent[0].ingredients.find((i) => i.product_id === 'p-tomato');
  assert.equal(tomato.quantity, 20, 'ingredients follow the suggested makes');
  const covered = prepSuggestions(pars, RECIPES, PRODUCTS, [{ product_id: 'p-sauce', quantity: 40 }], []);
  assert.equal(covered[0].suggestedMakes, 0, 'already prepped past par suggests nothing');
});

test('the money doctrine: drafts only — no send or order path exists in the core or routes', () => {
  const core = read('server/productionOrderCore.js');
  assert.ok(core.includes("VALUES ($1,$2,$3,$4,$5,'draft'"), 'the purchase order is inserted as a draft, always');
  assert.equal(core.split('INSERT INTO purchase_orders').length - 1, 1, 'the only purchase-order insert is the draft one');
  for (const banned of ['sendPurchaseOrder', 'sendMail', 'sendSms', 'SET status']) {
    assert.ok(!core.includes(banned), `core never touches: ${banned}`);
  }
  const routes = read('server/productionOrderRoutes.js');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"));
  assert.ok(routes.includes('canOrder(access)'));
  assert.ok(routes.includes('PRODUCTION_MESSAGE'));
  assert.ok(!routes.includes('sendPurchaseOrder'));
  const page = read('src/pages/RestaurantProductionOrder.jsx');
  assert.ok(page.includes('productionOrder.draftNote'));
  assert.ok(page.includes('makeProductionDrafts'));
});

test('the prep extension is shown, never written: the helper and page carry no write door', () => {
  const ops = read('src/lib/restaurantOps.js');
  const helper = ops.slice(ops.indexOf('export function prepSuggestions'), ops.indexOf('export function prepSuggestions') + 4000);
  assert.ok(!helper.includes('base44') && !helper.includes('apiRequest') && !helper.includes('.create('), 'the suggestion arithmetic writes nothing');
  const page = read('src/pages/RestaurantPrep.jsx');
  assert.ok(page.includes('prepSuggestions('));
  assert.ok(page.includes('prepSuggest.bookedLine'));
  assert.ok(page.includes('fetchReservationsToday'));
});

test('wiring: no migration, router mount, shelf door, Studio print faces, prep doc section', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'migrations', '067_production_order.sql')), 'no migration 067 — none was needed');
  const app = read('server/app.js');
  assert.ok(app.includes('createProductionOrderRouter'));
  const shelves = read('src/lib/restaurantShelves.js');
  assert.ok(shelves.includes("door('/restaurant/production-order', 'nav.productionOrder', 'restaurant.doorProductionOrder'"));
  const doc = read('src/components/print/ProductionOrderDoc.jsx');
  assert.ok(doc.includes('DocFrame'));
  assert.ok(doc.includes('productionOrder.docTitle'));
  const page = read('src/pages/RestaurantProductionOrder.jsx');
  assert.ok(page.includes('ProductionOrderDoc'));
  const prepDoc = read('src/components/print/PrepSheetDoc.jsx');
  assert.ok(prepDoc.includes('prepSuggest.title'), 'the printed prep sheet carries the suggestions section');
  const appJsx = read('src/App.jsx');
  assert.ok(appJsx.includes('path="/restaurant/production-order"'));
});
