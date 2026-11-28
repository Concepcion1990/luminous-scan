/**
 * T80 — the CHECKLISTS BUILD (Nov 26, 2026; plan release 369,
 * Gap 2; the owner's Q1 ruling, Nov 24, 2026: a GENERAL
 * feature for EVERY business on BOTH plans — "Do it for
 * everyone").
 *
 *  (1) THE ENGINE: owner-built templates (opening, closing,
 *      cleaning, anything else) + starter templates; a
 *      template is a named list of items; key items can
 *      require PROOF — a photo, a scan, or a typed
 *      temperature — before they can be ticked.
 *  (2) ASSIGNMENT by role or by shift; schedules daily /
 *      weekly / once materialise instances with the items
 *      snapshot, so editing a template never rewrites a day
 *      that already happened.
 *  (3) TICK-OFF: staff tick items off recording WHO and WHEN
 *      for every item. Ticking off is plain staff work — no
 *      tick needed. Template management rides the owner-grant
 *      tick `checklists.manage`, off by default, in no preset.
 *  (4) COMPLETION HISTORY: a manager can check from home what
 *      got done, by whom, and what's missing — today's state
 *      surfaces on the business home (Dashboard card) and on
 *      the Restaurant Corner's Team & Place shelf + Today page.
 *
 *  TEST + RETEST — by name below: build → schedule → tick
 *  (with proof) → history, then the retest: a template edit
 *  does not rewrite yesterday's snapshot; a proof-less tick
 *  on a proof item is refused; cross-business rows are
 *  invisible; an unticked manager cannot write templates.
 *
 *  Keyset: 6027 + 73 = 6100 ×52, uniform. Training catalog:
 *  120 + 1 = 121 (staff track, workforce module, GENERAL
 *  heading, 5 steps). Migration 058 (checklist_templates /
 *  checklist_instances / checklist_completions).
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
import { API_ERROR_MESSAGE_KEYS } from '../../src/lib/apiErrors.js';
import { CHECKLISTS_GRANTS, isChecklistsGrant, isMemberGrant, ALL_PERMISSIONS, PRESET_ROLES } from '../../src/lib/staff.js';
import {
  ITEMS_MESSAGE,
  MANAGE_MESSAGE,
  NAME_MESSAGE,
  PROOF_MESSAGE,
  canManageChecklists,
  cleanProofFor,
  cleanRunDate,
  cleanTemplate,
  completeItem,
  createTemplate,
  dayView,
  deleteTemplate,
  ensureInstances,
  historyView,
  listTemplates,
  shapeInstance,
  summarizeInstances,
  templateRunsOn,
  uncompleteItem,
  updateTemplate,
} from '../../server/checklistsCore.js';
import { summarizeToday } from '../../src/lib/restaurantShelves.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.checklists', 'plansLib.includes.checklists',
  'staffLib.perm.checklistsManage', 'staffLib.area.checklistsAccess',
  'staff.memberDialog.checklistsAccessHint',
  'restaurant.doorChecklists', 'restaurant.today.checklists', 'restaurant.today.checklistsAllDone',
  'checklists.title', 'checklists.subtitle', 'checklists.todayTitle', 'checklists.templatesTitle',
  'checklists.historyTitle', 'checklists.newTemplate', 'checklists.editTemplate', 'checklists.templateName',
  'checklists.assignLabel', 'checklists.assignEveryone', 'checklists.assignRole', 'checklists.assignShift',
  'checklists.shiftName', 'checklists.scheduleLabel', 'checklists.scheduleDaily', 'checklists.scheduleWeekly',
  'checklists.scheduleOnce', 'checklists.itemsLabel', 'checklists.itemPlaceholder', 'checklists.addItem',
  'checklists.itemCount', 'checklists.proofLabel', 'checklists.proofNone', 'checklists.proofPhoto',
  'checklists.proofScan', 'checklists.proofTemperature', 'checklists.saveTemplate', 'checklists.deleteConfirm',
  'checklists.saved', 'checklists.saveFailed', 'checklists.todayEmpty', 'checklists.templatesEmpty',
  'checklists.historyEmpty', 'checklists.progress', 'checklists.allDone', 'checklists.doneBy',
  'checklists.proofPhotoHint', 'checklists.proofScanHint', 'checklists.proofTempHint', 'checklists.proofNeeded',
  'checklists.addStarters', 'checklists.manageHint',
  'checklists.starterOpening', 'checklists.starterClosing', 'checklists.starterCleaning',
  'checklists.starterOpeningItem1', 'checklists.starterOpeningItem2', 'checklists.starterOpeningItem3',
  'checklists.starterClosingItem1', 'checklists.starterClosingItem2', 'checklists.starterClosingItem3',
  'checklists.starterCleaningItem1', 'checklists.starterCleaningItem2', 'checklists.starterCleaningItem3',
  'apiErrors.checklistsManage', 'apiErrors.checklistProof', 'apiErrors.checklistName',
  'apiErrors.checklistItems', 'apiErrors.checklistUntick',
  'training.lessons.staff-checklists.title',
  'training.lessons.staff-checklists.step1', 'training.lessons.staff-checklists.step2',
  'training.lessons.staff-checklists.step3', 'training.lessons.staff-checklists.step4',
  'training.lessons.staff-checklists.step5',
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

test('the 73 new keys exist in all 52 locales and are not the key itself', () => {
  assert.equal(NEW_KEYS.length, 73);
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

test('the five new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(API_ERROR_MESSAGE_KEYS[MANAGE_MESSAGE], 'apiErrors.checklistsManage');
  assert.equal(API_ERROR_MESSAGE_KEYS[PROOF_MESSAGE], 'apiErrors.checklistProof');
  assert.equal(API_ERROR_MESSAGE_KEYS[NAME_MESSAGE], 'apiErrors.checklistName');
  assert.equal(API_ERROR_MESSAGE_KEYS[ITEMS_MESSAGE], 'apiErrors.checklistItems');
  assert.equal(
    API_ERROR_MESSAGE_KEYS['Only the person who ticked this item, a manager, or the owner can untick it.'],
    'apiErrors.checklistUntick',
  );
  assert.equal(en['apiErrors.checklistsManage'], MANAGE_MESSAGE);
  assert.equal(en['apiErrors.checklistProof'], PROOF_MESSAGE);
});

/* ------------------------------------------- plan presentation */

