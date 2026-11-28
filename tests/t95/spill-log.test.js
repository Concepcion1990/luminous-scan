// t95 — Plan Part 7, item 392A: SPILL & BREAKAGE LOG
// (owner-ruled addition, Nov 26, 2026). Business-only,
// Restaurant Corner, Stock & Ordering home beside bar
// counting, under the bar family's owner switch.
//
// Pinned here:
//   - 37 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 6976
//     (6903 + 37 spill keys); the toast placeholder survives.
//   - The plan presentation carries the spill line on the
//     Business lists only (Plans + Welcome + the matrix
//     ✗/✓) — invisible on Essentials.
//   - The training catalogs agree at 137 lessons; the
//     spill lesson rides the owner track under the
//     RESTAURANT heading with 5 steps and the restaurant
//     feature gate (restaurant heading 21 → 22).
//   - The pure core: entry cleaning (item, quantity > 0,
//     the reason REQUIRED), pour-cost math, and the
//     OWNER-ONLY money shaping — a non-owner's row carries
//     neither unit_cost nor total_cost.
//   - Migration 071 carries the spill_entries table.
//   - The wiring: the router is registered and plan-gated;
//     the bar switch governs (off = no read, no record,
//     refused with the bar family's off wording); recording
//     writes ONE 'write_off' movement through the funnel
//     and a costed waste_entries row with reason 'spill' /
//     'breakage' (loss the waste log's way — no second
//     depletion path); the shelf door is barOnly beside
//     bar counting; the Studio spill print exists
//     (preview = print) carrying the log's full shape;
//     the 4 new server wordings are keyed in apiErrors.
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
  cleanSpillEntry,
  pourCost,
  publicSpill,
  spillTotals,
} from '../../server/spillLogCore.js';
import { spillTotals as clientSpillTotals } from '../../src/lib/spillLog.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'plansLib.businessIncludes.spillLog',
  'nav.spillLog',
  'restaurant.doorSpillLog',
  'ops.waste.reason.spill',
  'ops.waste.reason.breakage',
  'spill.title',
  'spill.subtitle',
  'spill.product',
  'spill.quantity',
  'spill.location',
  'spill.kindSpill',
  'spill.kindBreakage',
  'spill.reason',
  'spill.recordButton',
  'spill.recordedToast',
  'spill.emptyTitle',
  'spill.emptyBody',
  'spill.colWhen',
  'spill.colItem',
  'spill.colQuantity',
  'spill.colReason',
  'spill.colBy',
  'spill.colCost',
  'spill.totalLabel',
  'spill.printButton',
  'spill.lossNote',
  'spill.saveFailed',
  'training.lessons.owner-spill-log.title',
  'training.lessons.owner-spill-log.step1',
  'training.lessons.owner-spill-log.step2',
  'training.lessons.owner-spill-log.step3',
  'training.lessons.owner-spill-log.step4',
  'training.lessons.owner-spill-log.step5',
  'apiErrors.spillLog.productNeeded',
  'apiErrors.spillLog.quantityNeeded',
  'apiErrors.spillLog.reasonNeeded',
  'apiErrors.spillLog.invalid',
];

test('the keyset is uniform at 6976 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 6976, code);
});

test('all 37 spill keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 37);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('no spill value is byte-identical to English outside the English sets (zero debt)', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    if (code.startsWith('en')) continue;
    for (const key of NEW_KEYS) assert.notEqual(table[key], en[key], `${code} ${key} is untranslated`);
  }
});

test('English variants and base-riding locales carry the same spill strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('the toast placeholder survives translation', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    assert.ok(table['spill.recordedToast'].includes('{product}'), `${code} recordedToast`);
  }
});

test('plan presentation: the spill line is Business-only on Plans, Welcome and the matrix', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.spillLog').length - 1, 3, 'Plans Business, Welcome Business and the matrix');
  const line = en['plansLib.businessIncludes.spillLog'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the spill line');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Plans Essentials never sees it');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the spill line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never sees it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

test('the catalogs agree at 137 lessons and the spill lesson rides the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 138);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-spill-log');
  assert.ok(lesson, 'spill lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant', 'the lesson is feature-gated like the corner');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-spill-log.title'], 'The spill & breakage log');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 115);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 23);
});

test('cleanSpillEntry: item, quantity greater than zero, and the reason is the record', () => {
  const ok = cleanSpillEntry({ product_id: 'p1', quantity: 0.5, kind: 'breakage', reason: 'Knocked off the bar', location_id: 'l1' });
  assert.deepEqual(ok, { product_id: 'p1', quantity: 0.5, kind: 'breakage', reason: 'Knocked off the bar', location_id: 'l1' });
  const spill = cleanSpillEntry({ product_id: 'p1', quantity: 2, reason: 'Overpoured' });
  assert.equal(spill.kind, 'spill', 'an unknown kind falls back to spill');
  assert.throws(() => cleanSpillEntry({ quantity: 1, reason: 'x' }), /spilled or broken/);
  assert.throws(() => cleanSpillEntry({ product_id: 'p1', quantity: 0, reason: 'x' }), /greater than zero/);
  assert.throws(() => cleanSpillEntry({ product_id: 'p1', quantity: 1, reason: '  ' }), /needs its reason/);
});

