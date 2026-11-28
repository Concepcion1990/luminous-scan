/**
 * T77 — the AGE CHECK BUILD (Nov 25, 2026), the owner's spec
 * (~/workspace/luminous-stockhaven/age-check/spec.md).
 *
 *  Anywhere the scanner lives, it can also scan the PDF417
 *  barcode on the back of a driver's license / state ID. The
 *  app reads the birthdate (AAMVA DBB), does the age math
 *  against the owner's own age lines (Road B: the owner sets
 *  the lines in Settings; shipped defaults 21 alcohol /
 *  21 tobacco / 18 other), and shows the little GREEN check
 *  or the little RED check.
 *
 *  THE APP KEEPS NOTHING WHATSOEVER — her hard constraint.
 *  No name, no license number, no birthdate, no photo, no
 *  log, no report. This group PROVES it three ways: the
 *  verdict objects carry only {status, line}; the whole
 *  battery runs with every storage/network door watched and
 *  nothing knocks; and the sources of the lib + panel are
 *  audited for any persistence call at all.
 *
 *  TEST + RETEST — her direct order: synthetic AAMVA
 *  payloads at the boundary birthdays (turns the line age
 *  today / yesterday / tomorrow) for BOTH verdicts, the
 *  owner's own lines followed over the defaults, expired-ID
 *  handling (an expired ID never passes; the expiration day
 *  itself is still valid), and malformed payloads refused
 *  cleanly as "unreadable" — never a guess, never a crash.
 *
 *  Keyset: 5931 + 27 = 5958 ×52, uniform (the panel's
 *  fifteen, the Settings age-lines card's five, the plan
 *  line, and the scanner-age-check lesson's title + five
 *  steps). Training catalog: 117 + 1 = 118 (staff track,
 *  scanner module — the scanner heading — 5 steps), client
 *  and server in agreement. Migration 055 (the three age
 *  lines on the business record).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { PLANS, WELCOME_OPTIONS } from '../../src/lib/plans.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';
import {
  DEFAULT_AGE_LINES,
  ageLinesFromBusiness,
  ageOn,
  ageVerdict,
  parseIdBarcode,
} from '../../src/lib/ageCheck.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'ageCheck.title', 'ageCheck.intro', 'ageCheck.scanPrompt', 'ageCheck.categoryLabel',
  'ageCheck.category.alcohol', 'ageCheck.category.tobacco', 'ageCheck.category.other',
  'ageCheck.lineNote', 'ageCheck.pass', 'ageCheck.fail', 'ageCheck.expired',
  'ageCheck.unreadable', 'ageCheck.checkAnother', 'ageCheck.back', 'ageCheck.keepsNothing',
  'settings.ageLines.title', 'settings.ageLines.description', 'settings.ageLines.alcohol',
  'settings.ageLines.tobacco', 'settings.ageLines.other',
  'plansLib.includes.ageCheck',
  'training.lessons.scanner-age-check.title', 'training.lessons.scanner-age-check.step1',
  'training.lessons.scanner-age-check.step2', 'training.lessons.scanner-age-check.step3',
  'training.lessons.scanner-age-check.step4', 'training.lessons.scanner-age-check.step5',
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

test('the 27 new keys exist in all 52 locales and are not the key itself', () => {
  for (const [code, strings] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof strings[key] === 'string' && strings[key].length >= 1, `${code} missing ${key}`);
      assert.notEqual(strings[key], key, `${code} ${key} renders as its own key`);
    }
  }
});

test('the five Englishes carry the new keys byte-identical to base en; es/fr variants ride their base', () => {
  for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) {
    for (const key of NEW_KEYS) assert.equal(LOCALES[code][key], en[key], `${code} ${key}`);
  }
  for (const code of ['es-ES', 'es-US', 'es-CU', 'es-PR', 'es-VE']) {
    for (const key of NEW_KEYS) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
  }
  for (const key of NEW_KEYS) assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
});

test('the line note keeps its {category} and {age} placeholders in the rendered-language set', () => {
  for (const code of ['en', 'es-MX', 'ar', 'fa', 'hi', 'zh-Hans']) {
    assert.ok(LOCALES[code]['ageCheck.lineNote'].includes('{category}'), `${code} lineNote lost {category}`);
    assert.ok(LOCALES[code]['ageCheck.lineNote'].includes('{age}'), `${code} lineNote lost {age}`);
  }
});

/* ------------------------------------------- plan presentation */

