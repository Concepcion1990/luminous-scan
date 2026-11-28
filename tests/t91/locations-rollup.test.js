// t91 — Plan release 380: ALL-LOCATIONS ROLLUP (Gap 14) +
// the Part 7 rider, CROSS-LOCATION PUSH — Business-only by
// nature (multi-business IS Business), Restaurant Corner,
// Locations shelf (owners with 2+ businesses only).
//
// Pinned here:
//   - 43 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 6903
//     (6716 + 43 rollup); placeholders survive translation.
//   - The registry gains exactly the two rollup messages
//     (the owner-only refusal and the cleaner refusal),
//     word for word, and the client maps them.
//   - The plan presentation carries the rollup line in
//     Business and only Business (Plans list, Welcome list,
//     comparison matrix).
//   - The training catalogs (client + server) agree at 133
//     lessons; the rollup lesson rides the owner track
//     under the RESTAURANT heading with 5 steps.
//   - The push's matching: SKU first, then name; recipe
//     lines remap to the target's own ids; anything with
//     no match is named in `dropped`, never silent; an
//     unmatched dish leaves the copy product-less (the
//     core then lands it as a draft).
//   - The anti-clutter doctrine: the Locations shelf joins
//     only at 2+ businesses, and the rollup door is its
//     first door; the rollup is owner-only in the routes.
//   - The reporting doctrine: no new capture — no new
//     table, no migration (068 does not exist), the read
//     is computed from recipes, products, stock levels and
//     the waste log the business already keeps.
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
import { LOCATIONS_SHELF, homeShelfForRoute, shelvesFor } from '../../src/lib/restaurantShelves.js';
import {
  ROLLUP_MESSAGE,
  ROLLUP_OWNER_MESSAGE,
  matchProduct,
  remapRecipeLines,
} from '../../server/locationsRollupCore.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.locationsRollup', 'restaurant.doorLocationsRollup', 'plansLib.businessIncludes.locationsRollup',
  'locationsRollup.title', 'locationsRollup.subtitle', 'locationsRollup.colLocation',
  'locationsRollup.colFoodCost', 'locationsRollup.colStockValue', 'locationsRollup.colWaste',
  'locationsRollup.colLow', 'locationsRollup.foodCostNone', 'locationsRollup.lowNone',
  'locationsRollup.totalsLabel', 'locationsRollup.weekNote', 'locationsRollup.printButton',
  'locationsRollup.docTitle', 'locationsRollup.emptyTitle', 'locationsRollup.emptyBody',
  'locationsRollup.loadFailed', 'locationsRollup.pushTitle', 'locationsRollup.pushBody',
  'locationsRollup.pushRecipeLabel', 'locationsRollup.pushPricesLabel', 'locationsRollup.pushPricesBody',
  'locationsRollup.targetsLabel', 'locationsRollup.pushRecipeButton', 'locationsRollup.pushPricesButton',
  'locationsRollup.resultCreated', 'locationsRollup.resultUpdated', 'locationsRollup.resultDropped',
  'locationsRollup.resultPrices', 'locationsRollup.resultSkippedPlan', 'locationsRollup.pushFailed',
  'locationsRollup.noTargets', 'locationsRollup.dishUnmatched',
  'apiErrors.locationsRollupForbidden', 'apiErrors.locationsRollupInvalid',
  'training.lessons.owner-locations-rollup.title', 'training.lessons.owner-locations-rollup.step1',
  'training.lessons.owner-locations-rollup.step2', 'training.lessons.owner-locations-rollup.step3',
  'training.lessons.owner-locations-rollup.step4', 'training.lessons.owner-locations-rollup.step5',
];

test('the keyset is uniform at 6903 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 6903, code);
});

test('all 43 rollup keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 43);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('English variants and base-riding locales carry the same rollup strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('placeholders survive translation in the push lines', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    assert.ok(table['locationsRollup.pushPricesBody'].includes('{count}'), `${code} pushPricesBody`);
    for (const key of ['locationsRollup.resultCreated', 'locationsRollup.resultUpdated', 'locationsRollup.resultSkippedPlan', 'locationsRollup.dishUnmatched']) {
      assert.ok(table[key].includes('{business}'), `${code} ${key}`);
    }
    assert.ok(table['locationsRollup.resultDropped'].includes('{business}') && table['locationsRollup.resultDropped'].includes('{names}'), `${code} resultDropped`);
    assert.ok(table['locationsRollup.resultPrices'].includes('{updated}') && table['locationsRollup.resultPrices'].includes('{skipped}'), `${code} resultPrices`);
  }
});

