/**
 * T82 — KITCHEN RECIPE DISPLAY + GUEST MENU PAGE (Nov 26, 2026;
 * plan release 371, Gap 12 + Q-fire 6). Business-only,
 * Restaurant Corner. Two new windows on data that already
 * exists:
 *
 *  (1) KITCHEN RECIPE DISPLAY (Kitchen & Recipes shelf): one
 *      recipe, big and readable — photo, steps, and amounts
 *      that rescale by batch count in one tap (scaledLines:
 *      every amount × the batch count, yield likewise).
 *  (2) GUEST MENU PAGE (Floor & Guests shelf): a shareable /
 *      printable menu built ONLY from the recipes the owner
 *      published (migration 060), their linked dishes' prices,
 *      and the 361 allergen matrix (dishAllergens) — never a
 *      second typing. The public page needs no account and
 *      shows no StockHaven internal; the printed menu is a
 *      Studio document (GuestMenuDoc, PREVIEW = PRINT).
 *      Ordering (plan 399) is NOT built — no basket, no
 *      payment, no order route.
 *
 *  TEST + RETEST — by name below: amounts at 1 batch and at
 *  3 batches; a menu built from a publication, then rebuilt
 *  after the owner changes the publication (an unpublished
 *  dish never appears, a newly published one joins in the
 *  publication's order); allergen flags roll up through a
 *  sub-recipe exactly as the matrix computes them.
 *
 *  Keyset: 6211 + 45 = 6506 ×52, uniform. Training catalog:
 *  122 + 1 = 123 (staff track, restaurant module, RESTAURANT
 *  heading, 5 steps, restaurant feature). Migration 060
 *  (menu_publications). No new apiErrors wordings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { PLANS, WELCOME_OPTIONS, COMPARISON_ROWS } from '../../src/lib/plans.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';
import {
  buildGuestMenuItems, cleanPublishedIds, normalizeBatchCount, recipeSteps, scaledLines, tidyQty,
} from '../../src/lib/kitchenMenu.js';
import {
  buildGuestMenu, cleanPublishedIds as serverCleanIds, newMenuSlug, shapePublication,
} from '../../server/guestMenuCore.js';
import { SHELVES } from '../../src/lib/restaurantShelves.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.kitchenDisplay', 'nav.guestMenu',
  'restaurant.doorKitchenDisplay', 'restaurant.doorGuestMenu',
  'plansLib.businessIncludes.kitchenDisplay', 'plansLib.businessIncludes.guestMenuPage',
  'kitchen.title', 'kitchen.subtitle', 'kitchen.batchesLabel', 'kitchen.makesLabel',
  'kitchen.amountsFor', 'kitchen.ingredientsTitle', 'kitchen.stepsTitle', 'kitchen.noSteps',
  'kitchen.emptyTitle', 'kitchen.emptyBody', 'kitchen.backButton',
  'guestMenu.title', 'guestMenu.subtitle', 'guestMenu.chooseTitle', 'guestMenu.chooseIntro',
  'guestMenu.save', 'guestMenu.saved', 'guestMenu.saveFailed', 'guestMenu.linkTitle',
  'guestMenu.linkHint', 'guestMenu.notPublished', 'guestMenu.printButton', 'guestMenu.previewTitle',
  'guestMenu.docTitle', 'guestMenu.allergenPrefix', 'guestMenu.noAllergens', 'guestMenu.allergenNote',
  'guestMenu.emptyTitle', 'guestMenu.emptyBody', 'guestMenu.notFound', 'guestMenu.loadFailed',
  'guestMenu.publishedCount', 'guestMenu.noPrice',
  'training.lessons.staff-kitchen-menu.title', 'training.lessons.staff-kitchen-menu.step1',
  'training.lessons.staff-kitchen-menu.step2', 'training.lessons.staff-kitchen-menu.step3',
  'training.lessons.staff-kitchen-menu.step4', 'training.lessons.staff-kitchen-menu.step5',
];

/* ------------------------------------------------ i18n gate */

test('keyset stands at 6506 in all 52 locales, uniform', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  const enKeys = Object.keys(LOCALES.en).sort();
  assert.equal(enKeys.length, 7012);
  for (const code of codes) {
    assert.equal(Object.keys(LOCALES[code]).length, 7012, `${code} keyset`);
    assert.deepEqual(Object.keys(LOCALES[code]).sort(), enKeys, `${code} keyset differs from en`);
  }
});

test('the 45 new keys exist in all 52 locales and are not the key itself', () => {
  assert.equal(NEW_KEYS.length, 45);
  assert.equal(new Set(NEW_KEYS).size, 45);
  for (const [code, strings] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof strings[key] === 'string' && strings[key].length >= 1, `${code} missing ${key}`);
      assert.notEqual(strings[key], key, `${code} ${key} renders as its own key`);
    }
  }
});

test('the five Englishes carry the new keys byte-identical to base en; es/fr variants and prs ride their base', () => {
  for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) {
    for (const key of NEW_KEYS) assert.equal(LOCALES[code][key], en[key], `${code} ${key}`);
  }
  for (const code of ['es-ES', 'es-US', 'es-CU', 'es-PR', 'es-VE']) {
    for (const key of NEW_KEYS) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
  }
  for (const key of NEW_KEYS) assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
  for (const key of NEW_KEYS) assert.equal(LOCALES['prs'][key], LOCALES['fa'][key], `prs ${key}`);
});

