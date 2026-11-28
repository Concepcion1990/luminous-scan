/**
 * T81 — the FOOD-SAFETY FILE, COMPLETED (Nov 26, 2026; plan
 * release 370, Gap 6 + the two round-2 riders). Business-only,
 * Restaurant Corner, the Food Safety shelf. Five pieces:
 *
 *  (1) CORRECTIVE ACTIONS on temperature logs: an out-of-range
 *      reading REQUIRES its "what did you do" note before the
 *      entry stands — one rule (server/foodSafetyCore.js),
 *      enforced by the TempLog entity validator, the safety-log
 *      validator, and both dialogs.
 *  (2) COOLING / REHEATING / SANITIZER LOGS: the temperature
 *      logs' own shape (migration 059's safety_logs), each kind
 *      judged against its range — cooling at fridge temperature
 *      or below (5 °C), reheating at 74 °C or hotter, chlorine
 *      sanitizer at 50–100 ppm — temperatures judged in Celsius
 *      (the 361 discipline), the server the judge.
 *  (3) The INSPECTION-READY PACKET: one Studio document
 *      (InspectionPacketDoc) gathering temps + the new logs +
 *      waste for the inspector's date range; PREVIEW = PRINT.
 *  (4) FOOD-HANDLER CERTIFICATE TRACKING on the
 *      staff-documents machinery (release 340's tick pattern,
 *      clock-family hierarchy, the subject's own /mine door),
 *      with a 30-day warning before expiry — plus the round-2
 *      RIDER: the widened class family (ServSafe manager,
 *      alcohol-server, owner-named 'other' classes).
 *  (5) The MOCK-INSPECTION SELF-CHECK on the checklist engine
 *      (plan 369): the caller's own language supplies the item
 *      labels; ticking rides the checklist routes.
 *  (6) The SDS SHELF (round-2 rider): safety data sheets stored
 *      via the documents machinery (types + the 25 MB cap),
 *      readable by ANY member, added on the documents tick,
 *      removed by the owner alone.
 *
 *  TEST + RETEST — by name below: an out-of-range temperature
 *  entry without its note is refused (create AND edit); a
 *  cooling log judged in Fahrenheit converts and stands or
 *  falls by Celsius; a certificate warns inside 30 days and
 *  reads expired the day after its date; another business's
 *  certificates are invisible; the shaped SDS row carries no
 *  bytes.
 *
 *  Keyset: 6100 + 111 = 6506 ×52, uniform. Training catalog:
 *  121 + 1 = 122 (staff track, restaurant module, RESTAURANT
 *  heading, 5 steps, restaurant feature). Registry: 535 + 4 =
 *  539. Migration 059 (safety_logs / food_certs / sds_sheets).
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
import { API_ERROR_MESSAGE_KEYS } from '../../src/lib/apiErrors.js';
import {
  CERT_CLASSES,
  CERT_EXPIRY_MESSAGE,
  CERT_MEMBER_MESSAGE,
  CERT_WARN_DAYS,
  CORRECTIVE_ACTION_MESSAGE,
  SAFETY_LOG_KIND_MESSAGE,
  SAFETY_LOG_KINDS,
  SAFETY_RANGES,
  certDaysLeft,
  certStatus,
  cleanCert,
  cleanDate,
  cleanSafetyLog,
  correctiveActionError,
  createCert,
  deleteCert,
  listCerts,
  listSdsSheets,
  safetyLogInRange,
  shapeSdsSheet,
} from '../../server/foodSafetyCore.js';
import { FOOD_SAFETY_REMOVE_OWNER_ONLY_MESSAGE } from '../../server/foodSafetyRoutes.js';
import {
  CERT_CLASSES as CLIENT_CERT_CLASSES,
  SAFETY_RANGES as CLIENT_SAFETY_RANGES,
  certStatus as clientCertStatus,
  safetyLogInRange as clientSafetyLogInRange,
} from '../../src/lib/foodSafety.js';
import { SHELVES } from '../../src/lib/restaurantShelves.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.safetyLogs', 'nav.inspectionPacket', 'nav.foodCerts', 'nav.mockInspection', 'nav.sds',
  'restaurant.doorSafetyLogs', 'restaurant.doorInspectionPacket', 'restaurant.doorFoodCerts',
  'restaurant.doorMockInspection', 'restaurant.doorSds',
  'plansLib.businessIncludes.foodSafetyFile',
  'foodSafety.correctiveRequired',
  'apiErrors.correctiveAction', 'apiErrors.safetyLogKind', 'apiErrors.foodCertExpiry',
  'apiErrors.foodSafetyRemoveOwnerOnly',
  'foodSafety.logs.title', 'foodSafety.logs.subtitle', 'foodSafety.logs.newButton',
  'foodSafety.logs.dialogTitle', 'foodSafety.logs.dialogIntro', 'foodSafety.logs.kindLabel',
  'foodSafety.logs.kind.cooling', 'foodSafety.logs.kind.reheating', 'foodSafety.logs.kind.sanitizer',
  'foodSafety.logs.itemLabel', 'foodSafety.logs.itemPlaceholder', 'foodSafety.logs.readingLabel',
  'foodSafety.logs.unitPpm', 'foodSafety.logs.range.cooling', 'foodSafety.logs.range.reheating',
  'foodSafety.logs.range.sanitizer', 'foodSafety.logs.emptyTitle', 'foodSafety.logs.emptyBody',
  'foodSafety.logs.saved', 'foodSafety.logs.needItem', 'foodSafety.logs.needReading',
  'foodSafety.logs.colItem', 'foodSafety.logs.save', 'foodSafety.logs.saveFailed',
  'foodSafety.logs.allKinds',
  'foodSafety.packet.title', 'foodSafety.packet.subtitle', 'foodSafety.packet.fromLabel',
  'foodSafety.packet.toLabel', 'foodSafety.packet.count', 'foodSafety.packet.empty',
  'foodSafety.packet.docTitle', 'foodSafety.packet.docSubtitle', 'foodSafety.packet.colKind',
  'foodSafety.certs.title', 'foodSafety.certs.subtitle', 'foodSafety.certs.newButton',
  'foodSafety.certs.dialogIntro', 'foodSafety.certs.emptyTitle', 'foodSafety.certs.emptyBody',
  'foodSafety.certs.memberLabel', 'foodSafety.certs.memberPick', 'foodSafety.certs.needMember',
  'foodSafety.certs.classLabel', 'foodSafety.certs.class.food_handler',
  'foodSafety.certs.class.servsafe_manager', 'foodSafety.certs.class.alcohol_server',
  'foodSafety.certs.class.other', 'foodSafety.certs.classNameLabel', 'foodSafety.certs.issuedLabel',
  'foodSafety.certs.expiresLabel', 'foodSafety.certs.colPerson', 'foodSafety.certs.colStatus',
  'foodSafety.certs.statusOk', 'foodSafety.certs.statusExpiring', 'foodSafety.certs.statusExpired',
  'foodSafety.certs.daysLeft', 'foodSafety.certs.save', 'foodSafety.certs.saveFailed',
  'foodSafety.certs.needExpiry', 'foodSafety.certs.gatedNote', 'foodSafety.certs.removeTitle',
  'foodSafety.certs.removeBody',
  'foodSafety.sds.title', 'foodSafety.sds.subtitle', 'foodSafety.sds.uploadButton',
  'foodSafety.sds.titlePlaceholder', 'foodSafety.sds.emptyTitle', 'foodSafety.sds.emptyBody',
  'foodSafety.sds.saveFailed', 'foodSafety.sds.gatedNote', 'foodSafety.sds.loadFailed',
  'foodSafety.sds.removeTitle', 'foodSafety.sds.removeBody',
  'foodSafety.mock.title', 'foodSafety.mock.subtitle', 'foodSafety.mock.intro',
  'foodSafety.mock.startButton', 'foodSafety.mock.startFailed', 'foodSafety.mock.startedNote',
  'foodSafety.mock.openChecklists', 'foodSafety.mock.item1', 'foodSafety.mock.item2',
  'foodSafety.mock.item3', 'foodSafety.mock.item4', 'foodSafety.mock.item5', 'foodSafety.mock.item6',
  'foodSafety.mock.item7', 'foodSafety.mock.item8',
  'training.lessons.staff-food-safety.title',
  'training.lessons.staff-food-safety.step1', 'training.lessons.staff-food-safety.step2',
  'training.lessons.staff-food-safety.step3', 'training.lessons.staff-food-safety.step4',
  'training.lessons.staff-food-safety.step5',
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

test('the 111 new keys exist in all 52 locales and are not the key itself', () => {
  assert.equal(NEW_KEYS.length, 111);
  assert.equal(new Set(NEW_KEYS).size, 111, 'no duplicate keys in the build list');
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

test('the four new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(API_ERROR_MESSAGE_KEYS[CORRECTIVE_ACTION_MESSAGE], 'apiErrors.correctiveAction');
  assert.equal(API_ERROR_MESSAGE_KEYS[SAFETY_LOG_KIND_MESSAGE], 'apiErrors.safetyLogKind');
  assert.equal(API_ERROR_MESSAGE_KEYS[CERT_EXPIRY_MESSAGE], 'apiErrors.foodCertExpiry');
  assert.equal(API_ERROR_MESSAGE_KEYS[FOOD_SAFETY_REMOVE_OWNER_ONLY_MESSAGE], 'apiErrors.foodSafetyRemoveOwnerOnly');
  assert.equal(API_ERROR_MESSAGE_KEYS[CERT_MEMBER_MESSAGE], 'apiErrors.notFound.teamMemberBusiness',
    'the member wording is the already-registered staff-documents one, reused not duplicated');
  assert.equal(en['apiErrors.correctiveAction'], CORRECTIVE_ACTION_MESSAGE);
  assert.equal(en['apiErrors.foodCertExpiry'], CERT_EXPIRY_MESSAGE);
  assert.equal(en['foodSafety.correctiveRequired'], CORRECTIVE_ACTION_MESSAGE,
    'the dialog guard and the server refusal are the same sentence');
});

/* ------------------------------------------- plan presentation */

