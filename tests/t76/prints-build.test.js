/**
 * T76 — the PRINTS BUILD (Nov 25, 2026): the 17 papers.
 *
 *  8 filled record prints as Studio documents (PREVIEW =
 *  PRINT): the weekly staff schedule, the payroll register,
 *  the timesheet, the training record, Business Policies &
 *  Terms (the owner's own words, printed exactly as written),
 *  the staff roster, the product & price list and the supplier
 *  directory — plus the filled temperature log for the
 *  food-safety file, whose blank twin shipped in 368.
 *  8 blank hand-fill twins in the Print Center, one per record
 *  paper, for EVERYONE on both plans (the 368 pattern).
 *
 *  Gating law: a print never widens who can see the record —
 *  each filled door lives on its record's own page/section and
 *  follows that surface's existing plan/tick/visibility. The
 *  schedule prints the Schedule tab's own candidates; the
 *  timesheet prints the loaded entries; the register prints
 *  the preview its viewer ran; the supplier directory lives
 *  only on the Business-gated Suppliers page; the filled
 *  temperature log only on the Corner's temp-logs page.
 *
 *  Every paper is a Studio document: the business's saved
 *  document style, its own language, and the owner's picked
 *  date format (formatBusinessDate — the 382 Studio scope).
 *
 *  Keyset: 5913 + 18 = 5931 ×52, uniform (five paper titles,
 *  the policies file note, five field/column labels, the
 *  record-prints plan line, and the staff-record-prints
 *  lesson's title + five steps). Two Business plan lines grew
 *  by a phrase each (the supplier directory on the suppliers
 *  line; filled-in temperature logs on the safety line).
 *  Training catalog: 116 + 1 = 117 lessons (staff track,
 *  printing module, 5 steps), client and server in agreement.
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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'print.payrollRegisterTitle',
  'print.timesheetTitle',
  'print.staffRosterTitle',
  'print.priceListTitle',
  'print.supplierDirectoryTitle',
  'print.policiesFileNote',
  'print.fieldWeekOf',
  'print.fieldPeriod',
  'print.colHours',
  'print.colLesson',
  'print.colScore',
  'plansLib.includes.recordPrints',
  'training.lessons.staff-record-prints.title',
  'training.lessons.staff-record-prints.step1',
  'training.lessons.staff-record-prints.step2',
  'training.lessons.staff-record-prints.step3',
  'training.lessons.staff-record-prints.step4',
  'training.lessons.staff-record-prints.step5',
];

/* ------------------------------------------------ i18n gate */

test('keyset stands at 6027 in all 52 locales, uniform', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  const enKeys = Object.keys(LOCALES.en).sort();
  assert.equal(enKeys.length, 6027);
  for (const code of codes) {
    assert.equal(Object.keys(LOCALES[code]).length, 6027, `${code} keyset`);
    assert.deepEqual(Object.keys(LOCALES[code]).sort(), enKeys, `${code} keyset differs from en`);
  }
});

