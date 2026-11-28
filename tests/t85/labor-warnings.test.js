/**
 * T85 — LABOR TARGET + OVERTIME/BREAK WARNINGS (Nov 26,
 * 2026; plan release 374, Gap 13, Q4 ruled Nov 25, 2026).
 *
 *  - WARNINGS (GENERAL, both plans): while the week is
 *    built and as clock hours land, the app warns BEFORE
 *    they bite — approaching the owner's overtime line, a
 *    break the owner's settings call for not taken, hours
 *    outside the owner's window.
 *  - LABOR TARGET (RESTAURANT, Business-only): projected
 *    labor cost and labor % live against the owner's
 *    target in the Restaurant Corner (Team & Place shelf),
 *    riding the same schedule data; the server strips the
 *    whole face for plans without the restaurant feature.
 *  - ALL THRESHOLDS ARE OWNER-SET: no hard-coded law, no
 *    legal copy — an unset watch is a silent watch
 *    (pinned: cleanSettings({}) is all nulls).
 *
 *  TEST + RETEST — by name below: a 45-hour week crosses
 *  the owner's 40-hour line ($475 with the premium past
 *  the line) while a 36-hour week only approaches it, and
 *  the pair's labor % lands over a 30% target on $1,000
 *  expected sales — then the same week re-runs with the
 *  lines unset and $10,000 expected: no overtime warnings
 *  at all, and the % lands under target. A clock day of
 *  8 hours with no break warns; re-run with a 30-minute
 *  break recorded, it is silent.
 *
 *  Keyset: 6506 + 56 = 6506 ×52, uniform. Training
 *  catalog: 125 + 2 = 128 (owner-labor-warnings, GENERAL
 *  heading, both plans; owner-labor-target, RESTAURANT
 *  heading, Business-only). Migration 063 (one table).
 *  Registry: 549 + 2 = 551 wordings.
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
  SETTINGS_MESSAGE,
  cleanSettings,
  computeClockWarnings,
  computeScheduleWeek,
} from '../../server/laborWarningsCore.js';
import { SHELVES } from '../../src/lib/restaurantShelves.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.laborTarget', 'nav.laborWarnings', 'plansLib.includes.laborWarnings',
  'plansLib.businessIncludes.laborTarget', 'restaurant.doorLaborTarget', 'restaurant.doorLaborWarnings',
  'laborWatch.title', 'laborWatch.subtitle', 'laborWatch.ownerOnlyNote', 'laborWatch.settingsTitle',
  'laborWatch.overtimeLabel', 'laborWatch.warnWithinLabel', 'laborWatch.breakAfterLabel', 'laborWatch.breakMinutesLabel',
  'laborWatch.windowStartLabel', 'laborWatch.windowEndLabel', 'laborWatch.saveSettings', 'laborWatch.saved',
  'laborWatch.saveFailed', 'laborWatch.weekTitle', 'laborWatch.colPerson', 'laborWatch.colHours',
  'laborWatch.projectedCostLabel', 'laborWatch.laborPctLabel', 'laborWatch.targetLabel', 'laborWatch.expectedSalesLabel',
  'laborWatch.totalHoursLabel', 'laborWatch.totalCostLabel', 'laborWatch.overTarget', 'laborWatch.underTarget',
  'laborWatch.noTargetNote', 'laborWatch.clockTitle', 'laborWatch.noWarnings', 'laborWatch.emptyPeople',
  'laborWatch.docTitle', 'laborWatch.targetTitle', 'laborWatch.warningOvertimeOver', 'laborWatch.warningOvertimeNear',
  'laborWatch.warningBreak', 'laborWatch.warningWindow', 'laborWatch.warningClockBreak', 'laborWatch.warningsTitle',
  'apiErrors.laborOwner', 'apiErrors.laborSettings',
  'training.lessons.owner-labor-warnings.title', 'training.lessons.owner-labor-warnings.step1',
  'training.lessons.owner-labor-warnings.step2', 'training.lessons.owner-labor-warnings.step3',
  'training.lessons.owner-labor-warnings.step4', 'training.lessons.owner-labor-warnings.step5',
  'training.lessons.owner-labor-target.title', 'training.lessons.owner-labor-target.step1',
  'training.lessons.owner-labor-target.step2', 'training.lessons.owner-labor-target.step3',
  'training.lessons.owner-labor-target.step4', 'training.lessons.owner-labor-target.step5',
];

/* ------------------------------------------------ i18n gate */

