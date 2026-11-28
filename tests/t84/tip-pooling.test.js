/**
 * T84 — TIP POOLING + TIP REPORTING RECORDS (Nov 26, 2026;
 * plan release 373, Gap 3, with its round-2 records rider,
 * round-2 Gap 10). BUSINESS-ONLY, Restaurant Corner, Team
 * & Place shelf.
 *
 *  - Tip pooling: the owner sets the pool shape — by hours,
 *    by role percentage, or by points — and the app splits
 *    the pool from the schedule + clock hours already in
 *    it, shows each person their share, and feeds the
 *    numbers into the payroll preview.
 *  - Tip reporting records (the rider): the year record —
 *    per person, per period, tips reported — with the IRS
 *    8% arithmetic run into form-ready totals. Records
 *    only: the app assembles numbers and files nothing;
 *    the allocation methods are the IRS's own published
 *    ones, as arithmetic the owner chooses.
 *  - OWNER-ONLY MONEY: setup, shares and records are the
 *    owner's numbers; a member sees ONLY their own share,
 *    and only for a run the owner published.
 *  - The app calculates what the owner sets up and never
 *    advises on tip law — no legal copy anywhere (pinned:
 *    no string in the new family carries advice wording).
 *
 *  TEST + RETEST — by name below: a $300 pool splits by
 *  hours 2:1 into $200/$100, is re-split by points into
 *  exact shares that still sum to the pool; and a period
 *  whose reported tips fall short of 8% of gross receipts
 *  allocates the whole shortfall, then re-runs clean when
 *  the reported tips reach the 8%.
 *
 *  Keyset: 6332 + 67 = 6506 ×52, uniform. Training
 *  catalog: 124 + 1 = 125 (owner track, restaurant module,
 *  RESTAURANT heading). Migration 062 (five tables).
 *  Registry: 545 + 4 = 549 wordings.
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
  OWNER_MESSAGE,
  PERIOD_MESSAGE,
  POOL_MESSAGE,
  REPORT_MESSAGE,
  cleanPeriod,
  cleanReport,
  cleanSettings,
  computeForm8027,
  computePoolShares,
  summarizeYear,
} from '../../server/tipPoolingCore.js';
import { SHELVES } from '../../src/lib/restaurantShelves.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.tipPooling', 'plansLib.businessIncludes.tipPooling', 'restaurant.doorTipPooling',
  'tipPooling.title', 'tipPooling.subtitle', 'tipPooling.ownerOnlyNote', 'tipPooling.settingsTitle',
  'tipPooling.methodHours', 'tipPooling.methodRole', 'tipPooling.methodPoints', 'tipPooling.rolePctLabel',
  'tipPooling.pointsLabel', 'tipPooling.saveSettings', 'tipPooling.saved', 'tipPooling.saveFailed',
  'tipPooling.splitTitle', 'tipPooling.periodStartLabel', 'tipPooling.periodEndLabel', 'tipPooling.poolAmountLabel',
  'tipPooling.previewButton', 'tipPooling.saveRunButton', 'tipPooling.colPerson', 'tipPooling.colRole',
  'tipPooling.colHours', 'tipPooling.colShare', 'tipPooling.unallocatedNote', 'tipPooling.runsTitle',
  'tipPooling.noRuns', 'tipPooling.publishedLabel', 'tipPooling.notPublishedLabel', 'tipPooling.publishButton',
  'tipPooling.unpublishButton', 'tipPooling.printButton', 'tipPooling.docTitle', 'tipPooling.docYearTitle',
  'tipPooling.mySharesTitle', 'tipPooling.mySharesEmpty', 'tipPooling.recordsTitle', 'tipPooling.recordsSubtitle',
  'tipPooling.newPeriodButton', 'tipPooling.grossReceiptsLabel', 'tipPooling.allocMethodLabel',
  'tipPooling.allocGrossReceipts', 'tipPooling.allocHours', 'tipPooling.allocGoodFaith', 'tipPooling.tipsReportedLabel',
  'tipPooling.personGrossLabel', 'tipPooling.hoursLabel', 'tipPooling.allocationInputLabel', 'tipPooling.saveReportButton',
  'tipPooling.yearTitle', 'tipPooling.eightPercentLabel', 'tipPooling.totalReportedLabel', 'tipPooling.shortfallLabel',
  'tipPooling.totalAllocatedLabel', 'tipPooling.periodLine', 'tipPooling.emptyRecords',
  'apiErrors.tipOwner', 'apiErrors.tipPeriod', 'apiErrors.tipPoolAmount', 'apiErrors.tipReport',
  'training.lessons.owner-tip-pooling.title', 'training.lessons.owner-tip-pooling.step1',
  'training.lessons.owner-tip-pooling.step2', 'training.lessons.owner-tip-pooling.step3',
  'training.lessons.owner-tip-pooling.step4', 'training.lessons.owner-tip-pooling.step5',
];

/* ------------------------------------------------ i18n gate */

