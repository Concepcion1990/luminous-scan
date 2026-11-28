/**
 * T83 — EQUIPMENT RECORDS (Nov 26, 2026; plan release 372,
 * Gap 7). GENERAL, BOTH PLANS (the owner's Q3 ruling, Nov
 * 25, 2026: "do the same thing for every business" that has
 * machines).
 *
 *  - A page per machine: bought when, warranty end, who
 *    services it, and the identifying details the owner
 *    wants kept (cleanMachine).
 *  - Upkeep schedules with due reminders: owner-named
 *    tasks on owner-set cycles; the due state is computed
 *    (overdue / due-soon / ok), and marking a task done
 *    rolls its next due one full cycle past the done date.
 *  - Breakdown flow: staff report against the machine with
 *    a photo — the door rides the owner-grant tick
 *    `equipment.report` (owner and managers always hold
 *    it). Repair, cost and outcome join the machine's
 *    history; MONEY (purchase price, repair costs) is
 *    owner/manager territory, stripped server-side for
 *    everyone else.
 *
 *  TEST + RETEST — by name below: an upkeep task stands
 *  overdue, is marked done, and its next due rolls a full
 *  cycle ahead (state ok); a machine and a repair shaped
 *  for a staff reader carry no money, then shaped for a
 *  manager carry it exactly.
 *
 *  Keyset: 6256 + 76 = 6506 ×52, uniform. Training
 *  catalog: 123 + 1 = 125 (staff track, workforce module,
 *  GENERAL heading, 5 steps). Migration 061 (three
 *  tables). Registry: 539 + 6 = 545 wordings.
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
  BREAKDOWN_WHAT_MESSAGE,
  MANAGE_MESSAGE,
  NAME_MESSAGE,
  REPAIR_MESSAGE,
  REPORT_MESSAGE,
  UPKEEP_NAME_MESSAGE,
  canManageEquipment,
  canReportBreakdown,
  canSeeMoney,
  cleanBreakdown,
  cleanMachine,
  cleanRepair,
  cleanUpkeep,
  completeUpkeepDates,
  shapeEvent,
  shapeMachine,
  summarizeDue,
  upkeepDueState,
} from '../../server/equipmentCore.js';
import { EQUIPMENT_GRANTS, isEquipmentGrant, isMemberGrant } from '../../src/lib/staff.js';
import { SHELVES } from '../../src/lib/restaurantShelves.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.equipment', 'plansLib.includes.equipment',
  'staffLib.perm.equipmentReport', 'staffLib.area.equipmentAccess', 'staff.memberDialog.equipmentAccessHint',
  'restaurant.doorEquipment',
  'equipment.title', 'equipment.subtitle', 'equipment.machinesTitle', 'equipment.newMachine',
  'equipment.editMachine', 'equipment.nameLabel', 'equipment.kindLabel', 'equipment.makeModelLabel',
  'equipment.serialLabel', 'equipment.locationLabel', 'equipment.boughtLabel', 'equipment.priceLabel',
  'equipment.warrantyLabel', 'equipment.serviceNameLabel', 'equipment.servicePhoneLabel', 'equipment.notesLabel',
  'equipment.saveMachine', 'equipment.saved', 'equipment.saveFailed', 'equipment.emptyTitle',
  'equipment.emptyBody', 'equipment.dueTitle', 'equipment.allClear', 'equipment.dueLine',
  'equipment.overdue', 'equipment.dueSoon', 'equipment.nextDueLabel', 'equipment.upkeepTitle',
  'equipment.newUpkeep', 'equipment.upkeepNameLabel', 'equipment.cycleLabel', 'equipment.lastDoneLabel',
  'equipment.markDone', 'equipment.historyTitle', 'equipment.reportBreakdown', 'equipment.breakdownWhatLabel',
  'equipment.photoHint', 'equipment.submitReport', 'equipment.recordRepair', 'equipment.repairWhatLabel',
  'equipment.costLabel', 'equipment.outcomeLabel', 'equipment.saveRepair', 'equipment.statusOpen',
  'equipment.statusFixed', 'equipment.reportedBy', 'equipment.repairBy', 'equipment.warrantyUntil',
  'equipment.boughtOn', 'equipment.servicedBy', 'equipment.printButton', 'equipment.docTitle',
  'equipment.backButton', 'equipment.deleteMachine', 'equipment.deleteConfirm', 'equipment.manageHint',
  'equipment.noHistory', 'equipment.openBreakdowns',
  'apiErrors.equipmentManage', 'apiErrors.equipmentReport', 'apiErrors.equipmentName',
  'apiErrors.equipmentRepair', 'apiErrors.equipmentUpkeepName', 'apiErrors.equipmentBreakdownWhat',
  'training.lessons.staff-equipment.title', 'training.lessons.staff-equipment.step1',
  'training.lessons.staff-equipment.step2', 'training.lessons.staff-equipment.step3',
  'training.lessons.staff-equipment.step4', 'training.lessons.staff-equipment.step5',
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

test('the 76 new keys exist in all 52 locales and are not the key itself', () => {
  assert.equal(NEW_KEYS.length, 76);
  assert.equal(new Set(NEW_KEYS).size, 76);
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
    assert.ok(strings['equipment.dueLine'].includes('{task}') && strings['equipment.dueLine'].includes('{machine}'), `${code} dueLine`);
    assert.ok(strings['equipment.nextDueLabel'].includes('{date}'), `${code} nextDueLabel`);
    assert.ok(strings['equipment.warrantyUntil'].includes('{date}'), `${code} warrantyUntil`);
    assert.ok(strings['equipment.boughtOn'].includes('{date}'), `${code} boughtOn`);
    assert.ok(strings['equipment.servicedBy'].includes('{name}'), `${code} servicedBy`);
    assert.ok(strings['equipment.reportedBy'].includes('{name}') && strings['equipment.reportedBy'].includes('{time}'), `${code} reportedBy`);
    assert.ok(strings['equipment.repairBy'].includes('{name}') && strings['equipment.repairBy'].includes('{time}'), `${code} repairBy`);
    assert.ok(strings['equipment.openBreakdowns'].includes('{count}'), `${code} openBreakdowns`);
  }
});

test('the six new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(API_ERROR_MESSAGE_KEYS[MANAGE_MESSAGE], 'apiErrors.equipmentManage');
  assert.equal(API_ERROR_MESSAGE_KEYS[REPORT_MESSAGE], 'apiErrors.equipmentReport');
  assert.equal(API_ERROR_MESSAGE_KEYS[NAME_MESSAGE], 'apiErrors.equipmentName');
  assert.equal(API_ERROR_MESSAGE_KEYS[REPAIR_MESSAGE], 'apiErrors.equipmentRepair');
  assert.equal(API_ERROR_MESSAGE_KEYS[UPKEEP_NAME_MESSAGE], 'apiErrors.equipmentUpkeepName');
  assert.equal(API_ERROR_MESSAGE_KEYS[BREAKDOWN_WHAT_MESSAGE], 'apiErrors.equipmentBreakdownWhat');
  assert.equal(en['apiErrors.equipmentManage'], MANAGE_MESSAGE);
  assert.equal(en['apiErrors.equipmentReport'], REPORT_MESSAGE);
});

/* ------------------------------------------- plan presentation */

