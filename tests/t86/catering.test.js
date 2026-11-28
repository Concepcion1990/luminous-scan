/**
 * T86 — CATERING & PRIVATE EVENTS, THE SIMPLE VERSION
 * (Nov 26, 2026; plan release 375, Gap 11).
 *
 *  - BUSINESS-ONLY, Restaurant Corner, Floor & Guests
 *    shelf: an event book — date, party size, a menu picked
 *    from the business's own recipes/dishes, deposit taken,
 *    balance due.
 *  - A one-page event sheet (BEO) from the Document Style
 *    Studio that the kitchen and floor work from — the
 *    staff copy hides the money (deposits/balances are
 *    owner-only money, stripped server-side for every
 *    non-owner reader and never printed on the staff copy).
 *  - The event's food pulls into prep and production: the
 *    prep math below rides the 359/361 recipe expansion, so
 *    a big party doesn't ambush the walk-in.
 *  - No contracts, no e-signatures — the simple version
 *    only, deliberately (pinned: no new string names one).
 *
 *  TEST + RETEST — by name below: a 25-serving pasta +
 *  12-serving salad event pulls 3 makes of each (servings
 *  divided by yield, rounded up), flour 6, cheese 3,
 *  butter 12 through the sauce sub-recipe, tomatoes 12 —
 *  then the same event cancelled pulls nothing at all, and
 *  an exactly-one-yield booking pulls exactly one make.
 *  The owner's copy of the event carries a $300 balance on
 *  a $500 total with $200 taken; a non-owner's copy carries
 *  no money keys at all.
 *
 *  Keyset: 6455 + 51 = 6506 ×52, uniform. Training
 *  catalog: 127 + 1 = 128 (owner-catering-events,
 *  RESTAURANT heading, Business-only). Migration 064 (one
 *  table). Registry: 551 + 2 = 553 wordings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { PLANS, WELCOME_OPTIONS, COMPARISON_ROWS } from '../../src/lib/plans.js';
import { API_ERROR_MESSAGE_KEYS } from '../../src/lib/apiErrors.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';
import {
  EVENT_MESSAGE,
  OWNER_MESSAGE,
  cleanEvent,
  eventPrep,
  shapeEvent,
} from '../../server/cateringCore.js';
import { SHELVES } from '../../src/lib/restaurantShelves.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.cateringEvents', 'plansLib.businessIncludes.cateringEvents', 'restaurant.doorCateringEvents',
  'catering.title', 'catering.subtitle', 'catering.ownerOnlyNote', 'catering.bookTitle',
  'catering.newEvent', 'catering.editEvent', 'catering.nameLabel', 'catering.dateLabel',
  'catering.timeLabel', 'catering.partySizeLabel', 'catering.contactLabel', 'catering.phoneLabel',
  'catering.notesLabel', 'catering.statusLabel', 'catering.statusBooked', 'catering.statusDone',
  'catering.statusCancelled', 'catering.menuTitle', 'catering.addDish', 'catering.servingsLabel',
  'catering.removeDish', 'catering.noDishes', 'catering.totalLabel', 'catering.depositLabel',
  'catering.balanceLabel', 'catering.saveEvent', 'catering.saved', 'catering.saveFailed',
  'catering.deleteEvent', 'catering.emptyTitle', 'catering.emptyBody', 'catering.prepTitle',
  'catering.prepEmpty', 'catering.prepDishLine', 'catering.printOwnerSheet', 'catering.printStaffSheet',
  'catering.docTitle', 'catering.staffCopyNote', 'catering.docPrepTitle', 'catering.guestsLine',
  'apiErrors.cateringOwner', 'apiErrors.cateringInvalid',
  'training.lessons.owner-catering-events.title', 'training.lessons.owner-catering-events.step1',
  'training.lessons.owner-catering-events.step2', 'training.lessons.owner-catering-events.step3',
  'training.lessons.owner-catering-events.step4', 'training.lessons.owner-catering-events.step5',
];

/* ------------------------------------------------ i18n gate */

test('keyset stands at 6506 in all 52 locales, uniform', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  const enKeys = Object.keys(LOCALES.en).sort();
  assert.equal(enKeys.length, 6678);
  for (const code of codes) {
    assert.equal(Object.keys(LOCALES[code]).length, 6678, `${code} keyset`);
    assert.deepEqual(Object.keys(LOCALES[code]).sort(), enKeys, `${code} keyset differs from en`);
  }
});

test('the 51 new keys exist in all 52 locales and are not the key itself', () => {
  assert.equal(NEW_KEYS.length, 51);
  assert.equal(new Set(NEW_KEYS).size, 51);
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
  for (const key of NEW_KEYS) assert.equal(LOCALES['pa-Arab'][key], LOCALES['ur'][key], `pa-Arab ${key}`);
});