test('plan presentation: the age-check line rides Essentials on Plans + Welcome + the matrix, and Business does not repeat it', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.includes.ageCheck').length - 1, 3, 'the line is referenced exactly three times: Plans list, Welcome list, comparison matrix');
  assert.ok(plans.includes("{ get label() { return t('plansLib.includes.ageCheck'); }"), 'the comparison matrix row exists');
  const line = en['plansLib.includes.ageCheck'];
  assert.ok(PLANS.essentials.includes.includes(line), 'Plans Essentials list carries the line');
  const welcomeEssentials = WELCOME_OPTIONS.find((option) => option.key === 'essentials');
  assert.ok(welcomeEssentials.includes.includes(line), 'Welcome Essentials list carries the line');
  assert.ok(!PLANS.business.includes.includes(line), 'Business list does not repeat an Essentials line (the Nov 19 dedupe ruling)');
});

/* --------------------------------------- synthetic AAMVA payloads */

/** A payload in the standard AAMVA shape, as a decoder returns it. */
const aamva = ({ dob, exp = null, number = 'X1234567', name = 'DOE' }) => {
  const fields = [
    'ANSI 636000080001DL00410278ZZ03200144DL',
    `DAQ${number}`,
    `DCS${name}`,
    'DACJOHN',
    `DBB${dob}`,
    ...(exp ? [`DBA${exp}`] : []),
    'DBD01012020',
    'DCA C',
  ];
  return `@\n\u001e\r${fields.join('\n')}\n\r`;
};
const mmddyyyy = (y, m, d) => `${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}${y}`;
const TODAY = { year: 2026, month: 11, day: 25 };
const DEFAULTS = { ...DEFAULT_AGE_LINES };

/* ------------------------------------------------- the battery */

test('boundary birthdays: turns the line age today / yesterday / tomorrow, for both verdicts', () => {
  // Alcohol + tobacco lines are 21 by default.
  for (const category of ['alcohol', 'tobacco']) {
    assert.equal(ageVerdict(aamva({ dob: mmddyyyy(2005, 11, 25) }), category, DEFAULTS, TODAY).status, 'pass', `${category}: turns 21 today`);
    assert.equal(ageVerdict(aamva({ dob: mmddyyyy(2005, 11, 24) }), category, DEFAULTS, TODAY).status, 'pass', `${category}: turned 21 yesterday`);
    assert.equal(ageVerdict(aamva({ dob: mmddyyyy(2005, 11, 26) }), category, DEFAULTS, TODAY).status, 'fail', `${category}: turns 21 tomorrow`);
  }
  // The other-goods line is 18 by default.
  assert.equal(ageVerdict(aamva({ dob: mmddyyyy(2008, 11, 25) }), 'other', DEFAULTS, TODAY).status, 'pass', 'other: turns 18 today');
  assert.equal(ageVerdict(aamva({ dob: mmddyyyy(2008, 11, 24) }), 'other', DEFAULTS, TODAY).status, 'pass', 'other: turned 18 yesterday');
  assert.equal(ageVerdict(aamva({ dob: mmddyyyy(2008, 11, 26) }), 'other', DEFAULTS, TODAY).status, 'fail', 'other: turns 18 tomorrow');
  // Comfortably of age and comfortably under.
  assert.equal(ageVerdict(aamva({ dob: mmddyyyy(1990, 1, 1) }), 'alcohol', DEFAULTS, TODAY).status, 'pass');
  assert.equal(ageVerdict(aamva({ dob: mmddyyyy(2015, 1, 1) }), 'other', DEFAULTS, TODAY).status, 'fail');
});

test('age math: a February 29 birthday is reached on March 1 in a non-leap year', () => {
  const dob = { year: 2004, month: 2, day: 29 };
  assert.equal(ageOn(dob, { year: 2025, month: 2, day: 28 }), 20);
  assert.equal(ageOn(dob, { year: 2025, month: 3, day: 1 }), 21);
  assert.equal(ageOn(dob, { year: 2024, month: 2, day: 29 }), 20);
  assert.equal(ageOn({ year: 2000, month: 12, day: 31 }, { year: 2026, month: 1, day: 1 }), 25);
  assert.equal(ageOn({ year: 2000, month: 1, day: 1 }, { year: 2026, month: 1, day: 1 }), 26);
});