test('the two new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(ROLLUP_OWNER_MESSAGE, 'Only the owner can use the all-locations rollup.');
  assert.equal(ROLLUP_MESSAGE, 'Check the copy request and try again.');
  assert.equal(API_ERROR_MESSAGE_KEYS[ROLLUP_OWNER_MESSAGE], 'apiErrors.locationsRollupForbidden');
  assert.equal(API_ERROR_MESSAGE_KEYS[ROLLUP_MESSAGE], 'apiErrors.locationsRollupInvalid');
  assert.equal(LOCALES.en['apiErrors.locationsRollupForbidden'], ROLLUP_OWNER_MESSAGE);
  assert.equal(LOCALES.en['apiErrors.locationsRollupInvalid'], ROLLUP_MESSAGE);
});

test('plan presentation: the rollup line is Business-only in Plans, Welcome and the matrix', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.locationsRollup').length - 1, 3, 'line in Plans Business, Welcome Business and the matrix only');
  const line = en['plansLib.businessIncludes.locationsRollup'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the rollup line');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the rollup line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials never carries the rollup line');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never carries it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

test('the catalogs agree at 133 lessons and the rollup lesson rides the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 136);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-locations-rollup');
  assert.ok(lesson, 'rollup lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-locations-rollup.title'], 'All locations on one page');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 115);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 21);
});

test('matchProduct: SKU first, then name, both exact apart from case and space', () => {
  const targets = [
    { id: 't1', name: 'Flour', sku: 'FL-1' },
    { id: 't2', name: 'Sugar', sku: 'SG-9' },
    { id: 't3', name: 'flour', sku: '' },
  ];
  assert.equal(matchProduct({ name: 'Anything', sku: 'fl-1' }, targets).id, 't1', 'SKU wins over everything');
  assert.equal(matchProduct({ name: 'Sugar', sku: 'XX' }, targets).id, 't2', 'an unmatched SKU falls through to the name');
  assert.equal(matchProduct({ name: ' sugar ', sku: '' }, targets).id, 't2', 'names match trimmed and case-insensitive');
  assert.equal(matchProduct({ name: 'Cocoa', sku: '' }, targets), null, 'no match is null, never a guess');
  assert.equal(matchProduct(null, targets), null);
  assert.equal(matchProduct({ name: '', sku: '' }, targets), null, 'an unnamed, unskued product matches nothing');
});

test('remapRecipeLines: lines land on the target\u2019s own ids; the unmatched are named, never silent', () => {
  const sourceProducts = new Map([
    ['sp-dish', { id: 'sp-dish', name: 'Pasta Dish', sku: 'DISH-1' }],
    ['sp-flour', { id: 'sp-flour', name: 'Flour', sku: 'FL-1' }],
    ['sp-truffle', { id: 'sp-truffle', name: 'Truffle', sku: 'TR-1' }],
  ]);
  const sourceRecipes = new Map([
    ['sr-sauce', { id: 'sr-sauce', name: 'House Sauce' }],
  ]);
  const recipe = {
    product_id: 'sp-dish',
    product_name: 'Pasta Dish',
    lines: JSON.stringify([
      { kind: 'product', product_id: 'sp-flour', product_name: 'Flour', quantity: 2 },
      { kind: 'product', product_id: 'sp-truffle', product_name: 'Truffle', quantity: 1 },
      { kind: 'recipe', recipe_id: 'sr-sauce', recipe_name: 'House Sauce', quantity: 3 },
    ]),
  };
  const targetProducts = [
    { id: 'tp-dish', name: 'Pasta Dish', sku: 'DISH-1' },
    { id: 'tp-flour', name: 'Flour', sku: 'FL-1' },
  ];
  const targetRecipes = [{ id: 'tr-sauce', name: 'house sauce' }];
  const { lines, dropped, dish } = remapRecipeLines(recipe, sourceProducts, sourceRecipes, targetProducts, targetRecipes);
  assert.equal(dish.id, 'tp-dish', 'the dish matches by SKU');
  assert.equal(lines.length, 2, 'the matched lines land');
  assert.equal(lines[0].product_id, 'tp-flour');
  assert.equal(lines[1].recipe_id, 'tr-sauce', 'a sub-recipe matches by name');
  assert.deepEqual(dropped, ['Truffle'], 'the unmatched ingredient is named in dropped');

  const orphan = remapRecipeLines(
    { product_id: 'sp-truffle', product_name: 'Truffle', lines: '[]' },
    sourceProducts, sourceRecipes, targetProducts, targetRecipes,
  );
  assert.equal(orphan.dish, null, 'an unmatched dish leaves the copy product-less — the core lands it as a draft');
});