test('placeholders survive translation in every locale', () => {
  for (const [code, strings] of Object.entries(LOCALES)) {
    for (const ph of ['{count}', '{date}']) assert.ok(strings['catering.guestsLine'].includes(ph), `${code} guestsLine ${ph}`);
    for (const ph of ['{name}', '{makes}', '{servings}']) assert.ok(strings['catering.prepDishLine'].includes(ph), `${code} prepDishLine ${ph}`);
  }
});

test('the two new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(API_ERROR_MESSAGE_KEYS[OWNER_MESSAGE], 'apiErrors.cateringOwner');
  assert.equal(API_ERROR_MESSAGE_KEYS[EVENT_MESSAGE], 'apiErrors.cateringInvalid');
  assert.equal(en['apiErrors.cateringOwner'], OWNER_MESSAGE);
  assert.equal(en['apiErrors.cateringInvalid'], EVENT_MESSAGE);
});

test('the simple version only: no contract or e-signature copy anywhere in the feature', () => {
  for (const key of NEW_KEYS) {
    const text = en[key].toLowerCase();
    for (const banned of ['contract', 'e-signature', 'esignature', 'sign here', 'signature']) {
      assert.ok(!text.includes(banned), `${key} names the large version: ${banned}`);
    }
  }
});

/* ------------------------------------------- plan presentation */

test('plan presentation: the catering line is Business-only, in Plans, Welcome and the matrix', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.cateringEvents').length - 1, 3, 'line in Plans Business, Welcome Business and the matrix only');
  const line = en['plansLib.businessIncludes.cateringEvents'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the catering line');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the catering line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials never carries the catering line');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never carries it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

/* ------------------------------------------------ training */

test('training catalogs agree at 128: the catering lesson sits under the RESTAURANT heading, Business-only', () => {
  assert.equal(CLIENT_LESSONS.length, 131);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-catering-events');
  assert.ok(lesson, 'catering lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.steps, 5);
  assert.equal(lesson.feature, 'restaurant');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 114);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 17);
});

/* ------------------------------------------- the event book */

const EVENT_INPUT = {
  name: 'Ana’s graduation party',
  event_date: '2026-12-05',
  event_time: '18:00',
  party_size: 30,
  contact_name: 'Ana',
  contact_phone: '555-0100',
  status: 'booked',
  notes: 'Nut allergy at table two.',
  menu: [
    { recipe_id: 'pasta', servings: 25 },
    { recipe_id: 'salad', servings: 12 },
    { recipe_id: '', servings: 5 },
    { recipe_id: 'pasta', servings: 0 },
  ],
  event_total: 500,
  deposit: 200,
};

test('cleanEvent keeps the book shape and drops menu lines with no dish or no servings', () => {
  const clean = cleanEvent(EVENT_INPUT);
  assert.equal(clean.name, 'Ana’s graduation party');
  assert.equal(clean.party_size, 30);
  assert.deepEqual(clean.menu, [
    { recipe_id: 'pasta', servings: 25 },
    { recipe_id: 'salad', servings: 12 },
  ]);
  assert.throws(() => cleanEvent({ ...EVENT_INPUT, event_date: 'Dec 5' }), (e) => e.message === EVENT_MESSAGE);
  assert.throws(() => cleanEvent({ ...EVENT_INPUT, party_size: 0 }), (e) => e.message === EVENT_MESSAGE);
  assert.throws(() => cleanEvent({ ...EVENT_INPUT, deposit: -1 }), (e) => e.message === EVENT_MESSAGE);
});

test('TEST: the owner copy carries the balance due; RETEST: a non-owner copy carries no money keys at all', () => {
  const row = { id: 'e1', ...cleanEvent(EVENT_INPUT), menu: JSON.stringify(cleanEvent(EVENT_INPUT).menu) };
  const recipesById = new Map([['pasta', { id: 'pasta', name: 'Pasta' }], ['salad', { id: 'salad', name: 'Salad' }]]);
  const owner = shapeEvent(row, recipesById, { isOwner: true });
  assert.equal(owner.event_total, 500);
  assert.equal(owner.deposit, 200);
  assert.equal(owner.balance_due, 300, 'the balance is the total minus the deposit taken');
  assert.equal(owner.menu[0].name, 'Pasta', 'menu lines gain their dish names');
  const staff = shapeEvent(row, recipesById, { isOwner: false });
  for (const key of ['event_total', 'deposit', 'balance_due']) {
    assert.ok(!(key in staff), `a non-owner copy must not carry ${key}`);
  }
  assert.equal(staff.party_size, 30);
  assert.equal(staff.menu.length, 2);
});

/* ------------------------------------------- the prep pull */