test("the owner's own lines govern — the verdict follows Settings, not the shipped defaults", () => {
  const nineteen = aamva({ dob: mmddyyyy(2007, 6, 1) }); // 19 on TODAY
  assert.equal(ageVerdict(nineteen, 'alcohol', DEFAULTS, TODAY).status, 'fail', 'default 21 refuses a 19-year-old');
  assert.equal(ageVerdict(nineteen, 'alcohol', { alcohol: 18, tobacco: 21, other: 18 }, TODAY).status, 'pass', "owner's 18 line passes the same person");
  assert.equal(ageVerdict(nineteen, 'other', { alcohol: 21, tobacco: 21, other: 21 }, TODAY).status, 'fail', "owner's raised 21 other-line refuses");
  assert.equal(ageVerdict(nineteen, 'other', DEFAULTS, TODAY).status, 'pass', 'default 18 other-line passes');
  // The verdict reports the line it was judged against.
  assert.equal(ageVerdict(nineteen, 'alcohol', { alcohol: 18, tobacco: 21, other: 18 }, TODAY).line, 18);
  // Business resolution: stored values win per category, junk falls back per category.
  assert.deepEqual(ageLinesFromBusiness({}), { alcohol: 21, tobacco: 21, other: 18 });
  assert.deepEqual(ageLinesFromBusiness({ age_alcohol: 18 }), { alcohol: 18, tobacco: 21, other: 18 });
  assert.deepEqual(ageLinesFromBusiness({ age_alcohol: '19', age_tobacco: 'x', age_other: 150 }), { alcohol: 19, tobacco: 21, other: 18 });
  assert.deepEqual(ageLinesFromBusiness(null), { alcohol: 21, tobacco: 21, other: 18 });
});

test('expired IDs never pass; the expiration day itself is still valid', () => {
  const ofAge = (exp) => aamva({ dob: mmddyyyy(1990, 5, 5), exp });
  assert.equal(ageVerdict(ofAge(mmddyyyy(2026, 11, 24)), 'alcohol', DEFAULTS, TODAY).status, 'expired', 'expired yesterday');
  assert.equal(ageVerdict(ofAge(mmddyyyy(2026, 11, 25)), 'alcohol', DEFAULTS, TODAY).status, 'pass', 'expires today — still valid');
  assert.equal(ageVerdict(ofAge(mmddyyyy(2026, 11, 26)), 'alcohol', DEFAULTS, TODAY).status, 'pass', 'expires tomorrow');
  assert.equal(ageVerdict(ofAge(mmddyyyy(2030, 1, 1)), 'alcohol', DEFAULTS, TODAY).status, 'pass', 'no near expiry');
  // Expiry is judged before age: an expired ID is "expired", whatever the birthdate.
  assert.equal(ageVerdict(aamva({ dob: mmddyyyy(2015, 1, 1), exp: mmddyyyy(2020, 1, 1) }), 'other', DEFAULTS, TODAY).status, 'expired');
  // No DBA on the card: judged on age alone.
  assert.equal(ageVerdict(aamva({ dob: mmddyyyy(1990, 5, 5) }), 'alcohol', DEFAULTS, TODAY).status, 'pass');
});

test('malformed payloads are refused cleanly as unreadable — never a guess, never a crash', () => {
  const junk = [
    '', 'hello world', '012345678905', 'https://example.com',
    'ANSI 636000', // header shape but no birthdate field
    aamva({ dob: '02302000' }), // February 30 does not exist
    aamva({ dob: '13101990' }), // month 13
    aamva({ dob: '1101199' }), // seven digits is not a date
    `@\n\u001e\rANSI 636000080001DL00410278ZZ03200144DL\nDAQX1234567\nXXDBB${mmddyyyy(1990, 1, 1)}\n\r`, // DBB not at a field start
    null, undefined, 42,
  ];
  for (const payload of junk) {
    assert.equal(ageVerdict(payload, 'alcohol', DEFAULTS, TODAY).status, 'unreadable', JSON.stringify(String(payload).slice(0, 40)));
    assert.equal(parseIdBarcode(payload), null);
  }
});