test('plan presentation: the checklists line rides Essentials on Plans + Welcome + the matrix, and Business does not repeat it', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.includes.checklists').length - 1, 3, 'the line is referenced exactly three times: Plans list, Welcome list, comparison matrix');
  const line = en['plansLib.includes.checklists'];
  assert.ok(PLANS.essentials.includes.includes(line), 'Plans Essentials list carries the line');
  const welcomeEssentials = WELCOME_OPTIONS.find((option) => option.key === 'essentials');
  assert.ok(welcomeEssentials.includes.includes(line), 'Welcome Essentials list carries the line');
  assert.ok(!PLANS.business.includes.includes(line), 'Business list does not repeat an Essentials line (the Nov 19 dedupe ruling)');
});

/* ------------------------------------------------- the lesson */

test('catalogs stand at 125, client and server JSON-identical', () => {
  assert.equal(CLIENT_LESSONS.length, 132);
  assert.equal(SERVER_LESSONS.length, 132);
  assert.equal(JSON.stringify(CLIENT_LESSONS), JSON.stringify(SERVER_LESSONS), 'the two catalogs agree exactly');
});

test('the new lesson: staff-checklists, staff track, workforce module, GENERAL heading, 5 steps', () => {
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'staff-checklists');
  assert.ok(lesson, 'the lesson exists');
  assert.deepEqual(
    { track: lesson.track, module: lesson.module, heading: lesson.heading, steps: lesson.steps },
    { track: 'staff', module: 'workforce', heading: 'general', steps: 5 },
  );
});