test('plan presentation: the food-safety line rides Business ONLY — Plans + Welcome + the matrix, never Essentials', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.foodSafetyFile').length - 1, 3,
    'the line is referenced exactly three times: Plans Business list, Welcome Business list, comparison matrix');
  const line = en['plansLib.businessIncludes.foodSafetyFile'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business list carries the line');
  const welcomeBusiness = WELCOME_OPTIONS.find((option) => option.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business list carries the line');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials Plans list never sees it (Business-only invisibility)');
  const welcomeEssentials = WELCOME_OPTIONS.find((option) => option.key === 'essentials');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Essentials Welcome list never sees it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row, 'the comparison matrix carries the row');
  assert.equal(row.essentials, false, 'the matrix marks it Business-only');
  assert.equal(row.business, true);
});

/* ------------------------------------------------- the lesson */

test('catalogs stand at 125, client and server in direct agreement', () => {
  assert.equal(CLIENT_LESSONS.length, 132);
  assert.equal(SERVER_LESSONS.length, 132);
  assert.deepEqual(
    CLIENT_LESSONS.map((l) => [l.id, l.track, l.module, l.heading, l.steps, l.feature || null]),
    SERVER_LESSONS.map((l) => [l.id, l.track, l.module, l.heading, l.steps, l.feature || null]),
    'the two catalogs agree lesson for lesson',
  );
});