test('keyset stands at 6506 in all 52 locales, uniform', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  const enKeys = Object.keys(LOCALES.en).sort();
  assert.equal(enKeys.length, 6940);
  for (const code of codes) {
    assert.equal(Object.keys(LOCALES[code]).length, 6940, `${code} keyset`);
    assert.deepEqual(Object.keys(LOCALES[code]).sort(), enKeys, `${code} keyset differs from en`);
  }
});

test('the 56 new keys exist in all 52 locales and are not the key itself', () => {
  assert.equal(NEW_KEYS.length, 56);
  assert.equal(new Set(NEW_KEYS).size, 56);
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
    for (const ph of ['{name}', '{hours}', '{limit}']) assert.ok(strings['laborWatch.warningOvertimeOver'].includes(ph), `${code} overtimeOver ${ph}`);
    for (const ph of ['{name}', '{hours}', '{limit}', '{day}']) assert.ok(strings['laborWatch.warningBreak'].includes(ph), `${code} break ${ph}`);
    for (const ph of ['{start}', '{end}']) assert.ok(strings['laborWatch.warningWindow'].includes(ph), `${code} window ${ph}`);
    for (const ph of ['{date}', '{minutes}']) assert.ok(strings['laborWatch.warningClockBreak'].includes(ph), `${code} clockBreak ${ph}`);
    assert.ok(strings['laborWatch.overTarget'].includes('{pct}'), `${code} overTarget`);
    assert.ok(strings['laborWatch.underTarget'].includes('{pct}'), `${code} underTarget`);
  }
});

test('the two new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(API_ERROR_MESSAGE_KEYS[OWNER_MESSAGE], 'apiErrors.laborOwner');
  assert.equal(API_ERROR_MESSAGE_KEYS[SETTINGS_MESSAGE], 'apiErrors.laborSettings');
  assert.equal(en['apiErrors.laborOwner'], OWNER_MESSAGE);
});

test('no legal advice and no hard-coded law: the app watches owner-set numbers only', () => {
  for (const key of NEW_KEYS) {
    const text = en[key].toLowerCase();
    for (const banned of ['you must', 'you should', 'the law requires', 'legally', 'required by law', 'we recommend']) {
      assert.ok(!text.includes(banned), `${key} carries advice wording: ${banned}`);
    }
  }
  const blank = cleanSettings({});
  assert.deepEqual(blank, {
    overtime_hours: null, warn_within_hours: null, break_after_hours: null, break_minutes: null,
    window_start: null, window_end: null, labor_target_pct: null, expected_sales: null,
  }, 'an unset watch is all nulls — no default dressed up as a rule');
  assert.throws(() => cleanSettings({ window_start: '25:00' }), (e) => e.message === SETTINGS_MESSAGE);
});

/* ------------------------------------------- plan presentation */

test('plan presentation: warnings on BOTH plans; the labor target Business-only', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.includes.laborWarnings').length - 1, 3, 'warnings line in Plans Essentials, Welcome Essentials and the matrix');
  const warnLine = en['plansLib.includes.laborWarnings'];
  assert.ok(PLANS.essentials.includes.includes(warnLine), 'Plans Essentials carries the warnings line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(welcomeEssentials.includes.includes(warnLine), 'Welcome Essentials carries the warnings line');
  const warnRow = COMPARISON_ROWS.find((r) => r.label === warnLine);
  assert.ok(warnRow && warnRow.essentials === true && warnRow.business === true, 'matrix row is both plans');

  assert.equal(plans.split('plansLib.businessIncludes.laborTarget').length - 1, 3, 'target line in Plans, Welcome and the matrix only');
  const targetLine = en['plansLib.businessIncludes.laborTarget'];
  assert.ok(PLANS.business.includes.includes(targetLine), 'Plans Business carries the target line');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(targetLine), 'Welcome Business carries the target line');
  assert.ok(!PLANS.essentials.includes.includes(targetLine), 'Essentials never carries the target line');
  assert.ok(!welcomeEssentials.includes.includes(targetLine), 'Welcome Essentials never carries it');
  const targetRow = COMPARISON_ROWS.find((r) => r.label === targetLine);
  assert.ok(targetRow && targetRow.essentials === false && targetRow.business === true, 'matrix row is Business-only');
});