/* ------------------------------------------- the grant tick */

test('the grant tick: checklists.manage exists, is a member grant, and rides NO preset and NO permission catalog', () => {
  assert.deepEqual(CHECKLISTS_GRANTS.map((g) => g.key), ['checklists.manage']);
  assert.ok(isChecklistsGrant('checklists.manage'));
  assert.ok(isMemberGrant('checklists.manage'), 'the member dialog keeps the tick through permission edits');
  assert.ok(!ALL_PERMISSIONS.includes('checklists.manage'), 'not part of the permission catalog');
  for (const role of PRESET_ROLES) {
    assert.ok(!role.permissions.includes('checklists.manage'), `preset ${role.id} does not carry the tick — off by default`);
  }
  // The canManage test: owner always; a ticked member yes; an
  // unticked member (even a manager role) no.
  assert.equal(canManageChecklists({ isOwner: true, permissions: [] }), true);
  assert.equal(canManageChecklists({ isOwner: false, permissions: ['checklists.manage'] }), true);
  assert.equal(canManageChecklists({ isOwner: false, permissions: ['staff.manage'] }), false);
  assert.equal(canManageChecklists(null), false);
});

/* ------------------------------------------- pure engine rules */

test('cleanTemplate: a name and at least one item, with the registered wordings', () => {
  assert.throws(() => cleanTemplate({ items: [{ label: 'x' }] }), (e) => e.message === NAME_MESSAGE && e.code === 'checklist_name');
  assert.throws(() => cleanTemplate({ name: 'Opening', items: [] }), (e) => e.message === ITEMS_MESSAGE && e.code === 'checklist_items');
  const clean = cleanTemplate({
    name: ' Opening ',
    items: [{ label: ' Unlock ', proof: 'photo' }, { label: '', proof: 'none' }, { label: 'Till', proof: 'bogus' }],
    assign_type: 'shift', assign_value: ' Morning ', schedule: 'weekly', weekday: 3,
  });
  assert.equal(clean.name, 'Opening');
  assert.deepEqual(clean.items.map((i) => [i.label, i.proof]), [['Unlock', 'photo'], ['Till', 'none']], 'blank items drop; unknown proof falls back to none');
  assert.equal(clean.assign_value, 'Morning');
  assert.equal(clean.weekday, 3);
});

test('templateRunsOn: daily, weekly by weekday, once by start date — and never before a start date', () => {
  const daily = { schedule: 'daily', active: true };
  assert.ok(templateRunsOn(daily, '2026-11-26'));
  const weekly = { schedule: 'weekly', active: true, weekday: 4, start_date: '2026-11-05' }; // 2026-11-05 is a Thursday
  assert.ok(templateRunsOn(weekly, '2026-11-26'), '2026-11-26 is a Thursday');
  assert.ok(!templateRunsOn(weekly, '2026-11-27'), 'a Friday is not the weekly day');
  assert.ok(!templateRunsOn(weekly, '2026-10-29'), 'never before its start date, even on the weekday');
  const once = { schedule: 'once', active: true, start_date: '2026-12-01' };
  assert.ok(templateRunsOn(once, '2026-12-01'));
  assert.ok(!templateRunsOn(once, '2026-12-02'));
  assert.ok(!templateRunsOn({ schedule: 'daily', active: false }, '2026-11-26'), 'an inactive template never runs');
  assert.equal(cleanRunDate('2026-02-30'), null, 'a date that does not exist is refused');
  assert.equal(cleanRunDate('2026-11-26'), '2026-11-26');
});