test('the new lesson: staff-food-safety, staff track, restaurant module, RESTAURANT heading, 5 steps, restaurant feature', () => {
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'staff-food-safety');
  assert.ok(lesson, 'the lesson exists');
  assert.deepEqual(
    { track: lesson.track, module: lesson.module, heading: lesson.heading, steps: lesson.steps, feature: lesson.feature },
    { track: 'staff', module: 'restaurant', heading: 'restaurant', steps: 5, feature: 'restaurant' },
  );
  assert.equal(en['training.lessons.staff-food-safety.title'], 'Keeping the food-safety file');
});

/* ----------------------------------- piece 1: the corrective rule */

test('correctiveActionError: an out-of-range reading owes its note; an in-range one never does', () => {
  assert.equal(correctiveActionError({ in_range: false, corrective_action: '' }), CORRECTIVE_ACTION_MESSAGE);
  assert.equal(correctiveActionError({ in_range: false, corrective_action: '   ' }), CORRECTIVE_ACTION_MESSAGE,
    'whitespace is not a note');
  assert.equal(correctiveActionError({ in_range: false, corrective_action: 'Cooled it again on ice.' }), null);
  assert.equal(correctiveActionError({ in_range: true, corrective_action: '' }), null);
  assert.equal(correctiveActionError({ in_range: true }), null);
  assert.equal(correctiveActionError({}), null, 'an unjudged row owes nothing here');
  assert.equal(correctiveActionError(), null);
});

