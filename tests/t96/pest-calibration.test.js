// t96 — Plan Part 7, owner-ruled addition G-B: PEST-CONTROL
// LOG + THERMOMETER CALIBRATION LOG (Nov 26, 2026).
// Business-only, Restaurant Corner, Food Safety shelf —
// the 370 family. Pinned here:
//   - 36 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 7012
//     (6940 + 36 G-B keys); the toast placeholders survive.
//   - The plan presentation carries the pest/calibration
//     line on the Business lists only (Plans + Welcome +
//     the matrix ✗/✓) — invisible on Essentials.
//   - The training catalogs agree at 139 lessons; the
//     sibling food-safety lesson rides the staff track
//     under the RESTAURANT heading with 5 steps and the
//     restaurant feature gate (restaurant heading 22 → 23).
//   - The pure core: pest cleaning (company required, real
//     dates), calibration cleaning (thermometer + initials
//     required) and the ice-point outcome (pass at exactly
//     32 °F / 0 °C, adjusted otherwise) — the server judges.
//   - Migration 072 carries both tables; the pest report's
//     bytes never ride a read (shapePestVisit / entity hide).
//   - The wiring: both entities are plan-gated 'restaurant',
//     the report route follows the documents machinery
//     (SDS file rules), the Food Safety shelf door exists,
//     and both log types print inside the inspection-ready
//     packet; the 3 new server wordings are keyed.
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
  cleanPestVisit,
  cleanCalibration,
  calibrationOutcome,
  shapePestVisit,
} from '../../server/foodSafetyCore.js';
import { calibrationOutcome as clientCalibrationOutcome } from '../../src/lib/foodSafety.js';
import { entityDef } from '../../server/entities.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'plansLib.businessIncludes.pestCalibration',
  'nav.pestCalibration',
  'restaurant.doorPestCalibration',
  'pestCal.title',
  'pestCal.subtitle',
  'pestCal.pestTitle',
  'pestCal.calTitle',
  'pestCal.addPest',
  'pestCal.addCal',
  'pestCal.date',
  'pestCal.company',
  'pestCal.technician',
  'pestCal.areas',
  'pestCal.findings',
  'pestCal.nextVisit',
  'pestCal.report',
  'pestCal.thermometer',
  'pestCal.initials',
  'pestCal.outcome',
  'pestCal.pass',
  'pestCal.adjusted',
  'pestCal.pestEmpty',
  'pestCal.calEmpty',
  'pestCal.pestSaved',
  'pestCal.calSaved',
  'pestCal.iceNote',
  'pestCal.saveFailed',
  'training.lessons.staff-pest-calibration.title',
  'training.lessons.staff-pest-calibration.step1',
  'training.lessons.staff-pest-calibration.step2',
  'training.lessons.staff-pest-calibration.step3',
  'training.lessons.staff-pest-calibration.step4',
  'training.lessons.staff-pest-calibration.step5',
  'apiErrors.pestCal.companyNeeded',
  'apiErrors.pestCal.thermometerNeeded',
  'apiErrors.pestCal.invalid',
];

test('the keyset is uniform at 7012 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 7012, code);
});

test('all 36 G-B keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 36);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('no G-B value is byte-identical to English outside the English sets (zero debt)', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    if (code.startsWith('en')) continue;
    for (const key of NEW_KEYS) assert.notEqual(table[key], en[key], `${code} ${key} is untranslated`);
  }
});

test('English variants and base-riding locales carry the same G-B strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('the toast placeholders survive translation', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    assert.ok(table['pestCal.pestSaved'].includes('{company}'), `${code} pestSaved`);
    assert.ok(table['pestCal.calSaved'].includes('{thermometer}'), `${code} calSaved`);
  }
});

test('plan presentation: the pest/calibration line is Business-only on Plans, Welcome and the matrix', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.pestCalibration').length - 1, 3, 'Plans Business, Welcome Business and the matrix');
  const line = en['plansLib.businessIncludes.pestCalibration'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the line');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Plans Essentials never sees it');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never sees it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

test('the catalogs agree at 139 lessons and the G-B lesson rides the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 139);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'staff-pest-calibration');
  assert.ok(lesson, 'G-B lesson exists');
  assert.equal(lesson.track, 'staff');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant', 'the lesson is feature-gated like the corner');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.staff-pest-calibration.title'], 'Pest control & thermometer calibration');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 116);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 23);
});

test('cleanPestVisit: the company is required and the dates must be real', () => {
  const ok = cleanPestVisit({
    company: ' Desert Pest Co ',
    visit_date: '2026-11-20',
    technician: 'Sam',
    areas_treated: 'Kitchen, dry store',
    findings: 'No activity',
    next_visit_on: '2026-12-20',
  });
  assert.deepEqual(ok, {
    company: 'Desert Pest Co',
    visit_date: '2026-11-20',
    technician: 'Sam',
    areas_treated: 'Kitchen, dry store',
    findings: 'No activity',
    next_visit_on: '2026-12-20',
  });
  assert.equal(cleanPestVisit({ company: 'X', visit_date: '2026-02-30' }).visit_date, null, 'an impossible date is no date');
  assert.throws(() => cleanPestVisit({ company: '  ' }), /pest-control company/);
  assert.throws(() => cleanPestVisit({}), /pest-control company/);
});