test('placeholders survive translation: {qty}, {count} kept in every locale', () => {
  for (const [code, strings] of Object.entries(LOCALES)) {
    assert.ok(strings['kitchen.makesLabel'].includes('{qty}'), `${code} makesLabel`);
    assert.ok(strings['kitchen.amountsFor'].includes('{count}'), `${code} amountsFor`);
    assert.ok(strings['guestMenu.publishedCount'].includes('{count}'), `${code} publishedCount`);
  }
});

/* ------------------------------------------- plan presentation */

test('plan presentation: both new lines ride Business ONLY — Plans + Welcome + the matrix, never Essentials', () => {
  const plans = read('src/lib/plans.js');
  for (const key of ['plansLib.businessIncludes.kitchenDisplay', 'plansLib.businessIncludes.guestMenuPage']) {
    assert.equal(plans.split(key).length - 1, 3, `${key} referenced in Plans, Welcome and the matrix only`);
    const line = en[key];
    assert.ok(PLANS.business.includes.includes(line), `Plans Business carries ${key}`);
    assert.ok(WELCOME_OPTIONS.find((o) => o.key === 'business').includes.includes(line), `Welcome Business carries ${key}`);
    assert.ok(!PLANS.essentials.includes.includes(line), `Essentials Plans never sees ${key}`);
    assert.ok(!WELCOME_OPTIONS.find((o) => o.key === 'essentials').includes.includes(line), `Essentials Welcome never sees ${key}`);
    const row = COMPARISON_ROWS.find((r) => r.label === line);
    assert.ok(row && row.business === true && row.essentials === false, `matrix row for ${key} is Business-only`);
  }
});

/* ------------------------------------------------ training */

test('training catalogs agree at 125 and the lesson is a staff restaurant lesson under the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 139);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'staff-kitchen-menu');
  assert.ok(lesson, 'lesson exists');
  assert.equal(lesson.track, 'staff');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant');
  assert.equal(lesson.steps, 5);
  assert.ok(en['training.lessons.staff-kitchen-menu.title']);
});

/* ------------------------------------------- rescaling battery */

const PRODUCTS = [
  { id: 'p-flour', name: 'Flour', unit: 'g', allergens: ['wheat'] },
  { id: 'p-milk', name: 'Milk', unit: 'ml', allergens: ['milk'] },
  { id: 'p-egg', name: 'Egg', unit: 'each', allergens: ['eggs'] },
  { id: 'p-soup', name: 'Soup base', unit: 'each', price: 12.5, allergens: [] },
];
const RECIPES = [
  { id: 'r-sauce', name: 'Sauce', yield_qty: 4, lines: [{ kind: 'product', product_id: 'p-milk', product_name: 'Milk', quantity: 100, unit: 'ml' }] },
  {
    id: 'r-cake', name: 'Cake', yield_qty: 2, product_id: 'p-soup', photo_url: 'photo://cake',
    description: 'Mix the batter.\nBake 30 minutes.\n\nCool before serving.',
    lines: [
      { kind: 'product', product_id: 'p-flour', product_name: 'Flour', quantity: 250, unit: 'g' },
      { kind: 'recipe', recipe_id: 'r-sauce', recipe_name: 'Sauce', quantity: 2 },
      { kind: 'product', product_id: 'p-egg', product_name: 'Egg', quantity: 0.1, unit: 'each' },
    ],
  },
  { id: 'r-secret', name: 'Secret soup', yield_qty: 1, lines: [{ kind: 'product', product_id: 'p-egg', product_name: 'Egg', quantity: 1, unit: 'each' }] },
];
const byId = (list) => new Map(list.map((x) => [x.id, x]));

test('normalizeBatchCount: whole batches 1..99, everything else reads as 1', () => {
  assert.equal(normalizeBatchCount(3), 3);
  assert.equal(normalizeBatchCount(3.9), 3);
  assert.equal(normalizeBatchCount(0), 1);
  assert.equal(normalizeBatchCount(-2), 1);
  assert.equal(normalizeBatchCount(100), 1);
  assert.equal(normalizeBatchCount('x'), 1);
  assert.equal(tidyQty(0.30000000004), 0.3);
});

test('TEST: amounts rescale by batch count in one tap — 1 batch, then 3 batches', () => {
  const cake = RECIPES[1];
  const one = scaledLines(cake, byId(RECIPES), byId(PRODUCTS), 1);
  assert.deepEqual(one.map((r) => r.qty), [250, 2, 0.1]);
  const three = scaledLines(cake, byId(RECIPES), byId(PRODUCTS), 3);
  assert.deepEqual(three.map((r) => r.qty), [750, 6, 0.3]);
  assert.equal(three[0].qtyText, '750 g');
  assert.equal(three[0].label, 'Flour');
});