test('cleanProofFor: proof items refuse a tick without their proof, with the registered wording', () => {
  assert.deepEqual(cleanProofFor({ proof: 'none' }, 'whatever'), { proof_type: 'none', proof_value: null });
  assert.deepEqual(cleanProofFor({ proof: 'scan' }, ' SHP-ABC '), { proof_type: 'scan', proof_value: 'SHP-ABC' });
  assert.deepEqual(cleanProofFor({ proof: 'temperature' }, '38.5'), { proof_type: 'temperature', proof_value: '38.5' });
  const photo = `data:image/jpeg;base64,${'A'.repeat(200)}`;
  assert.deepEqual(cleanProofFor({ proof: 'photo' }, photo), { proof_type: 'photo', proof_value: photo });
  for (const [item, value] of [
    [{ proof: 'scan' }, ''],
    [{ proof: 'temperature' }, 'warm'],
    [{ proof: 'temperature' }, ''],
    [{ proof: 'photo' }, 'not-a-photo'],
    [{ proof: 'photo' }, ''],
  ]) {
    assert.throws(() => cleanProofFor(item, value), (e) => e.message === PROOF_MESSAGE && e.code === 'checklist_proof');
  }
});

test('shapeInstance + summarizeInstances: progress a manager reads at a glance', () => {
  const instance = shapeInstance(
    { id: 'i1', items: [{ id: 'a', label: 'A', proof: 'none' }, { id: 'b', label: 'B', proof: 'scan' }] },
    [{ item_id: 'a', completed_by_name: 'Ana', completed_at: '2026-11-26T15:00:00Z', proof_type: 'none', proof_value: null }],
  );
  assert.equal(instance.done, 1);
  assert.equal(instance.total, 2);
  assert.equal(instance.complete, false);
  assert.equal(instance.items[0].completion.by_name, 'Ana', 'WHO rides every tick');
  assert.equal(instance.items[0].completion.at, '2026-11-26T15:00:00Z', 'WHEN rides every tick');
  assert.equal(instance.items[1].completion, null, 'what is missing stands unticked');
  assert.deepEqual(summarizeInstances([instance, { done: 2, total: 2 }]), { done: 3, total: 4, lists: 2 });
});

/* ------------------------------------- a fake pool (no live DB) */

function fakePool() {
  const state = { templates: [], instances: [], completions: [] };
  const runQuery = (sql, params = []) => {
    if (/INSERT INTO checklist_templates/i.test(sql)) {
      const [id, business_id, name, items, assign_type, assign_value, schedule, weekday, start_date, active, created_by_id] = params;
      const row = { id, business_id, name, items, assign_type, assign_value, schedule, weekday, start_date, active, created_by_id, created_at: '2026-11-26T00:00:00Z' };
      state.templates.push(row);
      return { rows: [row] };
    }
    if (/SELECT \* FROM checklist_templates WHERE business_id/i.test(sql)) {
      return { rows: state.templates.filter((r) => r.business_id === params[0]) };
    }
    if (/SELECT \* FROM checklist_templates WHERE id/i.test(sql)) {
      return { rows: state.templates.filter((r) => r.id === params[0] && r.business_id === params[1]) };
    }
    if (/UPDATE checklist_templates/i.test(sql)) {
      const [name, items, assign_type, assign_value, schedule, weekday, start_date, active, id, business_id] = params;
      const row = state.templates.find((r) => r.id === id && r.business_id === business_id);
      Object.assign(row, { name, items, assign_type, assign_value, schedule, weekday, start_date, active });
      return { rows: [row] };
    }
    if (/DELETE FROM checklist_templates/i.test(sql)) {
      const before = state.templates.length;
      state.templates = state.templates.filter((r) => !(r.id === params[0] && r.business_id === params[1]));
      return { rows: [], rowCount: before - state.templates.length };
    }
    if (/INSERT INTO checklist_instances/i.test(sql)) {
      const [id, business_id, template_id, title, items, assign_type, assign_value, run_date] = params;
      if (!state.instances.some((r) => r.template_id === template_id && r.run_date === run_date)) {
        state.instances.push({ id, business_id, template_id, title, items, assign_type, assign_value, run_date, created_at: '2026-11-26T00:00:00Z' });
      }
      return { rows: [] };
    }
    if (/SELECT \* FROM checklist_instances WHERE business_id/i.test(sql)) {
      return { rows: state.instances.filter((r) => r.business_id === params[0] && r.run_date === params[1]) };
    }
    if (/SELECT \* FROM checklist_instances WHERE id/i.test(sql)) {
      return { rows: state.instances.filter((r) => r.id === params[0] && r.business_id === params[1]) };
    }
    if (/INSERT INTO checklist_completions/i.test(sql)) {
      const [id, business_id, instance_id, item_id, completed_by_id, completed_by_name, proof_type, proof_value] = params;
      const existing = state.completions.find((r) => r.instance_id === instance_id && r.item_id === item_id);
      if (existing) Object.assign(existing, { completed_by_id, completed_by_name, proof_type, proof_value, completed_at: '2026-11-26T16:00:00Z' });
      else state.completions.push({ id, business_id, instance_id, item_id, completed_by_id, completed_by_name, proof_type, proof_value, completed_at: '2026-11-26T15:00:00Z' });
      return { rows: [] };
    }
    if (/SELECT \* FROM checklist_completions WHERE business_id/i.test(sql)) {
      return { rows: state.completions.filter((r) => r.business_id === params[0] && params[1].includes(r.instance_id)) };
    }
    if (/SELECT \* FROM checklist_completions WHERE instance_id/i.test(sql)) {
      return { rows: state.completions.filter((r) => r.instance_id === params[0] && r.item_id === params[1] && r.business_id === params[2]) };
    }
    if (/DELETE FROM checklist_completions/i.test(sql)) {
      state.completions = state.completions.filter((r) => !(r.instance_id === params[0] && r.item_id === params[1] && r.business_id === params[2]));
      return { rows: [] };
    }
    throw new Error(`fake pool cannot run: ${sql}`);
  };
  return { state, query: async (sql, params) => runQuery(sql, params) };
}

