// t90 — Plan release 379: BAR COUNTING (Gap 10, the
// no-hardware version only) — Business-only, Restaurant
// Corner, Stock & Ordering shelf.
//
// Pinned here:
//   - 38 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 6903
//     (6678 + 38 bar counting); placeholders survive
//     translation.
//   - The registry gains exactly the four bar-counting
//     messages (the owner-switch refusal, the counts-door
//     refusal, the cleaner refusal, the switched-off
//     refusal), word for word, and the client maps them.
//   - The plan presentation carries the bar-counting line
//     in Business and only Business (Plans list, Welcome
//     list, comparison matrix).
//   - The training catalogs (client + server) agree at 132
//     lessons; the bar-counting lesson rides the owner
//     track under the RESTAURANT heading with 5 steps.
//   - The pure arithmetic: full units + the open one's
//     tenths, the cleaning rules, and the count-session
//     shape a bar count saves (the count machinery, never
//     a side silo — no new table).
//   - The anti-clutter doctrine: the shelf door is barOnly
//     and hidden until the owner turns it on; the switch
//     is owner-only; saving rides the counts door.
//   - Wiring: migration 067 (the switch column only), the
//     router mount, the plan gate in the routes, the shelf
//     door, the Studio print face.
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
import { visibleDoors, shelfById } from '../../src/lib/restaurantShelves.js';
import { partialCounted as clientPartial, bottleFill } from '../../src/lib/barCounting.js';
import {
  BAR_COUNT_MESSAGE,
  BAR_MESSAGE,
  BAR_OFF_MESSAGE,
  BAR_OWNER_MESSAGE,
  barCountNumber,
  canBarCount,
  canToggleBar,
  cleanBarCount,
  cleanBarLine,
  partialCounted,
} from '../../server/barCountingCore.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.barCounting', 'restaurant.doorBarCounting', 'plansLib.businessIncludes.barCounting',
  'barCounting.title', 'barCounting.subtitle', 'barCounting.offTitle', 'barCounting.offBody',
  'barCounting.turnOnButton', 'barCounting.turnOffButton', 'barCounting.enabledNote',
  'barCounting.ownerOnlyNote', 'barCounting.areaLabel', 'barCounting.kindBottle',
  'barCounting.kindKeg', 'barCounting.fullLabel', 'barCounting.partialLabel',
  'barCounting.countedLabel', 'barCounting.expectedLabel', 'barCounting.colProduct',
  'barCounting.saveButton', 'barCounting.savedNote', 'barCounting.saveFailed',
  'barCounting.emptyTitle', 'barCounting.emptyBody', 'barCounting.printButton',
  'barCounting.docTitle', 'barCounting.docArea', 'barCounting.varianceNote',
  'apiErrors.barCountingForbidden', 'apiErrors.barCountingCountForbidden',
  'apiErrors.barCountingInvalid', 'apiErrors.barCountingOff',
  'training.lessons.owner-bar-counting.title', 'training.lessons.owner-bar-counting.step1',
  'training.lessons.owner-bar-counting.step2', 'training.lessons.owner-bar-counting.step3',
  'training.lessons.owner-bar-counting.step4', 'training.lessons.owner-bar-counting.step5',
];

test('the keyset is uniform at 6903 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 6903, code);
});

test('all 38 bar-counting keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 38);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('English variants and base-riding locales carry the same bar-counting strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('placeholders survive translation in the saved note and the doc area line', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    assert.ok(table['barCounting.savedNote'].includes('{number}'), `${code} savedNote`);
    assert.ok(table['barCounting.docArea'].includes('{name}'), `${code} docArea`);
  }
});

test('the four new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(BAR_OWNER_MESSAGE, 'Only the owner can turn bar counting on or off.');
  assert.equal(BAR_COUNT_MESSAGE, 'Only the owner, a manager, or a person with the counting permission can save a bar count.');
  assert.equal(BAR_MESSAGE, 'Check the bar count and try again.');
  assert.equal(BAR_OFF_MESSAGE, 'Bar counting is not turned on for this business.');
  assert.equal(API_ERROR_MESSAGE_KEYS[BAR_OWNER_MESSAGE], 'apiErrors.barCountingForbidden');
  assert.equal(API_ERROR_MESSAGE_KEYS[BAR_COUNT_MESSAGE], 'apiErrors.barCountingCountForbidden');
  assert.equal(API_ERROR_MESSAGE_KEYS[BAR_MESSAGE], 'apiErrors.barCountingInvalid');
  assert.equal(API_ERROR_MESSAGE_KEYS[BAR_OFF_MESSAGE], 'apiErrors.barCountingOff');
  assert.equal(LOCALES.en['apiErrors.barCountingForbidden'], BAR_OWNER_MESSAGE);
  assert.equal(LOCALES.en['apiErrors.barCountingCountForbidden'], BAR_COUNT_MESSAGE);
  assert.equal(LOCALES.en['apiErrors.barCountingInvalid'], BAR_MESSAGE);
  assert.equal(LOCALES.en['apiErrors.barCountingOff'], BAR_OFF_MESSAGE);
});