test('TEST + RETEST: the temperature-log validator refuses an out-of-range entry without its note, on create and on edit', () => {
  const entities = read('server/entities.js');
  assert.ok(entities.includes('const owed = correctiveActionError(candidate);'),
    'validateTempLog runs the family rule over the candidate');
  assert.ok(entities.includes('await validateTempLog(pool, business, values);'), 'the create path validates');
  assert.ok(entities.includes('await validateTempLog(pool, access.business, { ...row, ...patch });'),
    'the update path validates the MERGED row, so an edit cannot strip the note either');
  const dialog = read('src/components/restaurant/TempLogDialog.jsx');
  assert.ok(dialog.includes('foodSafety.correctiveRequired'), 'the dialog refuses first, with the same sentence');
  const safetyDialog = read('src/components/restaurant/SafetyLogDialog.jsx');
  assert.ok(safetyDialog.includes('foodSafety.correctiveRequired'), 'the safety-log dialog carries the same guard');
});

/* ------------------------------------- piece 2: the new logs */

test('safetyLogInRange: cooling judged at 5 °C, reheating at 74 °C, sanitizer at 50–100 ppm — Fahrenheit converts', () => {
  assert.deepEqual(SAFETY_LOG_KINDS, ['cooling', 'reheating', 'sanitizer']);
  assert.deepEqual(SAFETY_RANGES, {
    cooling: { judge: 'C', min: null, max: 5 },
    reheating: { judge: 'C', min: 74, max: null },
    sanitizer: { judge: 'ppm', min: 50, max: 100 },
  });
  // Cooling: at fridge temperature or below.
  assert.equal(safetyLogInRange('cooling', 5, 'C'), true);
  assert.equal(safetyLogInRange('cooling', 5.1, 'C'), false);
  assert.equal(safetyLogInRange('cooling', 41, 'F'), true, '41 °F is exactly 5 °C');
  assert.equal(safetyLogInRange('cooling', 42, 'F'), false, '42 °F is 5.6 °C — still warm');
  // Reheating: at the reheat temperature or hotter.
  assert.equal(safetyLogInRange('reheating', 74, 'C'), true);
  assert.equal(safetyLogInRange('reheating', 73.9, 'C'), false);
  assert.equal(safetyLogInRange('reheating', 165, 'F'), true, '165 °F is the canonical 74 °C');
  assert.equal(safetyLogInRange('reheating', 160, 'F'), false, '160 °F is 71.1 °C — not reheated');
  // Sanitizer: the chlorine band, in ppm whatever the caller claims.
  assert.equal(safetyLogInRange('sanitizer', 50, 'ppm'), true);
  assert.equal(safetyLogInRange('sanitizer', 100, 'ppm'), true);
  assert.equal(safetyLogInRange('sanitizer', 49, 'ppm'), false);
  assert.equal(safetyLogInRange('sanitizer', 101, 'ppm'), false);
  // No kind, no reading, no judgement.
  assert.equal(safetyLogInRange('freezing', 0, 'C'), false);
  assert.equal(safetyLogInRange('cooling', 'warm', 'C'), false);
  assert.equal(safetyLogInRange('cooling', null, 'C'), false);
});

test('client and server judge the new logs identically', () => {
  assert.deepEqual(CLIENT_SAFETY_RANGES, SAFETY_RANGES);
  assert.deepEqual(CLIENT_CERT_CLASSES, CERT_CLASSES);
  for (const [kind, reading, unit] of [
    ['cooling', 41, 'F'], ['cooling', 44, 'F'], ['reheating', 170, 'F'],
    ['reheating', 70, 'C'], ['sanitizer', 75, 'ppm'], ['sanitizer', 20, 'ppm'],
  ]) {
    assert.equal(clientSafetyLogInRange(kind, reading, unit), safetyLogInRange(kind, reading, unit), `${kind} ${reading}${unit}`);
  }
  assert.equal(clientCertStatus('2026-12-20', new Date('2026-11-26T12:00:00Z')), certStatus('2026-12-20', '2026-11-26'));
});