const PRODUCTS = [
  { id: 'flour', name: 'Flour', unit: 'kg' },
  { id: 'cheese', name: 'Cheese', unit: 'kg' },
  { id: 'butter', name: 'Butter', unit: 'kg' },
  { id: 'tomato', name: 'Tomato', unit: 'each' },
];
const RECIPES = [
  {
    id: 'sauce', name: 'Sauce', yield_qty: 4,
    lines: JSON.stringify([{ kind: 'product', product_id: 'butter', quantity: 2 }]),
  },
  {
    id: 'pasta', name: 'Pasta', yield_qty: 10,
    lines: JSON.stringify([
      { kind: 'product', product_id: 'flour', quantity: 2 },
      { kind: 'product', product_id: 'cheese', quantity: 1 },
      { kind: 'recipe', recipe_id: 'sauce', quantity: 8 },
    ]),
  },
  {
    id: 'salad', name: 'Salad', yield_qty: 5,
    lines: JSON.stringify([{ kind: 'product', product_id: 'tomato', quantity: 4 }]),
  },
];
const BOOKED = {
  status: 'booked',
  menu: JSON.stringify([
    { recipe_id: 'pasta', servings: 25 },
    { recipe_id: 'salad', servings: 12 },
  ]),
};

test('TEST: a 25-serving pasta and 12-serving salad pull 3 makes of each, sub-recipe rolled up', () => {
  const prep = eventPrep(RECIPES, PRODUCTS, BOOKED);
  const pasta = prep.dishes.find((d) => d.recipe_id === 'pasta');
  const salad = prep.dishes.find((d) => d.recipe_id === 'salad');
  assert.equal(pasta.makes, 3, '25 servings over a yield of 10 rounds up to 3 makes');
  assert.equal(salad.makes, 3, '12 servings over a yield of 5 rounds up to 3 makes');
  const total = Object.fromEntries(prep.totals.map((row) => [row.product_id, row.quantity]));
  assert.equal(total.flour, 6, '2 kg per make x 3 makes');
  assert.equal(total.cheese, 3);
  assert.equal(total.butter, 12, 'the sauce sub-recipe: 8 units over a yield of 4 = 2 makes, 2 kg butter each, x 3 pasta makes');
  assert.equal(total.tomato, 12, '4 per make x 3 makes');
});

test('RETEST: the same event cancelled pulls nothing, and an exactly-one-yield booking pulls exactly one make', () => {
  const cancelled = eventPrep(RECIPES, PRODUCTS, { ...BOOKED, status: 'cancelled' });
  assert.deepEqual(cancelled.dishes, []);
  assert.deepEqual(cancelled.totals, []);
  const exact = eventPrep(RECIPES, PRODUCTS, {
    status: 'booked',
    menu: JSON.stringify([{ recipe_id: 'pasta', servings: 10 }]),
  });
  assert.equal(exact.dishes[0].makes, 1);
  assert.equal(exact.totals.find((row) => row.product_id === 'flour').quantity, 2);
});

/* ------------------------------------------- wiring pins */

test('migration 064, the wipe sweep, the router mount and the shelf are in place', () => {
  const migration = read('migrations/064_catering_events.sql');
  assert.ok(migration.includes('catering_events'));
  assert.ok(!/REFERENCES/i.test(migration), 'no foreign key (the migration-017 lesson)');
  assert.ok(read('server/billing.js').includes('DELETE FROM catering_events WHERE business_id = $1'), 'wipe sweep');
  assert.ok(read('server/app.js').includes('createCateringRouter'), 'router mounted');
  const routes = read('server/cateringRoutes.js');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"), 'every door sits behind the restaurant plan gate');
  assert.ok(routes.includes('OWNER_MESSAGE'), 'the book is kept by the owner or a manager alone');
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/restaurant/catering"'));
  assert.ok(app.includes('<PlanRedirect feature="restaurant">'), 'the page route rides the plan redirect');
  const floor = SHELVES.find((s) => s.id === 'floor');
  assert.ok(floor.doors.some((d) => d.to === '/restaurant/catering' && !d.crossLink), 'Floor & Guests is the home shelf (a primary door)');
  assert.ok(read('src/pages/RestaurantPrep.jsx').includes('fetchUpcomingEventPrep'), 'the event pull shows up where prep is planned');
});

test('the printed paper is a Studio document, and the staff copy hides the money (preview = print)', () => {
  const doc = read('src/components/print/EventSheetDoc.jsx');
  assert.ok(doc.includes('DocFrame') && doc.includes('docRootStyle'), 'Studio frame + style');
  assert.ok(doc.includes("t('catering.docTitle')"), 'the paper rides the Studio document');
  assert.ok(doc.includes('staffCopy'), 'the document has a staff copy');
  assert.ok(doc.includes('!staffCopy && event.event_total !== undefined'), 'money prints only on a non-staff copy that carries money');
  assert.ok(read('src/pages/RestaurantCatering.jsx').includes('EventSheetDoc'), 'the page shows the document it prints');
  assert.ok(read('src/components/print/PrepSheetDoc.jsx').includes('eventPrep'), 'the printed prep sheet carries the event pull too');
});