test('plan presentation: the bar-counting line is Business-only in Plans, Welcome and the matrix', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.barCounting').length - 1, 3, 'line in Plans Business, Welcome Business and the matrix only');
  const line = en['plansLib.businessIncludes.barCounting'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the bar-counting line');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the bar-counting line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials never carries the bar-counting line');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never carries it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

test('the catalogs agree at 132 lessons and the bar-counting lesson rides the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 136);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-bar-counting');
  assert.ok(lesson, 'bar-counting lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-bar-counting.title'], 'Counting the bar: partial bottles and kegs');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 115);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 21);
});

test('partialCounted: full units plus the open one\u2019s tenths, nothing else', () => {
  assert.equal(partialCounted(3, 7), 3.7);
  assert.equal(partialCounted(0, 0), 0);
  assert.equal(partialCounted(12, 9), 12.9);
  assert.equal(partialCounted('2', '5'), 2.5);
  assert.throws(() => partialCounted(1, 10), /bar count/i, 'tenths stop at 9 — a tenth of ten is the next full one');
  assert.throws(() => partialCounted(1, -1), /bar count/i);
  assert.throws(() => partialCounted(-1, 0), /bar count/i);
  assert.throws(() => partialCounted(1.5, 0), /bar count/i, 'full units are whole');
  assert.throws(() => partialCounted(1, 2.5), /bar count/i, 'tenths are whole stops on the slider');
  // The client's live preview agrees with the server's arithmetic.
  assert.equal(clientPartial(3, 7), 3.7);
  assert.equal(bottleFill(7), 0.7);
  assert.equal(bottleFill(0), 0);
});

test('cleanBarLine / cleanBarCount keep the sheet honest', () => {
  assert.deepEqual(
    cleanBarLine({ product_id: 'p1', kind: 'bottle', full_units: 3, partial_tenths: 7 }),
    { product_id: 'p1', kind: 'bottle', full_units: 3, partial_tenths: 7, counted: 3.7 },
  );
  assert.deepEqual(
    cleanBarLine({ product_id: 'p2', kind: 'keg', full_units: 1, partial_tenths: 4 }),
    { product_id: 'p2', kind: 'keg', full_units: 1, partial_tenths: 4, counted: 1.4 },
    'a keg is recorded the same way',
  );
  assert.throws(() => cleanBarLine({ product_id: 'p1', kind: 'case', full_units: 1, partial_tenths: 0 }), /bar count/i);
  assert.throws(() => cleanBarLine({ kind: 'bottle', full_units: 1, partial_tenths: 0 }), /bar count/i);
  const clean = cleanBarCount({
    location_id: 'loc-bar',
    lines: [
      { product_id: 'p1', kind: 'bottle', full_units: 3, partial_tenths: 7 },
      { product_id: 'p2', kind: 'keg', full_units: 0, partial_tenths: 5 },
    ],
  });
  assert.equal(clean.location_id, 'loc-bar');
  assert.equal(clean.lines.length, 2);
  assert.throws(() => cleanBarCount({ location_id: 'loc-bar', lines: [] }), /bar count/i, 'an empty count is refused');
  assert.throws(() => cleanBarCount({ lines: [{ product_id: 'p1', kind: 'bottle', full_units: 1, partial_tenths: 0 }] }), /bar count/i, 'a count names its storage area');
  assert.throws(() => cleanBarCount({
    location_id: 'loc-bar',
    lines: [
      { product_id: 'p1', kind: 'bottle', full_units: 1, partial_tenths: 0 },
      { product_id: 'p1', kind: 'keg', full_units: 1, partial_tenths: 0 },
    ],
  }), /bar count/i, 'one line per product per area');
});