test('plan presentation: the line rides BOTH plans — Plans + Welcome Essentials lists and the matrix; the Business list does not repeat it', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.includes.equipment').length - 1, 3, 'referenced in Plans, Welcome and the matrix only');
  const line = en['plansLib.includes.equipment'];
  assert.ok(PLANS.essentials.includes.includes(line), 'Plans Essentials carries the line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(welcomeEssentials.includes.includes(line), 'Welcome Essentials carries the line');
  assert.ok(!PLANS.business.includes.includes(line), 'Business list does not repeat an Essentials line (the Nov 19 dedupe ruling)');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === true && row.business === true, 'matrix row is both-plans');
});

/* ------------------------------------------------ training */

test('training catalogs agree at 125 and the lesson is a staff workforce lesson under the GENERAL heading', () => {
  assert.equal(CLIENT_LESSONS.length, 139);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'staff-equipment');
  assert.ok(lesson, 'lesson exists');
  assert.equal(lesson.track, 'staff');
  assert.equal(lesson.module, 'workforce');
  assert.equal(lesson.heading, 'general');
  assert.equal(lesson.steps, 5);
  assert.ok(!lesson.feature, 'a general lesson carries no plan feature gate');
  assert.ok(en['training.lessons.staff-equipment.title']);
});

/* ------------------------------------------------ the tick */