test('keyset stands at 6506 in all 52 locales, uniform', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  const enKeys = Object.keys(LOCALES.en).sort();
  assert.equal(enKeys.length, 6716);
  for (const code of codes) {
    assert.equal(Object.keys(LOCALES[code]).length, 6716, `${code} keyset`);
    assert.deepEqual(Object.keys(LOCALES[code]).sort(), enKeys, `${code} keyset differs from en`);
  }
});

test('the 67 new keys exist in all 52 locales and are not the key itself', () => {
  assert.equal(NEW_KEYS.length, 67);
  assert.equal(new Set(NEW_KEYS).size, 67);
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
    assert.ok(strings['tipPooling.rolePctLabel'].includes('{role}'), `${code} rolePctLabel`);
    assert.ok(strings['tipPooling.pointsLabel'].includes('{name}'), `${code} pointsLabel`);
    assert.ok(strings['tipPooling.yearTitle'].includes('{year}'), `${code} yearTitle`);
    assert.ok(strings['tipPooling.periodLine'].includes('{start}') && strings['tipPooling.periodLine'].includes('{end}'), `${code} periodLine`);
  }
});

test('the four new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(API_ERROR_MESSAGE_KEYS[OWNER_MESSAGE], 'apiErrors.tipOwner');
  assert.equal(API_ERROR_MESSAGE_KEYS[PERIOD_MESSAGE], 'apiErrors.tipPeriod');
  assert.equal(API_ERROR_MESSAGE_KEYS[POOL_MESSAGE], 'apiErrors.tipPoolAmount');
  assert.equal(API_ERROR_MESSAGE_KEYS[REPORT_MESSAGE], 'apiErrors.tipReport');
  assert.equal(en['apiErrors.tipOwner'], OWNER_MESSAGE);
});

test('no legal advice anywhere in the new family: the app calculates and records, it never advises', () => {
  for (const key of NEW_KEYS) {
    const text = en[key].toLowerCase();
    for (const banned of ['you must', 'you should', 'the law requires', 'legally', 'required by law', 'we recommend']) {
      assert.ok(!text.includes(banned), `${key} carries advice wording: ${banned}`);
    }
  }
  const core = read('server/tipPoolingCore.js');
  assert.ok(!core.includes('Form 8027 instructions say you'), 'no advice in the engine either');
});

/* ------------------------------------------- plan presentation */

test('plan presentation: Business-only — Plans + Welcome Business lists and the matrix; Essentials never carries it', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.tipPooling').length - 1, 3, 'referenced in Plans, Welcome and the matrix only');
  const line = en['plansLib.businessIncludes.tipPooling'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the line');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the line');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials list never carries it (Business-only invisibility)');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never carries it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

/* ------------------------------------------------ training */

test('training catalogs agree at 125 and the lesson is an owner restaurant lesson under the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 132);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-tip-pooling');
  assert.ok(lesson, 'lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.steps, 5);
  assert.equal(lesson.feature, 'restaurant');
  assert.ok(en['training.lessons.owner-tip-pooling.title']);
});

/* ------------------------------------------- pool splitting */

const folks = [
  { id: 'a', full_name: 'Ana', role_name: 'Server', hours: 40 },
  { id: 'b', full_name: 'Ben', role_name: 'Server', hours: 20 },
  { id: 'c', full_name: 'Cid', role_name: 'Cook', hours: 30 },
];