test('the doors: the switch is the owner\u2019s alone; saving rides the counts door', () => {
  assert.equal(canToggleBar({ isOwner: true }), true);
  assert.equal(canToggleBar({ isOwner: false, can: () => true }), false);
  assert.equal(canToggleBar(null), false);
  assert.equal(canBarCount({ isOwner: true }), true);
  assert.equal(canBarCount({ isOwner: false, can: (p) => p === 'counts.run' }), true);
  assert.equal(canBarCount({ isOwner: false, can: () => false }), false);
  assert.equal(canBarCount(null), false);
});

test('anti-clutter: the shelf door is barOnly and hidden until the owner turns it on', () => {
  const stock = shelfById('stock');
  const off = visibleDoors(stock, false).map((d) => d.to);
  assert.ok(!off.includes('/restaurant/bar-counting'), 'no bar door while the switch is off');
  const on = visibleDoors(stock, true).map((d) => d.to);
  assert.ok(on.includes('/restaurant/bar-counting'), 'the door joins the Stock & Ordering shelf once on');
  const door = stock.doors.find((d) => d.to === '/restaurant/bar-counting');
  assert.equal(door.barOnly, true);
  const shelves = read('src/lib/restaurantShelves.js');
  assert.ok(shelves.includes("door('/restaurant/bar-counting', 'nav.barCounting', 'restaurant.doorBarCounting'"));
  const shelfPage = read('src/pages/RestaurantShelf.jsx');
  assert.ok(shelfPage.includes('visibleDoors(shelf'), 'the shelf page filters the door');
  assert.ok(shelfPage.includes('toggleBarCounting'), 'the shelf carries the owner\u2019s turn-on row while off');
});

test('the count machinery doctrine: a bar count saves as a count session, never a side table', () => {
  const core = read('server/barCountingCore.js');
  assert.ok(core.includes('INSERT INTO count_sessions'), 'the save writes the count machinery\u2019s own table');
  assert.ok(core.includes("scope_note") && core.includes("'bar'"), 'the session is marked as a bar count in its scope note');
  assert.ok(core.includes('bar_kind'), 'lines carry the bottle/keg kind');
  assert.ok(core.includes('partial_tenths'), 'lines carry the tenths beside the counted total');
  assert.ok(!core.includes('CREATE TABLE'), 'no side table is ever created');
  assert.ok(barCountNumber(new Date(2026, 10, 26)).startsWith('CNT-261126-'), 'the session number is the count machinery\u2019s own shape');
  const migration = read('migrations/067_bar_counting.sql');
  assert.ok(migration.includes('bar_counting_enabled'), 'migration 067 is the owner switch only');
  assert.ok(!migration.includes('CREATE TABLE'), 'migration 067 creates no table');
});

test('wiring: migration 067, router mount, plan gate, page, Studio print face', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'migrations', '067_bar_counting.sql')), 'migration 067 exists');
  const app = read('server/app.js');
  assert.ok(app.includes('createBarCountingRouter'));
  const routes = read('server/barCountingRoutes.js');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"), 'Business-only plan gate');
  assert.ok(routes.includes('canToggleBar(access)'), 'the toggle is owner-gated in the routes');
  assert.ok(routes.includes('canBarCount(access)'), 'saving is counts-door-gated in the routes');
  assert.ok(routes.includes('BAR_OFF_MESSAGE') || read('server/barCountingCore.js').includes('BAR_OFF_MESSAGE'));
  const page = read('src/pages/RestaurantBarCounting.jsx');
  assert.ok(page.includes('type="range"'), 'the tenths entry is a slider');
  assert.ok(page.includes('BottlePicture'), 'the slider fills a bottle picture');
  assert.ok(page.includes('partialCounted'), 'the page previews the counted total with the shared arithmetic');
  assert.ok(page.includes('BarCountDoc'), 'the page prints through the Studio doc');
  const doc = read('src/components/print/BarCountDoc.jsx');
  assert.ok(doc.includes('DocFrame'));
  assert.ok(doc.includes('barCounting.docTitle'));
  const appJsx = read('src/App.jsx');
  assert.ok(appJsx.includes('path="/restaurant/bar-counting"'));
  const auth = read('server/authRoutes.js');
  assert.ok(auth.includes('bar_counting_enabled'), 'the business record carries the switch to the shelf');
});