test('the 18 new keys exist in all 52 locales and are not the key itself', () => {
  for (const [code, strings] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof strings[key] === 'string' && strings[key].length > 1, `${code} missing ${key}`);
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

test('the two Business plan lines grew their phrases in all 52 locales', () => {
  assert.ok(en['plansLib.businessIncludes.suppliers'].endsWith('and a printed supplier directory'));
  assert.ok(en['plansLib.businessIncludes.restaurantSafety'].endsWith('filled-in temperature logs for the food-safety file'));
  for (const [code, strings] of Object.entries(LOCALES)) {
    if (code === 'en' || code.startsWith('en-')) continue;
    // Every other locale's lines are its own translation of the
    // grown line — never the English line verbatim.
    assert.notEqual(strings['plansLib.businessIncludes.suppliers'], en['plansLib.businessIncludes.suppliers'], `${code} suppliers line is English`);
    assert.notEqual(strings['plansLib.businessIncludes.restaurantSafety'], en['plansLib.businessIncludes.restaurantSafety'], `${code} safety line is English`);
  }
});

/* ------------------------------------------- plan presentation */

test('plan presentation: the record-prints line rides Essentials on Plans + Welcome + the matrix, and Business does not repeat it', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.includes.recordPrints').length - 1, 3, 'the line is referenced exactly three times: Plans list, Welcome list, comparison matrix');
  assert.ok(plans.includes("{ get label() { return t('plansLib.includes.recordPrints'); }"), 'the comparison matrix row exists');
  const line = en['plansLib.includes.recordPrints'];
  assert.ok(PLANS.essentials.includes.includes(line), 'Plans Essentials list carries the line');
  const welcomeEssentials = WELCOME_OPTIONS.find((option) => option.key === 'essentials');
  assert.ok(welcomeEssentials.includes.includes(line), 'Welcome Essentials list carries the line');
  assert.ok(!PLANS.business.includes.includes(line), 'Business list does not repeat an Essentials line (the Nov 19 dedupe ruling)');
});

/* ------------------------------------------------- the papers */

const DOC_FIELDS = {
  'src/components/print/WorkforceDocs.jsx': [
    "t('workforce.schedule.title')", "t('workforce.schedule.person')", "t('workforce.schedule.off')",
    'weekdayLabel', 'formatHhmm',
    "t('print.timesheetTitle')", "t('payroll.hours.breaks')", "t('print.colHours')",
    "t('workforce.entries.calledIn')", "t('workforce.entries.unscheduled')",
    "t('workforce.entries.missedClockOut')", "t('workforce.entries.early')",
    'formatBusinessDate', 'docRootClass', 'PrintedAt',
  ],
  'src/components/print/PayrollRegisterDoc.jsx': [
    "t('print.payrollRegisterTitle')", "'payroll.stubs.period'",
    "t('payroll.hours.regular')", "t('payroll.hours.overtime')", "t('payroll.hours.breaks')",
    "t('payroll.gross')", "t('payroll.deductions')", "t('payroll.net')",
    "t('ops.invoices.colTotal')", 'formatBusinessDate', 'formatMoney',
  ],
  'src/components/print/TrainingRecordDoc.jsx': [
    "t('training.team.record')", "'training.lessonsDoneOf'",
    "t('print.colLesson')", "t('print.colScore')",
    "'training.team.scoreOf'", "t('training.team.passed')", "t('training.team.notPassed')",
    "t('training.team.recordPolicy')", "'training.warningSentOn'", 'formatBusinessDate',
  ],
  'src/components/print/PoliciesDoc.jsx': [
    "t('settings.policies.title')", "t('settings.policies.storePolicies')",
    "t('settings.policies.termsConditions')", "'print.policiesFileNote'",
    'whitespace-pre-line',
  ],
  'src/components/print/RosterDoc.jsx': [
    "t('print.staffRosterTitle')", "t('staff.memberDialog.nameLabel')",
    "t('staff.memberDialog.roleLabel')", "t('staff.memberDialog.emailLabel')",
    "t('print.fieldLocation')", "t('ops.invoices.colStatus')", 'statusMeta', 'roleById',
  ],
  'src/components/print/PriceListDoc.jsx': [
    "t('print.priceListTitle')", "t('print.colProductName')", '>SKU<',
    "t('products.sortCategory')", "t('products.sortPrice')", 'formatMoney',
  ],
  'src/components/print/SupplierDirectoryDoc.jsx': [
    "t('print.supplierDirectoryTitle')", "t('suppliers.supplierName')", "t('suppliers.contact')",
    "t('suppliers.phone')", "t('suppliers.email')", "t('suppliers.accountNumberLabel')",
  ],
  'src/components/print/TempLogDoc.jsx': [
    "t('ops.tempLogs.title')", "t('ops.tempLogs.colWhen')", "t('ops.tempLogs.colUnit')",
    "t('ops.tempLogs.colReading')", "t('ops.tempLogs.colRange')", "t('ops.tempLogs.colBy')",
    "t('ops.tempLogs.inRange')", "t('ops.tempLogs.outOfRange')", "'ops.tempLogs.correctivePrefix'",
    'formatBusinessDate',
  ],
};

test('the eight filled papers carry their audit fields, as Studio documents', () => {
  for (const [file, needles] of Object.entries(DOC_FIELDS)) {
    const source = read(file);
    for (const needle of needles) assert.ok(source.includes(needle), `${file} missing ${needle}`);
    assert.ok(source.includes('DocFrame') && source.includes('DecoHeader') && source.includes('DecoFooter'), `${file} is not framed as a Studio document`);
  }
});

/* ---------------------------------------------------- the doors */

test('every filled door is wired on its record\u2019s own page, in the print-area pattern', () => {
  const workforce = read('src/pages/Workforce.jsx');
  assert.ok(workforce.includes('ScheduleDoc') && workforce.includes('TimesheetDoc'), 'Workforce renders both papers');
  assert.ok(workforce.includes('people={candidates}'), 'the schedule prints the tab\u2019s own candidates — nobody wider');
  assert.ok(workforce.includes('entries.slice(0, 30)'), 'the timesheet prints the loaded entries the screen shows');
  assert.ok(workforce.includes('showNames={ctx.level !== \'staff\'}'), 'timesheet names follow the screen\u2019s own rule');

  const payroll = read('src/pages/Payroll.jsx');
  assert.ok(payroll.includes('PayrollRegisterDoc'), 'Payroll renders the register');
  assert.ok(payroll.includes('row.gross - row.net'), 'the register\u2019s deductions are gross − net from the preview');

  const training = read('src/pages/Training.jsx');
  assert.ok(training.includes('TrainingRecordDoc'), 'Training renders the record');
  assert.ok(training.includes('getTeamMemberResults(businessId, person.staff_id)'), 'the record fetches each person\u2019s filed results at print time');

  const policiesCard = read('src/components/business/BusinessPoliciesCard.jsx');
  assert.ok(policiesCard.includes('PoliciesDoc'), 'the policies card renders the paper');
  assert.ok(policiesCard.includes("docs.policies.kind !== 'empty' || docs.terms.kind !== 'empty'"), 'the policies door appears only when something is written');

  const staff = read('src/pages/Staff.jsx');
  assert.ok(staff.includes('RosterDoc'), 'Staff renders the roster');

  const products = read('src/pages/Products.jsx');
  assert.ok(products.includes('PriceListDoc'), 'Products renders the price list');
  assert.ok(products.includes("product.status !== 'archived'"), 'archived products never reach the price list');

  const suppliers = read('src/pages/Suppliers.jsx');
  assert.ok(suppliers.includes('SupplierDirectoryDoc'), 'Suppliers renders the directory');

  const tempLogs = read('src/pages/RestaurantTempLogs.jsx');
  assert.ok(tempLogs.includes('TempLogDoc'), 'the temp-logs page renders the filled log');
});

test('the Business-only papers live only on their Business-gated pages', () => {
  const pages = [
    'src/pages/Workforce.jsx', 'src/pages/Payroll.jsx', 'src/pages/Training.jsx',
    'src/pages/Staff.jsx', 'src/pages/Products.jsx', 'src/pages/PrintCenter.jsx',
  ];
  for (const page of pages) {
    const source = read(page);
    assert.ok(!source.includes('SupplierDirectoryDoc'), `${page} must not carry the supplier directory`);
    assert.ok(!source.includes('TempLogDoc'), `${page} must not carry the filled temperature log`);
  }
});

/* ---------------------------------------------- the blank twins */

test('the blank twins: all eight kinds registered, ungated, with the policies sections path', () => {
  const blank = read('src/components/print/BlankFormDoc.jsx');
  for (const kind of ['schedule', 'timesheet', 'payroll', 'training', 'policies', 'roster', 'pricelist', 'suppliers']) {
    assert.ok(blank.includes(`{ key: '${kind}'`), `blank kind ${kind} not registered`);
  }
  assert.ok(blank.includes('FORM_SECTIONS'), 'the sectioned-blank path exists');
  assert.ok(blank.includes("['settings.policies.storePolicies', 12]"), 'policies blank carries the store-policies section');
  assert.ok(blank.includes("['settings.policies.termsConditions', 12]"), 'policies blank carries the terms section');
  assert.ok(!blank.includes('useEntitlements') && !blank.includes('isBusiness') && !blank.includes('can('), 'a blank form carries no plan gate — blanks are for everyone');
  const center = read('src/pages/PrintCenter.jsx');
  assert.ok(center.includes('BLANK_FORMS.map'), 'the Print Center maps the registry generically');
  assert.ok(center.includes('<BlankFormDoc kind={blankKind}'), 'the Print Center renders the picked blank');
});

/* ---------------------------------------------------- training */

test('the staff-record-prints lesson rides: staff track, printing module, five steps, catalogs in agreement', () => {
  const client = CLIENT_LESSONS.find((lesson) => lesson.id === 'staff-record-prints');
  const server = SERVER_LESSONS.find((lesson) => lesson.id === 'staff-record-prints');
  assert.ok(client && server, 'the lesson exists in both catalogs');
  assert.deepEqual(
    { track: client.track, module: client.module, steps: client.steps },
    { track: 'staff', module: 'printing', steps: 5 },
  );
  assert.deepEqual(
    { track: server.track, module: server.module, steps: server.steps },
    { track: 'staff', module: 'printing', steps: 5 },
  );
  assert.equal(CLIENT_LESSONS.length, 120, 'client catalog holds 120 lessons');
  assert.equal(SERVER_LESSONS.length, 120, 'server catalog holds 120 lessons');
  assert.equal(en['training.lessons.staff-record-prints.title'], 'Your records on paper');
});