const owner = { isOwner: true, permissions: [], staffRow: null };
const manager = { isOwner: false, permissions: [], staffRow: { role_id: 'preset-manager', role_name: 'Manager' } };
const staffPlain = { isOwner: false, permissions: [], staffRow: { role_id: 'preset-staff', role_name: 'Staff' } };
const staffTicked = { isOwner: false, permissions: ['equipment.report'], staffRow: { role_id: 'preset-staff', role_name: 'Staff' } };

test('the breakdown door: owner and managers always hold it; staff hold it only with the tick, which rides no preset', () => {
  assert.deepEqual(EQUIPMENT_GRANTS.map((g) => g.key), ['equipment.report']);
  assert.ok(isEquipmentGrant('equipment.report'));
  assert.ok(isMemberGrant('equipment.report'), 'the dialog keeps the tick through saves');
  assert.equal(canReportBreakdown(owner), true);
  assert.equal(canReportBreakdown(manager), true);
  assert.equal(canReportBreakdown(staffTicked), true);
  assert.equal(canReportBreakdown(staffPlain), false);
  assert.equal(canManageEquipment(owner), true);
  assert.equal(canManageEquipment(manager), true);
  assert.equal(canManageEquipment(staffTicked), false, 'the tick opens ONLY the reporting door — never the machine pages');
  assert.equal(canSeeMoney(staffTicked), false);
  assert.equal(canSeeMoney(manager), true);
});

/* ------------------------------------------- machine cleaning */

test('cleanMachine: a machine page needs a name; dates and money are cleaned, never invented', () => {
  assert.throws(() => cleanMachine({ name: '  ' }), (e) => e.message === NAME_MESSAGE);
  const m = cleanMachine({
    name: ' Walk-in fridge ', kind: 'Refrigeration', purchased_date: '2024-03-01',
    purchase_price: '2400.5', warranty_end: '2027-03-01', service_name: 'ColdCo',
  });
  assert.equal(m.name, 'Walk-in fridge');
  assert.equal(m.purchase_price, 2400.5);
  assert.equal(m.purchased_date, '2024-03-01');
  const bare = cleanMachine({ name: 'Oven', purchased_date: 'not-a-date', purchase_price: '' });
  assert.equal(bare.purchased_date, null);
  assert.equal(bare.purchase_price, null, 'no price typed, no price stored');
});

/* ------------------------------------------- upkeep battery */

test('TEST: an upkeep task stands overdue, and the due list names it worst-first', () => {
  const task = { machine_id: 'm1', ...cleanUpkeep({ title: 'Hood cleaning', cycle_days: 90, last_done_date: '2026-08-01' }, '2026-08-01') };
  assert.equal(task.next_due_date, '2026-10-30', 'next due = last done + the owner-set cycle');
  assert.equal(upkeepDueState(task, '2026-11-26'), 'overdue');
  assert.equal(upkeepDueState(task, '2026-10-25'), 'due-soon');
  assert.equal(upkeepDueState(task, '2026-09-01'), 'ok');
  const due = summarizeDue([{ id: 'm1', name: 'Hood' }], [task, { ...task, title: 'Later', next_due_date: '2027-01-01' }], '2026-11-26');
  assert.equal(due.length, 1, 'only the due task is listed');
  assert.equal(due[0].machine_name, 'Hood');
  assert.equal(due[0].due_state, 'overdue');
});

test('RETEST: after the task is marked done, its next due rolls one full cycle ahead and it leaves the due list', () => {
  const task = cleanUpkeep({ title: 'Hood cleaning', cycle_days: 90, last_done_date: '2026-08-01' }, '2026-08-01');
  const done = { ...task, ...completeUpkeepDates(task, '2026-11-26') };
  assert.equal(done.last_done_date, '2026-11-26');
  assert.equal(done.next_due_date, '2027-02-24', 'done date + the full cycle');
  assert.equal(upkeepDueState(done, '2026-11-26'), 'ok');
  assert.deepEqual(summarizeDue([{ id: 'm1', name: 'Hood' }], [done], '2026-11-26'), []);
  assert.throws(() => cleanUpkeep({ title: '' }), (e) => e.message === UPKEEP_NAME_MESSAGE);
});