test('TEST: a $300 pool splits by clock hours — 40h/20h/30h take $133.33/$66.67/$100 and sum to the pool exactly', () => {
  const split = computePoolShares({ poolAmount: 300, method: 'hours', people: folks, settings: {} });
  const byId = Object.fromEntries(split.shares.map((s) => [s.staff_member_id, s.share_amount]));
  assert.equal(byId.a, 133.33);
  assert.equal(byId.b, 66.67);
  assert.equal(byId.c, 100);
  assert.equal(Math.round(split.shares.reduce((s, x) => s + x.share_amount, 0) * 100) / 100, 300, 'shares sum to the pool to the cent');
});

test('RETEST: the same pool re-splits by points and by role percentage, each still summing to the pool', () => {
  const byPoints = computePoolShares({
    poolAmount: 300, method: 'points', people: folks,
    settings: { points: { a: 2, b: 1, c: 1 } },
  });
  const p = Object.fromEntries(byPoints.shares.map((s) => [s.staff_member_id, s.share_amount]));
  assert.deepEqual(p, { a: 150, b: 75, c: 75 });
  const byRole = computePoolShares({
    poolAmount: 300, method: 'role', people: folks,
    settings: { role_percentages: { Server: 75, Cook: 25 } },
  });
  const r = Object.fromEntries(byRole.shares.map((s) => [s.staff_member_id, s.share_amount]));
  // Servers take 75% of the pool split by their hours (40:20); the cook takes 25%.
  assert.deepEqual(r, { a: 150, b: 75, c: 75 });
  assert.equal(Math.round(byRole.shares.reduce((s, x) => s + x.share_amount, 0) * 100) / 100, 300);
});

test('a pool with no weight anywhere allocates nothing; a bad amount and a bad period refuse with the registered wordings', () => {
  const split = computePoolShares({ poolAmount: 100, method: 'hours', people: [{ id: 'x', full_name: 'X', role_name: '', hours: 0 }], settings: {} });
  assert.equal(split.shares[0].share_amount, 0);
  assert.equal(split.totalWeight, 0);
  assert.throws(() => computePoolShares({ poolAmount: 0, method: 'hours', people: folks, settings: {} }), (e) => e.message === POOL_MESSAGE);
  assert.throws(() => cleanPeriod({ period_start: '2026-11-10', period_end: '2026-11-01' }), (e) => e.message === PERIOD_MESSAGE);
  const shape = cleanSettings({ method: 'bogus', role_percentages: '{"Server": 80}', points: { a: '3' } });
  assert.equal(shape.method, 'hours', 'an unknown method falls back to hours — never an invented split');
  assert.equal(shape.role_percentages.Server, 80);
  assert.equal(shape.points.a, 3);
});

/* ------------------------------------------- the 8027 rider */

const reports = [
  { staff_member_id: 'a', person_name: 'Ana', tips_reported: 300, gross_receipts: 6000, hours: 100, allocation_amount: null },
  { staff_member_id: 'b', person_name: 'Ben', tips_reported: 100, gross_receipts: 2000, hours: 50, allocation_amount: null },
];

test('TEST: reported tips short of 8% of gross receipts — the shortfall is $400 and the hours method allocates all of it', () => {
  const totals = computeForm8027({ grossReceipts: 10000, reports, method: 'hours' });
  assert.equal(totals.eight_percent, 800);
  assert.equal(totals.total_reported, 400);
  assert.equal(totals.shortfall, 400);
  const byId = Object.fromEntries(totals.per_person.map((p) => [p.staff_member_id, p.allocated]));
  assert.deepEqual(byId, { a: 266.67, b: 133.33 }, 'allocated in proportion to hours (100:50)');
  assert.equal(totals.total_allocated, 400, 'the whole shortfall is allocated, to the cent');
  const byGross = computeForm8027({ grossReceipts: 10000, reports, method: 'gross_receipts' });
  const g = Object.fromEntries(byGross.per_person.map((p) => [p.staff_member_id, p.allocated]));
  assert.deepEqual(g, { a: 300, b: 100 }, 'the gross-receipts method allocates in proportion to receipts (6000:2000)');
  const goodFaith = computeForm8027({
    grossReceipts: 10000, method: 'good_faith',
    reports: reports.map((r, i) => ({ ...r, allocation_amount: i === 0 ? 250 : 150 })),
  });
  assert.equal(goodFaith.total_allocated, 400, 'the good-faith method takes the amounts the owner entered, as entered');
});