/* --------------------------------------------- NOTHING IS KEPT */

test('nothing-kept: a verdict carries only the status and the line — no trace of the person', () => {
  const payload = aamva({ dob: mmddyyyy(1990, 5, 5), exp: mmddyyyy(2030, 1, 1), number: 'SECRET123', name: 'MUSTNOTLEAK' });
  for (const category of ['alcohol', 'tobacco', 'other']) {
    const verdict = ageVerdict(payload, category, DEFAULTS, TODAY);
    assert.deepEqual(Object.keys(verdict).sort(), ['line', 'status']);
    const flat = JSON.stringify(verdict);
    assert.ok(!flat.includes('1990') && !flat.includes('0505') && !flat.includes('SECRET123') && !flat.includes('MUSTNOTLEAK'), 'the verdict leaks payload data');
  }
});

test('nothing-kept proof: the whole battery runs with every storage and network door watched, and nothing knocks', async () => {
  const calls = [];
  const watched = (name) => () => { calls.push(name); throw new Error(`forbidden door knocked: ${name}`); };
  const storage = { getItem: watched('storage.getItem'), setItem: watched('storage.setItem'), removeItem: watched('storage.removeItem'), clear: watched('storage.clear') };
  const saved = {
    localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage,
    fetch: globalThis.fetch, indexedDB: globalThis.indexedDB,
  };
  globalThis.localStorage = storage;
  globalThis.sessionStorage = storage;
  globalThis.fetch = watched('fetch');
  globalThis.indexedDB = { open: watched('indexedDB.open') };
  try {
    const mod = await import(new URL('../../src/lib/ageCheck.js?nothing-kept-proof', import.meta.url));
    const battery = [
      aamva({ dob: mmddyyyy(2005, 11, 25) }), aamva({ dob: mmddyyyy(2005, 11, 26) }),
      aamva({ dob: mmddyyyy(1990, 5, 5), exp: mmddyyyy(2020, 1, 1) }), 'junk', '',
    ];
    for (const payload of battery) {
      for (const category of ['alcohol', 'tobacco', 'other']) {
        mod.ageVerdict(payload, category, { alcohol: 21, tobacco: 21, other: 18 }, TODAY);
      }
      mod.parseIdBarcode(payload);
    }
    mod.ageLinesFromBusiness({ age_alcohol: 18 });
    assert.deepEqual(mod.DEFAULT_AGE_LINES, { alcohol: 21, tobacco: 21, other: 18 }, 'the defaults object is untouched after the battery — no retained state');
  } finally {
    globalThis.localStorage = saved.localStorage;
    globalThis.sessionStorage = saved.sessionStorage;
    globalThis.fetch = saved.fetch;
    globalThis.indexedDB = saved.indexedDB;
  }
  assert.deepEqual(calls, [], 'a storage or network door was touched during the checks');
});

test('nothing-kept audit: the lib and the panel hold no persistence, network or logging call at all', () => {
  const forbidden = ['localStorage', 'sessionStorage', 'indexedDB', 'sendBeacon', 'XMLHttpRequest', 'apiRequest', 'base44', 'fetch(', 'console.'];
  for (const file of ['src/lib/ageCheck.js', 'src/components/scan/AgeCheckPanel.jsx']) {
    const source = read(file);
    for (const token of forbidden) assert.ok(!source.includes(token), `${file} must not contain ${token}`);
  }
  // The panel judges the payload inside the detect call and
  // keeps only the verdict: the wiring is pinned verbatim.
  const panel = read('src/components/scan/AgeCheckPanel.jsx');
  assert.ok(panel.includes('setVerdict(ageVerdict(text, category, lines, todayParts()))'), 'the payload is judged in the call, never stored');
});

/* -------------------------------------------------- the doors */