/* ------------------------------------------- breakdown + money */

test('cleanBreakdown: what broke is required; a photo must be a real attached image', () => {
  assert.throws(() => cleanBreakdown({ description: '' }), (e) => e.message === BREAKDOWN_WHAT_MESSAGE);
  assert.throws(() => cleanBreakdown({ description: 'Fan stopped', photo: 'https://x/y.png' }), (e) => e.message === BREAKDOWN_WHAT_MESSAGE);
  const ok = cleanBreakdown({ description: 'Fan stopped', photo: 'data:image/jpeg;base64,AAAA' });
  assert.equal(ok.photo, 'data:image/jpeg;base64,AAAA');
  assert.equal(cleanBreakdown({ description: 'Fan stopped' }).photo, null, 'a report without a photo still stands');
});

test('TEST + RETEST: money is stripped for a staff reader and exact for a manager — machine price and repair cost', () => {
  const machine = { id: 'm1', name: 'Oven', purchase_price: 3200 };
  const repair = { id: 'e1', kind: 'repair', description: 'New element', cost: 145.5 };
  const staffView = shapeMachine(machine, { money: canSeeMoney(staffTicked) });
  assert.equal(staffView.purchase_price, null, 'TEST: a staff reader never receives the price');
  assert.equal(shapeEvent(repair, { money: false }).cost, null, 'TEST: nor a repair cost');
  const managerView = shapeMachine(machine, { money: canSeeMoney(manager) });
  assert.equal(managerView.purchase_price, 3200, 'RETEST: the manager reads the exact figure');
  assert.equal(shapeEvent(repair, { money: true }).cost, 145.5);
  const clean = cleanRepair({ description: 'New element', cost: '145.50', outcome: 'Heats again' });
  assert.equal(clean.cost, 145.5);
  assert.equal(cleanRepair({ description: 'Checked', cost: '' }).cost, null, 'no cost recorded, no cost invented');
});

/* ------------------------------------------- wiring pins */

test('migration 061, the wipe sweep, the router mount and both-plans wiring are in place', () => {
  const migration = read('migrations/061_equipment.sql');
  for (const table of ['equipment_machines', 'equipment_upkeep', 'equipment_events']) {
    assert.ok(migration.includes(table), table);
    assert.ok(read('server/billing.js').includes(`DELETE FROM ${table} WHERE business_id = $1`), `wipe sweep ${table}`);
  }
  assert.ok(!/REFERENCES/i.test(migration), 'no foreign key (the migration-017 lesson)');
  assert.ok(read('server/app.js').includes('createEquipmentRouter'), 'router mounted');
  const routes = read('server/equipmentRoutes.js');
  assert.ok(!routes.includes('featureAllowed'), 'no plan gate anywhere in the surface (both plans)');
  assert.ok(routes.includes('canReportBreakdown(access)'), 'the breakdown door is enforced');
  assert.ok(routes.includes('REPAIR_MESSAGE'), 'repairs refuse outside owner/manager territory');
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/equipment"'));
  assert.ok(!app.includes('PlanRedirect feature="equipment"'), 'the route carries no plan redirect');
});

test('the doors: main nav, the Team & Place cross-link, the member-dialog tick block', () => {
  assert.ok(read('src/components/layout/navGroups.js').includes("to: '/equipment'"), 'main navigation door');
  const team = SHELVES.find((s) => s.id === 'team');
  assert.ok(team.doors.some((d) => d.to === '/equipment' && d.crossLink), 'Team & Place cross-links to the general home');
  const dialog = read('src/components/staff/StaffMemberDialog.jsx');
  assert.ok(dialog.includes('EQUIPMENT_GRANTS') && dialog.includes('equipment_grants'), 'the tick block rides the member dialog');
});

test('the printed record is a Studio document (preview = print)', () => {
  const doc = read('src/components/print/EquipmentDoc.jsx');
  assert.ok(doc.includes('DocFrame') && doc.includes('docRootStyle'), 'Studio frame + style');
  assert.ok(doc.includes("t('equipment.docTitle')"));
  assert.ok(read('src/pages/Equipment.jsx').includes('EquipmentDoc'), 'the page shows the document it prints');
});