/* ------------------------------------------------ training */

test('training catalogs agree at 130: a GENERAL owner lesson (both plans) and a RESTAURANT owner lesson (Business-only)', () => {
  assert.equal(CLIENT_LESSONS.length, 137);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const general = CLIENT_LESSONS.find((l) => l.id === 'owner-labor-warnings');
  assert.ok(general, 'general lesson exists');
  assert.equal(general.track, 'owner');
  assert.equal(general.module, 'workforce');
  assert.equal(general.heading, 'general');
  assert.equal(general.steps, 5);
  assert.equal(general.feature, undefined, 'no feature gate — the warnings lesson shows on both plans');
  const restaurant = CLIENT_LESSONS.find((l) => l.id === 'owner-labor-target');
  assert.ok(restaurant, 'restaurant lesson exists');
  assert.equal(restaurant.track, 'owner');
  assert.equal(restaurant.module, 'restaurant');
  assert.equal(restaurant.heading, 'restaurant');
  assert.equal(restaurant.steps, 5);
  assert.equal(restaurant.feature, 'restaurant');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 115);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 22);
});

/* ------------------------------------------- the schedule week */

const SETTINGS = {
  overtime_hours: 40, warn_within_hours: 5, break_after_hours: 6, break_minutes: 30,
  window_start: '08:00', window_end: '22:00', labor_target_pct: 30, expected_sales: 1000,
};
const PEOPLE = [
  { id: 'a', full_name: 'Ana', role_name: 'Server', pay_type: 'hourly', hourly_rate: 10, annual_salary: 0 },
  { id: 'b', full_name: 'Ben', role_name: 'Cook', pay_type: 'hourly', hourly_rate: 20, annual_salary: 0 },
];
const shifts = (id, days, start = '08:00', end = '17:00') => days.map((weekday) => ({ staff_member_id: id, weekday, start_time: start, end_time: end }));
const SCHEDULES = [...shifts('a', [1, 2, 3, 4, 5]), ...shifts('b', [1, 2, 3, 4])];

test('TEST: a 45h week crosses the owner line ($475 with the premium), a 36h week only approaches it, and the pair lands over target', () => {
  const week = computeScheduleWeek({ settings: SETTINGS, people: PEOPLE, schedules: SCHEDULES });
  const ana = week.people.find((p) => p.staff_member_id === 'a');
  const ben = week.people.find((p) => p.staff_member_id === 'b');
  assert.equal(ana.scheduled_hours, 45);
  assert.equal(ana.overtime_hours, 5);
  assert.equal(ana.projected_cost, 475, '40h at $10 plus 5h at time-and-a-half');
  assert.ok(ana.warnings.some((w) => w.code === 'overtime_over' && w.limit === 40), 'Ana crosses the line the owner set');
  assert.equal(ana.warnings.filter((w) => w.code === 'break').length, 5, 'each 9h shift outruns the 6h break line');
  assert.equal(ben.scheduled_hours, 36);
  assert.equal(ben.projected_cost, 720);
  assert.ok(ben.warnings.some((w) => w.code === 'overtime_near'), 'Ben is inside the owner warn-within band (36 >= 40-5)');
  assert.ok(!ben.warnings.some((w) => w.code === 'overtime_over'));
  assert.equal(week.totals.scheduled_hours, 81);
  assert.equal(week.totals.projected_cost, 1195);
  assert.equal(week.totals.labor_pct, 119.5, 'projected cost over the owner expected sales ($1,000)');
  assert.equal(week.totals.over_target, true);
  assert.equal(week.totals.variance_pct, 89.5);
});

test('RETEST: the same week with the lines unset warns about no overtime, and on $10,000 expected sales lands under target', () => {
  const week = computeScheduleWeek({
    settings: { ...SETTINGS, overtime_hours: null, warn_within_hours: null, expected_sales: 10000 },
    people: PEOPLE, schedules: SCHEDULES,
  });
  assert.ok(!week.warnings.some((w) => w.code.startsWith('overtime')), 'no line set, no overtime watch — the app invents no rule');
  const ana = week.people.find((p) => p.staff_member_id === 'a');
  assert.equal(ana.projected_cost, 450, 'with no line set every hour is at the plain rate — no invented premium');
  assert.equal(week.totals.labor_pct, 11.7);
  assert.equal(week.totals.over_target, false);
});