/* ---------------- TEST + RETEST: build → schedule → tick → history */

test('TEST: build → schedule → tick (with proof) → history', async () => {
  const pool = fakePool();
  const biz = 'biz-a';
  // BUILD — an opening template, assigned to the morning
  // shift, with a photo-proof item and a temperature item.
  const template = await createTemplate(pool, biz, {
    name: 'Opening',
    assign_type: 'shift',
    assign_value: 'Morning',
    schedule: 'daily',
    items: [
      { id: 'unlock', label: 'Unlock the doors', proof: 'none' },
      { id: 'floor', label: 'Floor clean and safe', proof: 'photo' },
      { id: 'fridge', label: 'Fridge temperature', proof: 'temperature' },
    ],
  }, { userId: 'owner-1' });
  assert.equal(template.name, 'Opening');
  assert.equal((await listTemplates(pool, biz)).length, 1);

  // SCHEDULE — today's instance materialises with the items
  // snapshot, exactly once however often it is asked for.
  const first = await ensureInstances(pool, biz, '2026-11-26');
  const second = await ensureInstances(pool, biz, '2026-11-26');
  assert.equal(first.length, 1);
  assert.equal(second.length, 1, 'a day materialises exactly once');
  assert.equal(first[0].id, second[0].id);
  const instance = first[0];
  assert.equal(instance.assign_value, 'Morning', 'the assignment rides the instance');

  // TICK — a plain item ticks with who/when; a proof item
  // refuses without proof, then lands with it.
  await completeItem(pool, biz, instance.id, 'unlock', { userId: 'staff-1', actorName: 'Ana' });
  await assert.rejects(
    () => completeItem(pool, biz, instance.id, 'fridge', { userId: 'staff-1', actorName: 'Ana', proofValue: '' }),
    (e) => e.code === 'checklist_proof',
    'a temperature item refuses a tick with no reading',
  );
  await completeItem(pool, biz, instance.id, 'fridge', { userId: 'staff-1', actorName: 'Ana', proofValue: '4' });
  const view = await dayView(pool, biz, '2026-11-26');
  assert.deepEqual(view.summary, { done: 2, total: 3, lists: 1 });
  const fridge = view.instances[0].items.find((i) => i.id === 'fridge');
  assert.equal(fridge.completion.by_name, 'Ana');
  assert.equal(fridge.completion.proof_value, '4');
  const floor = view.instances[0].items.find((i) => i.id === 'floor');
  assert.equal(floor.completion, null, 'what is missing stands unticked — the manager sees it from home');

  // HISTORY — the last days, newest first, today included.
  const history = await historyView(pool, biz, '2026-11-26', 3);
  assert.equal(history.length, 3);
  assert.equal(history[0].date, '2026-11-26');
  assert.equal(history[0].summary.done, 2);
});