test('cleanSafetyLog: the server judges, the corrective rule rides, an unknown kind is refused by name', () => {
  assert.throws(
    () => cleanSafetyLog({ kind: 'freezing', subject_name: 'Soup', reading: 3, unit: 'C' }),
    (e) => e.message === SAFETY_LOG_KIND_MESSAGE && e.code === 'safety_log_kind',
  );
  // Out of range without its note — refused with the family wording.
  assert.throws(
    () => cleanSafetyLog({ kind: 'cooling', subject_name: 'Soup', reading: 9, unit: 'C' }),
    (e) => e.message === CORRECTIVE_ACTION_MESSAGE && e.code === 'corrective_action_required',
  );
  // TEST + RETEST: the same entry WITH its note stands, marked out.
  const stood = cleanSafetyLog({
    kind: 'cooling', subject_name: ' Soup ', reading: 9, unit: 'C',
    corrective_action: 'Back on ice, rechecked at 4 °C.', in_range: true,
  });
  assert.equal(stood.in_range, false, "the server's judgement replaces the client's claim");
  assert.equal(stood.subject_name, 'Soup');
  assert.equal(stood.corrective_action, 'Back on ice, rechecked at 4 °C.');
  // In range stands clean; sanitizer readings are ppm by kind.
  const clean = cleanSafetyLog({ kind: 'sanitizer', subject_name: 'Chlorine bucket', reading: 75, unit: 'F' });
  assert.equal(clean.unit, 'ppm', 'a sanitizer reading is ppm whatever unit the caller sent');
  assert.equal(clean.in_range, true);
  const reheat = cleanSafetyLog({ kind: 'reheating', subject_name: 'Gravy', reading: 170, unit: 'F' });
  assert.equal(reheat.in_range, true, '170 °F reheats (76.7 °C)');
});

/* --------------------------------- piece 4 + rider: certificates */

test('certStatus + certDaysLeft: expired the day after, expiring inside the 30-day warning window', () => {
  assert.equal(CERT_WARN_DAYS, 30);
  const today = '2026-11-26';
  assert.equal(certStatus('2026-11-25', today), 'expired');
  assert.equal(certDaysLeft('2026-11-25', today), -1);
  assert.equal(certStatus('2026-11-26', today), 'expiring', 'the expiry day itself still warns, not yet expired');
  assert.equal(certDaysLeft('2026-11-26', today), 0);
  assert.equal(certStatus('2026-12-26', today), 'expiring', 'day 30 is inside the window');
  assert.equal(certDaysLeft('2026-12-26', today), 30);
  assert.equal(certStatus('2026-12-27', today), 'ok', 'day 31 is beyond the warning');
  assert.equal(certStatus('', today), 'none');
  assert.equal(certStatus('not-a-date', today), 'none');
  assert.equal(certDaysLeft(null, today), null);
  assert.equal(cleanDate('2026-02-30'), null, 'a date that does not exist is not a date');
  assert.equal(cleanDate('2026-11-26'), '2026-11-26');
});

test('cleanCert: a real expiry date is required; owner-named classes keep their label, known classes drop it', () => {
  assert.throws(
    () => cleanCert({ cert_class: 'food_handler' }),
    (e) => e.message === CERT_EXPIRY_MESSAGE && e.code === 'food_cert_expiry',
  );
  assert.throws(() => cleanCert({ cert_class: 'food_handler', expires_on: '2027-13-01' }),
    (e) => e.message === CERT_EXPIRY_MESSAGE);
  const named = cleanCert({ cert_class: 'other', class_label: ' City pool card ', expires_on: '2027-06-01', issued_on: '2026-06-01' });
  assert.equal(named.cert_class, 'other');
  assert.equal(named.class_label, 'City pool card', "the rider: the owner's own name for the class rides the row");
  const known = cleanCert({ cert_class: 'servsafe_manager', class_label: 'ignored', expires_on: '2028-01-15' });
  assert.equal(known.class_label, '', 'a known class needs no owner label');
  const fallback = cleanCert({ cert_class: 'bogus', expires_on: '2027-01-01' });
  assert.equal(fallback.cert_class, 'food_handler', 'an unknown class falls back to the basic card');
  assert.deepEqual(CERT_CLASSES, ['food_handler', 'servsafe_manager', 'alcohol_server', 'other']);
});