test('pourCost: quantity × unit cost, never invented', () => {
  assert.equal(pourCost(2, 12.5), 25);
  assert.equal(pourCost(0.5, 30), 15);
  assert.equal(pourCost(3, null), null);
  assert.equal(pourCost(3, ''), null);
});

test('publicSpill: pour cost is owner-only — non-owner rows carry no money keys at all', () => {
  const row = { id: 's1', product_name: 'Gin', quantity: '2', unit_cost: '10', total_cost: 999 };
  const owner = publicSpill(row, true);
  assert.equal(owner.quantity, 2);
  assert.equal(owner.unit_cost, 10);
  assert.equal(owner.total_cost, 20, 'the owner total is computed, never a stored claim');
  const staff = publicSpill(row, false);
  assert.ok(!('unit_cost' in staff), 'no unit cost for non-owners');
  assert.ok(!('total_cost' in staff), 'no pour cost for non-owners');
  assert.equal(spillTotals([owner]).totalCost, 20);
  assert.equal(spillTotals([staff]).showMoney, false);
  assert.equal(spillTotals([staff]).totalCost, null, 'a non-owner total is null, never zero');
  assert.deepEqual(clientSpillTotals([owner]), spillTotals([owner]), 'client and server totals agree');
});

test('migration 071 carries the spill entries table', () => {
  const sql = read('migrations/071_spill_log.sql');
  for (const needle of [
    'CREATE TABLE IF NOT EXISTS spill_entries',
    'kind TEXT NOT NULL DEFAULT \'spill\'',
    'reason TEXT NOT NULL DEFAULT \'\'',
    'unit_cost NUMERIC',
    'movement_id TEXT',
    'waste_entry_id TEXT',
    'created_by TEXT',
  ]) {
    assert.ok(sql.includes(needle), needle);
  }
});

test('the 4 new server wordings are keyed in the apiErrors registry', () => {
  const pairs = [
    ['Choose the item that was spilled or broken.', 'apiErrors.spillLog.productNeeded'],
    ['Enter how much was spilled or broken — a quantity greater than zero.', 'apiErrors.spillLog.quantityNeeded'],
    ['A spill or breakage needs its reason — what happened.', 'apiErrors.spillLog.reasonNeeded'],
    ['Check the spill entry and try again.', 'apiErrors.spillLog.invalid'],
  ];
  assert.equal(pairs.length, 4);
  for (const [message, key] of pairs) assert.equal(API_ERROR_MESSAGE_KEYS[message], key, message);
});

test('wiring: plan gate, the bar switch governs, one write-off movement and the waste flow', () => {
  const routes = read('server/spillLogRoutes.js');
  const app = read('server/app.js');
  assert.ok(app.includes('createSpillLogRouter'), 'the router is registered');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"), 'every door sits behind the restaurant plan gate');
  assert.ok(routes.includes('bar_counting_enabled'), 'the log reads the bar family owner switch');
  assert.ok(routes.includes('BAR_OFF_MESSAGE'), 'while the switch is off, recording is refused with the bar family off wording');
  assert.ok(routes.includes('recordMovementTx'), 'the stock-out rides the existing movement funnel — no second depletion path');
  assert.ok(routes.includes("type: 'write_off'"), 'the movement is a write-off, the waste log way');
  assert.ok(routes.includes("error?.code !== 'insufficient_stock'"), 'the waste clamp: only insufficient stock is caught, the entry still records');
  assert.ok(routes.includes('INSERT INTO waste_entries'), 'a costed row lands in the waste log');
  assert.ok(routes.includes("'breakage' : 'spill'") || routes.includes('"breakage"'), 'the waste reason follows the entry kind');
  assert.ok(routes.includes('INSERT INTO spill_entries'), 'the entry itself is its own record');
  assert.ok(routes.includes('publicSpill(row, access.isOwner)'), 'reads are shaped owner-only for money');
});

test('wiring: the page, the barOnly shelf door and the Studio print exist', () => {
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/restaurant/spill-log"'), 'the route exists behind the restaurant PlanRedirect');
  const page = read('src/pages/RestaurantSpillLog.jsx');
  assert.ok(page.includes('SpillLogDoc'), 'the log prints as a Studio document');
  assert.ok(page.includes('barCounting.offTitle'), 'the off state is the bar family off state');
  const doc = read('src/components/print/SpillLogDoc.jsx');
  assert.ok(doc.includes('export default function SpillLogDoc'), 'the Studio spill sheet exists (preview = print)');
  for (const key of ['spill.colWhen', 'spill.colItem', 'spill.colQuantity', 'spill.colReason', 'spill.colBy']) {
    assert.ok(doc.includes(`t('${key}')`), `the print carries ${key} — the log's full shape`);
  }
  const shelves = read('src/lib/restaurantShelves.js');
  assert.ok(
    shelves.includes("door('/restaurant/spill-log', 'nav.spillLog', 'restaurant.doorSpillLog', Wine, { barOnly: true })"),
    'the Stock & Ordering shelf is its home, barOnly beside bar counting',
  );
  const barAt = shelves.indexOf("door('/restaurant/bar-counting'");
  const spillAt = shelves.indexOf("door('/restaurant/spill-log'");
  assert.ok(barAt > 0 && spillAt > barAt, 'the spill door sits beside bar counting');
});