test('RETEST: a template edit never rewrites a day that already happened; untick rules hold', async () => {
  const pool = fakePool();
  const biz = 'biz-a';
  const template = await createTemplate(pool, biz, {
    name: 'Closing',
    schedule: 'daily',
    items: [{ id: 'till', label: 'Count the till', proof: 'none' }],
  }, { userId: 'owner-1' });
  const [instance] = await ensureInstances(pool, biz, '2026-11-25');
  await completeItem(pool, biz, instance.id, 'till', { userId: 'staff-1', actorName: 'Ben' });

  // The owner renames the item and adds another: yesterday's
  // instance keeps yesterday's words and yesterday's tick.
  await updateTemplate(pool, biz, template.id, {
    name: 'Closing',
    schedule: 'daily',
    items: [
      { id: 'till', label: 'Count the till twice', proof: 'none' },
      { id: 'alarm', label: 'Set the alarm', proof: 'none' },
    ],
  });
  const [yesterday] = await ensureInstances(pool, biz, '2026-11-25');
  assert.equal(yesterday.items.length, 1, 'the snapshot stands');
  assert.equal(yesterday.items[0].label, 'Count the till');
  assert.equal(yesterday.items[0].completion.by_name, 'Ben');
  const [todayInstance] = await ensureInstances(pool, biz, '2026-11-26');
  assert.equal(todayInstance.items.length, 2, 'today runs the edited template');

  // UNTICK — a different staff member cannot untick Ben's
  // tick; Ben can; the owner can.
  await completeItem(pool, biz, todayInstance.id, 'till', { userId: 'staff-1', actorName: 'Ben' });
  await assert.rejects(
    () => uncompleteItem(pool, biz, todayInstance.id, 'till', { isOwner: false, permissions: [], staffRow: { role_id: 'preset-stock' } }, { userId: 'staff-2' }),
    (e) => e.code === 'checklist_untick',
  );
  await uncompleteItem(pool, biz, todayInstance.id, 'till', { isOwner: false, permissions: [], staffRow: { role_id: 'preset-stock' } }, { userId: 'staff-1' });
  const after = await dayView(pool, biz, '2026-11-26');
  assert.equal(after.instances[0].items[0].completion, null);

  await deleteTemplate(pool, biz, template.id);
  assert.equal((await listTemplates(pool, biz)).length, 0);
});

test('cross-business: templates, instances and completions never leak', async () => {
  const pool = fakePool();
  await createTemplate(pool, 'biz-a', {
    name: 'Opening',
    schedule: 'daily',
    items: [{ id: 'x', label: 'X', proof: 'none' }],
  }, { userId: 'owner-1' });
  assert.equal((await listTemplates(pool, 'biz-b')).length, 0, 'business B sees none of A\'s templates');
  assert.deepEqual((await dayView(pool, 'biz-b', '2026-11-26')).instances, [], 'and none of A\'s instances');
  const [instanceA] = await ensureInstances(pool, 'biz-a', '2026-11-26');
  await assert.rejects(
    () => completeItem(pool, 'biz-b', instanceA.id, 'x', { userId: 'staff-9', actorName: 'Eve' }),
    (e) => e.status === 404,
    'a completion against another business\'s instance is simply not found',
  );
});

/* ------------------------------------------------ wiring pins */