test('calibrationOutcome: pass at the ice point, adjusted otherwise — client and server agree', () => {
  for (const [reading, unit, want] of [
    [32, 'F', 'pass'],
    [0, 'C', 'pass'],
    [33, 'F', 'adjusted'],
    [31, 'F', 'adjusted'],
    [1, 'C', 'adjusted'],
    [-1, 'C', 'adjusted'],
    ['', 'F', 'adjusted'],
    [null, 'C', 'adjusted'],
  ]) {
    assert.equal(calibrationOutcome(reading, unit), want, `${reading} ${unit}`);
    assert.equal(clientCalibrationOutcome(reading, unit), want, `client ${reading} ${unit}`);
  }
});

test('cleanCalibration: thermometer and initials required, outcome is the server judgement', () => {
  const ok = cleanCalibration({ thermometer_name: 'Probe 2', reading: '32', unit: 'F', initials: 'CP', outcome: 'adjusted' });
  assert.deepEqual(ok, { thermometer_name: 'Probe 2', reading: 32, unit: 'F', outcome: 'pass', initials: 'CP' },
    'a client claim of adjusted cannot stand over a passing reading');
  const adjusted = cleanCalibration({ thermometer_name: 'Probe 2', reading: 34, unit: 'F', initials: 'CP', outcome: 'pass' });
  assert.equal(adjusted.outcome, 'adjusted', 'a client claim of pass cannot stand over a missed reading');
  assert.throws(() => cleanCalibration({ reading: 32, initials: 'CP' }), /thermometer you checked/);
  assert.throws(() => cleanCalibration({ thermometer_name: 'P', reading: '', initials: 'CP' }), /Check the entry/);
  assert.throws(() => cleanCalibration({ thermometer_name: 'P', reading: 32, initials: ' ' }), /Check the entry/);
});

test('shapePestVisit: the filed report rides as metadata only, never its bytes', () => {
  const shaped = shapePestVisit({ id: 'v1', company: 'X', report_filename: 'report.pdf', report_data_base64: 'QUJD' });
  assert.ok(!('report_data_base64' in shaped), 'no bytes in the shaped row');
  assert.equal(shaped.has_report, true);
  assert.equal(shaped.report_filename, 'report.pdf');
  assert.equal(shapePestVisit({ id: 'v2', company: 'Y' }).has_report, false);
});

test('migration 072 carries both tables and the report columns', () => {
  const sql = read('migrations/072_pest_calibration.sql');
  for (const needle of [
    'CREATE TABLE IF NOT EXISTS pest_visits',
    'company TEXT NOT NULL',
    'areas_treated TEXT NOT NULL',
    'next_visit_on DATE',
    'report_data_base64 TEXT',
    'CREATE TABLE IF NOT EXISTS calibration_logs',
    'thermometer_name TEXT NOT NULL',
    "outcome TEXT NOT NULL DEFAULT 'adjusted' CHECK (outcome IN ('pass', 'adjusted'))",
    'initials TEXT NOT NULL',
  ]) {
    assert.ok(sql.includes(needle), needle);
  }
});

test('the 3 new server wordings are keyed in the apiErrors registry', () => {
  const pairs = [
    ['Name the pest-control company that visited.', 'apiErrors.pestCal.companyNeeded'],
    ['Name the thermometer you checked.', 'apiErrors.pestCal.thermometerNeeded'],
    ['Check the entry and try again.', 'apiErrors.pestCal.invalid'],
  ];
  assert.equal(pairs.length, 3);
  for (const [message, key] of pairs) assert.equal(API_ERROR_MESSAGE_KEYS[message], key, message);
});

test('the wiring: plan-gated entities, the shelf door, the report route and the packet', () => {
  assert.equal(entityDef('PestVisit').planGate, 'restaurant');
  assert.equal(entityDef('PestVisit').table, 'pest_visits');
  assert.deepEqual(entityDef('PestVisit').hide, ['report_data_base64']);
  assert.equal(entityDef('CalibrationLog').planGate, 'restaurant');
  assert.equal(entityDef('CalibrationLog').table, 'calibration_logs');
  const shelves = read('src/lib/restaurantShelves.js');
  assert.ok(shelves.includes("door('/restaurant/pest-calibration', 'nav.pestCalibration', 'restaurant.doorPestCalibration', Bug)"), 'the Food Safety shelf door');
  const routes = read('server/foodSafetyRoutes.js');
  assert.ok(routes.includes('/pest/:id/report'), 'the report filing route');
  assert.ok(routes.includes('/pest/:id/file'), 'the report file route');
  assert.ok(routes.includes('parseSdsDataUrl'), 'the documents machinery file rules');
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/restaurant/pest-calibration"'), 'the app route');
  assert.ok(app.includes('<RestaurantPestCalibration />'), 'the page rides the route');
  const packetPage = read('src/pages/RestaurantInspectionPacket.jsx');
  assert.ok(packetPage.includes('base44.entities.PestVisit.filter'), 'the packet gathers pest visits');
  assert.ok(packetPage.includes('base44.entities.CalibrationLog.filter'), 'the packet gathers calibration checks');
  const packetDoc = read('src/components/print/InspectionPacketDoc.jsx');
  assert.ok(packetDoc.includes("t('pestCal.pestTitle')"), 'the packet prints the pest log');
  assert.ok(packetDoc.includes("t('pestCal.calTitle')"), 'the packet prints the calibration log');
  const wipe = read('server/billing.js');
  assert.ok(wipe.includes('DELETE FROM pest_visits'), 'the wipe sweep takes pest visits');
  assert.ok(wipe.includes('DELETE FROM calibration_logs'), 'the wipe sweep takes calibration logs');
});