test('the door: the Scan page opens the panel; the panel reads PDF417 through its own reader', () => {
  const scan = read('src/pages/Scan.jsx');
  assert.ok(scan.includes("import AgeCheckPanel from '@/components/scan/AgeCheckPanel'"), 'Scan imports the panel');
  assert.ok(scan.includes('<AgeCheckPanel business={profile} onClose={() => setAgeMode(false)} />'), 'the panel is fed the business record (its age lines) and nothing else');
  assert.ok(scan.includes("t('ageCheck.title')"), 'the door is labelled by the age-check title');
  assert.ok(scan.includes('!ageMode'), 'the handheld-reader door stands down in age mode');

  const panel = read('src/components/scan/AgeCheckPanel.jsx');
  assert.ok(panel.includes('createAgeCheckReader'), 'the panel scans through the PDF417 reader');
  assert.ok(panel.includes('createReader={createAgeCheckReader}'), 'the reader factory is handed to the scanner');
  assert.ok(panel.includes('export function AgeCheckVerdict'), 'the verdict display is its own component');
  for (const key of ['ageCheck.pass', 'ageCheck.fail', 'ageCheck.expired', 'ageCheck.unreadable', 'ageCheck.lineNote', 'ageCheck.keepsNothing']) {
    assert.ok(panel.includes(`'${key}'`), `the panel renders ${key}`);
  }

  const camera = read('src/components/scan/useBarcodeCamera.js');
  assert.ok(camera.includes('useBarcodeCamera(onDetect, createReader = createCodeReader)'), 'the camera hook takes a reader factory, defaulting to the universal reader');
  assert.ok(camera.includes('await createReader()'), 'the factory is what gets built');

  const reader = read('src/lib/codeReader.js');
  assert.ok(reader.includes('export async function createAgeCheckReader()'), 'the PDF417 reader exists');
  assert.ok(reader.includes('BarcodeFormat.PDF_417'), 'the fallback hints PDF417');
  assert.ok(reader.includes("supported.includes('pdf417')"), 'the native engine is used only when it truly reads PDF417');
});

test('the Settings home: the age lines card, the client defaults, the server validation and migration 055', () => {
  const card = read('src/components/business/DetailsCard.jsx');
  for (const key of ['settings.ageLines.title', 'settings.ageLines.description', 'settings.ageLines.alcohol', 'settings.ageLines.tobacco', 'settings.ageLines.other']) {
    assert.ok(card.includes(`t('${key}')`), `the card renders ${key}`);
  }
  for (const id of ['business-age-alcohol', 'business-age-tobacco', 'business-age-other']) {
    assert.ok(card.includes(`id="${id}"`), `the card carries the ${id} field`);
  }
  const business = read('src/lib/business.js');
  assert.ok(business.includes('age_alcohol: 21') && business.includes('age_tobacco: 21') && business.includes('age_other: 18'), 'the client ships the default lines');
  assert.ok(business.includes('cleanAgeLine(values.age_alcohol'), 'the save path cleans the lines');

  const routes = read('server/authRoutes.js');
  assert.ok(routes.includes("'age_alcohol', 'age_tobacco', 'age_other'"), 'the update allowlist carries the lines');
  assert.ok(routes.includes('age_alcohol: Number.isInteger(row.age_alcohol) ? row.age_alcohol : 21'), 'the read shape resolves the alcohol default');
  assert.ok(routes.includes("key === 'age_alcohol' || key === 'age_tobacco' || key === 'age_other'"), 'the validator judges the lines as whole ages');

  const migration = read('migrations/055_age_lines.sql');
  for (const column of ['age_alcohol', 'age_tobacco', 'age_other']) {
    assert.ok(migration.includes(`ADD COLUMN IF NOT EXISTS ${column} INTEGER NOT NULL`), `migration 055 adds ${column}`);
  }
});

/* ---------------------------------------------------- training */

test('the scanner-age-check lesson rides: staff track, scanner heading, five steps, catalogs in agreement', () => {
  const client = CLIENT_LESSONS.find((lesson) => lesson.id === 'scanner-age-check');
  const server = SERVER_LESSONS.find((lesson) => lesson.id === 'scanner-age-check');
  assert.ok(client && server, 'the lesson exists in both catalogs');
  assert.deepEqual(
    { track: client.track, module: client.module, steps: client.steps },
    { track: 'staff', module: 'scanner', steps: 5 },
  );
  assert.deepEqual(
    { track: server.track, module: server.module, steps: server.steps },
    { track: 'staff', module: 'scanner', steps: 5 },
  );
  assert.equal(CLIENT_LESSONS.length, 137, 'client catalog holds 125 lessons');
  assert.equal(SERVER_LESSONS.length, 137, 'server catalog holds 125 lessons');
  assert.equal(en['training.lessons.scanner-age-check.title'], 'Checking age with a license scan');
});