/* ------------------------------------- a fake pool (no live DB) */

function fakePool() {
  const state = { certs: [], sds: [] };
  const runQuery = (sql, params = []) => {
    if (/INSERT INTO food_certs/i.test(sql)) {
      const [id, business_id, staff_member_id, member_name, cert_class, class_label, issued_on, expires_on, note, created_by_id, created_by] = params;
      const row = { id, business_id, staff_member_id, member_name, cert_class, class_label, issued_on, expires_on, note, created_by_id, created_by, created_at: '2026-11-26T00:00:00Z' };
      state.certs.push(row);
      return { rows: [row] };
    }
    if (/SELECT \* FROM food_certs WHERE business_id/i.test(sql)) {
      return { rows: state.certs.filter((r) => r.business_id === params[0]) };
    }
    if (/DELETE FROM food_certs/i.test(sql)) {
      const before = state.certs.length;
      state.certs = state.certs.filter((r) => !(r.id === params[0] && r.business_id === params[1]));
      return { rows: [], rowCount: before - state.certs.length };
    }
    if (/FROM sds_sheets WHERE business_id/i.test(sql)) {
      return {
        rows: state.sds.filter((r) => r.business_id === params[0])
          .map(({ data_base64, ...rest }) => rest),
      };
    }
    throw new Error(`fake pool cannot run: ${sql}`);
  };
  return { state, query: async (sql, params) => runQuery(sql, params) };
}

test('TEST + RETEST: certificates — create, warn, read across businesses, remove', async () => {
  const pool = fakePool();
  const member = { id: 'm-ana', full_name: 'Ana Cook' };
  const cert = await createCert(pool, 'biz-a', member,
    { cert_class: 'food_handler', issued_on: '2026-01-10', expires_on: '2026-12-20' },
    { userId: 'u-owner', actorName: 'Owner' });
  assert.equal(cert.member_name, 'Ana Cook', "the member's name rides as a snapshot");
  // Owner-approved clock fix (Release 398 rider, test file only):
  // createCert's returned status reads the real clock (its API
  // takes no `today`), so the dated assertions read the row back
  // at the fixed date through listCerts, which takes `today`
  // explicitly — the pattern every other dated read here uses.
  const created = await listCerts(pool, 'biz-a', '2026-11-26');
  assert.equal(created[0].status, 'expiring', 'Dec 20 is inside the 30-day window from Nov 26');
  assert.equal(created[0].days_left, 24);
  // Another business's shelf is another business's shelf.
  assert.deepEqual(await listCerts(pool, 'biz-b', '2026-11-26'), []);
  const mine = await listCerts(pool, 'biz-a', '2026-11-26');
  assert.equal(mine.length, 1);
  // RETEST: time passes — the same row reads expired, then removal
  // stands and a second removal is a plain not-found.
  const later = await listCerts(pool, 'biz-a', '2026-12-21');
  assert.equal(later[0].status, 'expired');
  await deleteCert(pool, 'biz-a', cert.id);
  assert.deepEqual(await listCerts(pool, 'biz-a', '2026-11-26'), []);
  await assert.rejects(() => deleteCert(pool, 'biz-a', cert.id),
    (e) => e.status === 404, 'removing what is not there is a 404, not a silence');
  await assert.rejects(() => deleteCert(pool, 'biz-b', cert.id),
    (e) => e.status === 404, "another business cannot remove this business's rows");
});

/* ------------------------------------------ rider: the SDS shelf */

test('the SDS shelf: the shaped row carries metadata only — never the bytes', async () => {
  const shaped = shapeSdsSheet({
    id: 's1', title: 'Chlorine sanitizer', filename: 'chlorine.pdf',
    content_type: 'application/pdf', size_bytes: 12345,
    uploaded_by_name: 'Ana', created_at: '2026-11-26T00:00:00Z', data_base64: 'AAAA',
  });
  assert.equal(shaped.uploaded_at, '2026-11-26T00:00:00Z');
  assert.ok(!('data_base64' in shaped), 'the list door never ships the file bytes');
  const pool = fakePool();
  pool.state.sds.push({
    id: 's1', business_id: 'biz-a', title: 'Chlorine sanitizer', filename: 'chlorine.pdf',
    content_type: 'application/pdf', size_bytes: 10, uploaded_by_name: 'Ana',
    created_at: '2026-11-26T00:00:00Z', data_base64: 'AAAA',
  });
  const list = await listSdsSheets(pool, 'biz-a');
  assert.equal(list.length, 1);
  assert.deepEqual(await listSdsSheets(pool, 'biz-b'), [], 'per-business, like everything in the file');
});