test('migration 058: the three engine tables, the once-a-day unique index, and no foreign keys', () => {
  const migration = read('migrations/058_checklists.sql');
  for (const table of ['checklist_templates', 'checklist_instances', 'checklist_completions']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS checklist_instances_template_day_key\s+ON checklist_instances \(template_id, run_date\)/, 'a day materialises exactly once');
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS checklist_completions_item_key\s+ON checklist_completions \(instance_id, item_id\)/, 'one completion per item');
  const ddl = migration.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.ok(!/REFERENCES\s/i.test(ddl) && !/FOREIGN KEY/i.test(ddl), 'business_id carries no foreign key (the migration-017 lesson)');
});

test('the doors are wired: router mounted, wipe sweep, both-plans surface, tick gate on template writes only', () => {
  const app = read('server/app.js');
  assert.ok(app.includes("import { createChecklistsRouter } from './checklistsRoutes.js';"));
  assert.ok(app.includes("app.use('/api', createChecklistsRouter({ getPool }));"));
  const billing = read('server/billing.js');
  for (const table of ['checklist_completions', 'checklist_instances', 'checklist_templates']) {
    assert.ok(billing.includes(`DELETE FROM ${table} WHERE business_id = $1`), `the wipe sweep deletes ${table} with the business`);
  }
  const routes = read('server/checklistsRoutes.js');
  assert.ok(routes.includes('canManageChecklists(access)'), 'template writes ride the tick');
  assert.ok(routes.includes('manageCtx(req)'), 'the template doors pass through the manage gate');
  assert.ok(!routes.includes('planKey') && !routes.includes('requirePlan'), 'no plan gate anywhere in the checklists surface — both plans');
  const page = read('src/pages/Checklists.jsx');
  assert.ok(page.includes('completeChecklistItem('), 'the page ticks through the engine');
  assert.ok(page.includes('fetchChecklistHistory('), 'the page reads completion history');
  const nav = read('src/components/layout/navGroups.js');
  assert.ok(nav.includes("to: '/checklists'"), 'the general home hangs in the main navigation');
  const appJsx = read('src/App.jsx');
  assert.ok(appJsx.includes('<Route path="/checklists" element={<Checklists />} />'));
});

test('home surfacing: Dashboard card, Restaurant Today card, and the Team & Place shelf cross-link', () => {
  const dashboard = read('src/pages/Dashboard.jsx');
  assert.ok(dashboard.includes('<ChecklistsTodayCard businessId={activeId} />'), 'today\'s state surfaces on the business home');
  const card = read('src/components/dashboard/ChecklistsTodayCard.jsx');
  assert.ok(card.includes('fetchChecklistToday(businessId)'), 'the card reads the engine\'s day view');
  assert.ok(card.includes('if (!summary || !summary.total) return null;'), 'no card when nothing is running — no placeholder claims a fact');
  const shelves = read('src/lib/restaurantShelves.js');
  assert.ok(shelves.includes("door('/checklists', 'nav.checklists', 'restaurant.doorChecklists', ClipboardCheck, { crossLink: true })"), 'the Team & Place shelf cross-links to the general home');
  const today = summarizeToday({ checklistToday: { summary: { done: 2, total: 5, lists: 1 } } });
  assert.deepEqual(today.checklists, { done: 2, total: 5, lists: 1 }, 'the Today summary carries the day\'s checklist progress');
  const cards = read('src/components/restaurant/TodayCards.jsx');
  assert.ok(cards.includes("t('restaurant.today.checklists'"), 'the Today page renders the checklist card');
  const restaurant = read('src/pages/Restaurant.jsx');
  assert.ok(restaurant.includes('fetchChecklistToday(activeId)'), 'the Restaurant home reads the day view like every other Today source');
});

test('the member dialog offers the tick as its own grant block', () => {
  const dialog = read('src/components/staff/StaffMemberDialog.jsx');
  assert.ok(dialog.includes('CHECKLISTS_GRANTS.map((grant)'), 'the tick renders in the member dialog');
  assert.ok(dialog.includes('checklists_grants'), 'the tick splits out of the permission picker and rejoins at save');
});