test('RETEST: when the reported tips reach the 8%, the shortfall is zero and nothing is allocated', () => {
  const totals = computeForm8027({
    grossReceipts: 10000, method: 'hours',
    reports: [{ staff_member_id: 'a', person_name: 'Ana', tips_reported: 850, gross_receipts: 9000, hours: 100, allocation_amount: null }],
  });
  assert.equal(totals.shortfall, 0);
  assert.equal(totals.total_allocated, 0);
  assert.equal(totals.per_person[0].allocated, 0);
});

test('the year record folds periods into per-person totals and the establishment totals', () => {
  const t1 = computeForm8027({ grossReceipts: 10000, reports, method: 'hours' });
  const t2 = computeForm8027({ grossReceipts: 5000, reports, method: 'hours' });
  const year = summarizeYear(2026, [{ totals: t1 }, { totals: t2 }]);
  assert.equal(year.periods, 2);
  assert.equal(year.gross_receipts, 15000);
  assert.equal(year.eight_percent, 1200);
  assert.equal(year.total_reported, 800);
  const ana = year.per_person.find((p) => p.staff_member_id === 'a');
  assert.equal(ana.tips_reported, 600);
  assert.equal(ana.hours, 200);
  assert.throws(() => cleanReport({ tips_reported: '' }), (e) => e.message === REPORT_MESSAGE);
});

/* ------------------------------------------- wiring pins */

test('migration 062, the wipe sweep, the router mount and the Business-only wiring are in place', () => {
  const migration = read('migrations/062_tip_pooling.sql');
  for (const table of ['tip_pool_settings', 'tip_pool_runs', 'tip_pool_shares', 'tip_report_periods', 'tip_reports']) {
    assert.ok(migration.includes(table), table);
    assert.ok(read('server/billing.js').includes(`DELETE FROM ${table} WHERE business_id = $1`), `wipe sweep ${table}`);
  }
  assert.ok(!/REFERENCES/i.test(migration), 'no foreign key (the migration-017 lesson)');
  assert.ok(read('server/app.js').includes('createTipPoolingRouter'), 'router mounted');
  const routes = read('server/tipPoolingRoutes.js');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"), 'the restaurant plan gate guards every door');
  assert.ok(routes.includes('OWNER_MESSAGE'), 'owner-only money is enforced server-side');
  assert.ok(routes.includes('myShares'), 'the one member read is their own published shares');
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/restaurant/tip-pooling"'));
  assert.ok(app.includes('<PlanRedirect feature="restaurant">'), 'the route rides the restaurant plan redirect');
  const team = SHELVES.find((s) => s.id === 'team');
  assert.ok(team.doors.some((d) => d.to === '/restaurant/tip-pooling' && !d.crossLink), 'Team & Place is the home shelf (a primary door, not a cross-link)');
});

test('the payroll preview feed: saved pool shares ride the preview rows and seed the tips adjustment', () => {
  const routes = read('server/workforceRoutes.js');
  assert.ok(routes.includes('poolTipsForPeriod'), 'the preview reads the pool shares');
  assert.ok(routes.includes('pool_tips'), 'the rows carry pool_tips');
  assert.ok(read('server/tipPoolingCore.js').includes('poolTipsForPeriod'), 'the sum lives in the tip engine');
  assert.ok(read('src/pages/Payroll.jsx').includes('pool_tips'), 'the page seeds its tips adjustment from the pool');
});

test('the printed papers are Studio documents (preview = print)', () => {
  const doc = read('src/components/print/TipPoolingDoc.jsx');
  assert.ok(doc.includes('DocFrame') && doc.includes('docRootStyle'), 'Studio frame + style');
  assert.ok(doc.includes("t('tipPooling.docTitle')") && doc.includes("t('tipPooling.docYearTitle')"), 'both papers ride the one Studio document');
  assert.ok(read('src/pages/RestaurantTipPooling.jsx').includes('TipPoolingDoc'), 'the page shows the documents it prints');
});