/* --------------------------- migration, wiring, doors, the packet */

test('migration 059: three tables, the kind CHECK, and NO foreign key (the migration-017 lesson)', () => {
  const sql = read('migrations/059_food_safety.sql');
  for (const table of ['safety_logs', 'food_certs', 'sds_sheets']) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} is created`);
  }
  assert.ok(sql.includes("CHECK (kind IN ('cooling', 'reheating', 'sanitizer'))"), 'the kinds are pinned in the table itself');
  const ddl = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.ok(!/REFERENCES|FOREIGN KEY/i.test(ddl), 'business_id carries no foreign key');
  const billing = read('server/billing.js');
  for (const table of ['safety_logs', 'food_certs', 'sds_sheets']) {
    assert.ok(billing.includes(`DELETE FROM ${table} WHERE business_id = $1`), `the wipe sweep deletes ${table}`);
  }
});

test('wiring: the SafetyLog entity, the router mount, the parser path, the client entity list', () => {
  const entities = read('server/entities.js');
  assert.ok(entities.includes("SafetyLog: {"), 'the SafetyLog entity exists');
  assert.ok(/SafetyLog: \{[^}]*planGate: 'restaurant'/.test(entities), 'the entity rides the restaurant plan gate');
  assert.ok(entities.includes('await validateSafetyLog(pool, business, values);'), 'creates validate');
  assert.ok(entities.includes('await validateSafetyLog(pool, access.business, merged);'), 'edits validate the merged row');
  const app = read('server/app.js');
  assert.ok(app.includes('createFoodSafetyRouter'), 'the food-safety router is mounted');
  assert.ok(app.includes('/food-safety/sds'), 'the SDS upload path rides the widened JSON parser');
  const client = read('src/api/client.js');
  assert.ok(client.includes("'SafetyLog'"), 'the client entity list knows SafetyLog');
  const routes = read('server/foodSafetyRoutes.js');
  assert.ok(routes.includes('memberHasDocumentsTick'), 'certificates + SDS writes ride the release-340 documents tick');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"), 'the whole surface is Business-gated');
  assert.ok(routes.includes('createTemplate') && routes.includes('dayView'),
    'the mock inspection materialises on the checklist engine');
});

test('doors + routes: five new doors on the safety shelf, five PlanRedirect routes behind the restaurant gate', () => {
  const safety = SHELVES.find((s) => s.id === 'safety');
  assert.ok(safety, 'the safety shelf exists');
  const routes = safety.doors.map((d) => d.to);
  for (const route of ['/restaurant/safety-logs', '/restaurant/inspection', '/restaurant/certificates', '/restaurant/mock-inspection', '/restaurant/sds']) {
    assert.ok(routes.includes(route), `the shelf carries ${route}`);
  }
  const app = read('src/App.jsx');
  for (const page of ['RestaurantSafetyLogs', 'RestaurantInspectionPacket', 'RestaurantCertificates', 'RestaurantMockInspection', 'RestaurantSds']) {
    assert.ok(app.includes(page), `App routes ${page}`);
  }
  assert.equal(app.split('<PlanRedirect feature="restaurant">').length - 1 >= 5, true,
    'the new pages sit behind the restaurant PlanRedirect');
});

test('the packet is a Studio document: DocFrame chrome, the saved style, PREVIEW = PRINT', () => {
  const doc = read('src/components/print/InspectionPacketDoc.jsx');
  assert.ok(doc.includes('DocFrame') && doc.includes('docRootStyle'), 'the packet wears the Studio frame + the business\u2019s saved style');
  assert.ok(doc.includes('foodSafety.packet.docTitle'), 'the packet speaks the reader\u2019s language');
  const page = read('src/pages/RestaurantInspectionPacket.jsx');
  assert.ok(page.includes('InspectionPacketDoc'), 'the page renders the document');
  assert.ok((page.match(/<InspectionPacketDoc/g) || []).length >= 1, 'one document, shown and printed');
});