test('anti-clutter: the Locations shelf joins only at 2+ businesses and the rollup is its first door', () => {
  assert.equal(shelvesFor(1).some((s) => s.id === 'locations'), false, 'a single-location owner never sees the shelf');
  assert.equal(shelvesFor(2).some((s) => s.id === 'locations'), true);
  assert.equal(shelvesFor(5).some((s) => s.id === 'locations'), true);
  const door = LOCATIONS_SHELF.doors.find((d) => d.to === '/restaurant/locations-rollup');
  assert.ok(door, 'the rollup door lives on the Locations shelf');
  assert.equal(door.titleKey, 'nav.locationsRollup');
  assert.equal(homeShelfForRoute('/restaurant/locations-rollup')?.id, 'locations', 'the page\u2019s breadcrumb home is the Locations shelf');
  const shelfPage = read('src/pages/RestaurantShelf.jsx');
  assert.ok(shelfPage.includes('visibleDoors(shelf'), 'the Locations shelf page renders its doors');
});

test('the reporting doctrine: reporting over existing data — no new table, no migration', () => {
  const core = read('server/locationsRollupCore.js');
  assert.ok(!core.includes('CREATE TABLE'), 'no side table is ever created');
  assert.ok(!fs.existsSync(path.join(ROOT, 'migrations', '068_locations_rollup.sql')), 'no migration 068 was needed');
  assert.ok(core.includes('recipeCostPerUnit'), 'food cost % rides the 359 recipe math');
  assert.ok(core.includes('waste_entries'), 'waste reads the waste log the business already keeps');
  assert.ok(core.includes("date_trunc('week'"), 'waste this week is since Monday');
  assert.ok(core.includes('stock_levels'), 'stock value reads the levels on record');
  assert.ok(core.includes('reorder_point'), 'what\u2019s low reads the reorder points on record');
  assert.ok(core.includes('loadBusinessesForUser'), 'the rollup reads only businesses the caller owns');
});

test('wiring: router mount, owner-only plan gate, page, Studio print face', () => {
  const app = read('server/app.js');
  assert.ok(app.includes('createLocationsRollupRouter'));
  const routes = read('server/locationsRollupRoutes.js');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"), 'Business-only plan gate');
  assert.ok(routes.includes('access.isOwner'), 'every door is owner-only in the routes');
  assert.ok(routes.includes('ROLLUP_OWNER_MESSAGE'));
  assert.ok(routes.includes('/push-recipe') && routes.includes('/push-prices'), 'both push doors exist');
  const core = read('server/locationsRollupCore.js');
  assert.ok(core.includes('INSERT INTO recipes') && core.includes('UPDATE recipes'), 'a recipe copy creates or updates the target\u2019s own recipe');
  assert.ok(core.includes('UPDATE products SET price'), 'the price push writes the target\u2019s own products');
  assert.ok(core.includes('skipped_plan'), 'a non-Business target is reported skipped, never written');
  const page = read('src/pages/RestaurantLocationsRollup.jsx');
  assert.ok(page.includes('fetchLocationsRollup'));
  assert.ok(page.includes('pushRecipe') && page.includes('pushPrices'), 'the page carries both push doors');
  assert.ok(page.includes('RollupDoc'), 'the page prints through the Studio doc');
  const doc = read('src/components/print/RollupDoc.jsx');
  assert.ok(doc.includes('DocFrame'));
  assert.ok(doc.includes('locationsRollup.docTitle'));
  const appJsx = read('src/App.jsx');
  assert.ok(appJsx.includes('path="/restaurant/locations-rollup"'));
  assert.ok(appJsx.includes('<PlanRedirect feature="restaurant">'), 'the page route rides the plan gate');
});