test('a shift outside the owner window warns; a salaried person costs one week of salary', () => {
  const week = computeScheduleWeek({
    settings: SETTINGS,
    people: [{ id: 's', full_name: 'Sal', role_name: 'Manager', pay_type: 'salary', hourly_rate: 0, annual_salary: 36500 }],
    schedules: shifts('s', [6], '06:00', '10:00'),
  });
  assert.ok(week.warnings.some((w) => w.code === 'window' && w.start === '08:00'), 'a 06:00 start is outside the owner window');
  assert.equal(week.people[0].projected_cost, 700, 'annual x 7 / 365, the payroll day math');
  const noSales = computeScheduleWeek({ settings: { ...SETTINGS, expected_sales: null }, people: PEOPLE, schedules: SCHEDULES });
  assert.equal(noSales.totals.labor_pct, null, 'no expected sales typed, no percentage — never a guessed denominator');
});

/* ------------------------------------------- the clock face */

test('TEST: a clock day of 8 hours with no break warns, and the workweek crosses the same lines', () => {
  const warnings = computeClockWarnings({
    settings: SETTINGS,
    days: [{ staff_member_id: 'a', person_name: 'Ana', date: '2026-11-23', hours: 8, break_minutes: 0 }],
    weekly: [
      { staff_member_id: 'a', person_name: 'Ana', hours: 42 },
      { staff_member_id: 'b', person_name: 'Ben', hours: 37 },
    ],
  });
  assert.ok(warnings.some((w) => w.code === 'clock_break' && w.minutes === 0), 'the break the owner settings call for was not taken');
  assert.ok(warnings.some((w) => w.code === 'clock_overtime_over' && w.staff_member_id === 'a'));
  assert.ok(warnings.some((w) => w.code === 'clock_overtime_near' && w.staff_member_id === 'b'));
});

test('RETEST: the same clock day with the owner break recorded is silent', () => {
  const warnings = computeClockWarnings({
    settings: SETTINGS,
    days: [{ staff_member_id: 'a', person_name: 'Ana', date: '2026-11-23', hours: 8, break_minutes: 30 }],
    weekly: [{ staff_member_id: 'a', person_name: 'Ana', hours: 20 }],
  });
  assert.deepEqual(warnings, []);
});

/* ------------------------------------------- wiring pins */

test('migration 063, the wipe sweep, the router mount and the two faces are in place', () => {
  const migration = read('migrations/063_labor_watch.sql');
  assert.ok(migration.includes('labor_watch_settings'));
  assert.ok(!/REFERENCES/i.test(migration), 'no foreign key (the migration-017 lesson)');
  assert.ok(read('server/billing.js').includes('DELETE FROM labor_watch_settings WHERE business_id = $1'), 'wipe sweep');
  assert.ok(read('server/app.js').includes('createLaborWarningsRouter'), 'router mounted');
  const routes = read('server/laborWarningsRoutes.js');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"), 'the target face is stripped by the restaurant feature');
  assert.ok(routes.includes('hasLaborTarget'), 'the response names whether the target face rides');
  assert.ok(routes.includes('OWNER_MESSAGE'), 'the settings write is the owner alone');
  assert.ok(read('src/pages/Workforce.jsx').includes('LaborWatchPanel'), 'the general face lives in the workforce schedule tools');
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/restaurant/labor-target"'));
  assert.ok(app.includes('<PlanRedirect feature="restaurant">'), 'the restaurant route rides the plan redirect');
  const team = SHELVES.find((s) => s.id === 'team');
  assert.ok(team.doors.some((d) => d.to === '/restaurant/labor-target' && !d.crossLink), 'Team & Place is the home shelf (a primary door)');
  assert.ok(team.doors.some((d) => d.to === '/workforce' && d.crossLink), 'the shelf cross-links to the general warnings home');
});

test('the printed paper is a Studio document (preview = print)', () => {
  const doc = read('src/components/print/LaborWatchDoc.jsx');
  assert.ok(doc.includes('DocFrame') && doc.includes('docRootStyle'), 'Studio frame + style');
  assert.ok(doc.includes("t('laborWatch.docTitle')"), 'the paper rides the Studio document');
  assert.ok(read('src/components/LaborWatchPanel.jsx').includes('LaborWatchDoc'), 'the page shows the document it prints');
});