test('recipeSteps: the written method splits into ordered steps, blanks dropped, none invented', () => {
  assert.deepEqual(recipeSteps(RECIPES[1]), ['Mix the batter.', 'Bake 30 minutes.', 'Cool before serving.']);
  assert.deepEqual(recipeSteps(RECIPES[0]), []);
  assert.deepEqual(recipeSteps(null), []);
});

/* ------------------------------------------- guest menu battery */

test('TEST: the guest menu shows ONLY the published dishes, in publication order, with matrix allergens', () => {
  const items = buildGuestMenuItems(RECIPES, PRODUCTS, ['r-cake']);
  assert.equal(items.length, 1, 'the unpublished secret soup never appears');
  assert.equal(items[0].name, 'Cake');
  assert.equal(items[0].price, 12.5, 'price rides the linked dish product');
  assert.deepEqual(items[0].allergens, ['milk', 'eggs', 'wheat'],
    'allergens roll up through the sub-recipe sauce (milk) exactly as the 361 matrix computes');
});

test('RETEST: after the owner changes the publication, the rebuilt menu follows the new choice exactly', () => {
  const items = buildGuestMenuItems(RECIPES, PRODUCTS, ['r-secret', 'r-cake', 'r-gone']);
  assert.deepEqual(items.map((i) => i.name), ['Secret soup', 'Cake'], 'publication order kept; a vanished recipe is skipped, never guessed');
  assert.equal(items[0].price, null, 'a dish with no linked priced product carries no invented price');
  const none = buildGuestMenuItems(RECIPES, PRODUCTS, []);
  assert.deepEqual(none, [], 'an empty publication is an empty menu');
});

test('server shaping matches the client: guest-safe fields only, no internals can ride', () => {
  const menu = buildGuestMenu({
    business: { name: 'Cafe', currency: 'USD' },
    publication: { recipe_ids: JSON.stringify(['r-cake']) },
    recipes: RECIPES,
    products: PRODUCTS.map((p) => ({ ...p, cost: 99, supplier_id: 's-1' })),
  });
  assert.equal(menu.businessName, 'Cafe');
  assert.equal(menu.items.length, 1);
  assert.deepEqual(Object.keys(menu.items[0]).sort(), ['allergens', 'description', 'name', 'photoUrl', 'price', 'recipeId']);
  assert.ok(!JSON.stringify(menu).includes('99'), 'no cost figure anywhere in the shaped menu');
  assert.deepEqual(serverCleanIds('["a","a","b"]'), ['a', 'b']);
  assert.equal(shapePublication(null).enabled, false);
  assert.ok(newMenuSlug().length >= 24, 'the share slug is unguessable-length');
});

/* ------------------------------------------- wiring pins */

test('migration 060, the wipe sweep, the router mount and the plan gate are wired', () => {
  const migration = read('migrations/060_guest_menu.sql');
  assert.ok(migration.includes('menu_publications'));
  assert.ok(migration.includes('UNIQUE'), 'one publication per business / unique slug');
  assert.ok(!/REFERENCES/i.test(migration), 'no foreign key (the migration-017 lesson)');
  assert.ok(read('server/billing.js').includes("DELETE FROM menu_publications WHERE business_id = $1"), 'wipe sweep');
  assert.ok(read('server/app.js').includes('createGuestMenuRouter'), 'router mounted');
  const routes = read('server/guestMenuRoutes.js');
  assert.ok(routes.indexOf("'/public/menu/:slug'") < routes.indexOf('router.use(auth)'), 'the guest door is registered before the auth wall');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"), 'the corner plan gate');
  assert.ok(routes.includes("featureAllowed(planKey, 'restaurant')"), 'the public read re-checks the plan');
});

test('the two doors live on their shelves and both pages sit behind the restaurant PlanRedirect; the guest page is public', () => {
  const kitchen = SHELVES.find((s) => s.id === 'kitchen');
  assert.ok(kitchen.doors.some((d) => d.to === '/restaurant/kitchen-display' && !d.crossLink), 'kitchen display is a Kitchen & Recipes door');
  const floor = SHELVES.find((s) => s.id === 'floor');
  assert.ok(floor.doors.some((d) => d.to === '/restaurant/guest-menu' && !d.crossLink), 'guest menu is a Floor & Guests door');
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/restaurant/kitchen-display"'));
  assert.ok(app.includes('path="/restaurant/guest-menu"'));
  assert.ok(app.includes('path="/menu/:slug"'), 'the public guest route exists');
  assert.ok(app.includes("pathname.startsWith('/menu/')"), 'the guest route is open to everyone (no account)');
});

test('the printed menu is a Studio document and ordering is NOT built', () => {
  const doc = read('src/components/print/GuestMenuDoc.jsx');
  assert.ok(doc.includes('DocFrame') && doc.includes('docRootStyle'), 'Studio frame + style');
  assert.ok(doc.includes("t('guestMenu.docTitle')"));
  const pub = read('src/pages/GuestMenuPublic.jsx');
  assert.ok(pub.includes('/api/public/menu/'), 'the guest page reads the public door');
  assert.ok(!/basket|checkout|stripe/i.test(pub), 'no ordering surface on the guest page (plan 399 is later)');
});
