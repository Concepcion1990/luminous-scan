// t98 — Plan Part 7, owner-ruled addition G-C: VOID & COMP
// LOG (Nov 26, 2026). Business-only Restaurant Corner,
// Invoices & Money shelf; OWNER/MANAGER money server-side;
// HAND-ENTERED until a live till feed exists (the copy
// says so — no fake till claims). Pinned here:
//   - 36 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 7048
//     (7012 + 36 G-C keys); zero translation debt.
//   - THE DEDUPE GUARDRAIL: the plan line appears ONCE in
//     the Business lists (Plans + Welcome), ONCE in the
//     comparison matrix (Business only), and NEVER in an
//     Essentials list.
//   - The training catalogs agree at 140 lessons; the
//     lesson owner-void-comp rides the owner track under
//     the RESTAURANT heading with 5 steps and the
//     restaurant feature gate.
//   - The pure core: entry cleaning (kind void/comp, value
//     > 0, reason and approver required), the shaping and
//     the totals; the owner/manager door test.
//   - Migration 074 carries the table; the wiring: the
//     routes are plan-gated and owner/manager-gated before
//     any read, registered in app.js, ONE door on the
//     Invoices & Money shelf, its own Studio print, and
//     the billing wipe deletes the table.
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
  cleanVoidCompEntry,
  shapeVoidCompEntry,
  voidCompTotals,
} from '../../server/voidCompCore.js';
import { canSeeVoidComp } from '../../server/voidCompRoutes.js';
import { voidCompTotals as clientVoidCompTotals } from '../../src/lib/voidComp.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'voidcomp.title',
  'voidcomp.subtitle',
  'voidcomp.handNote',
  'voidcomp.kindVoid',
  'voidcomp.kindComp',
  'voidcomp.value',
  'voidcomp.reason',
  'voidcomp.approver',
  'voidcomp.recordButton',
  'voidcomp.recordedToast',
  'voidcomp.saveFailed',
  'voidcomp.emptyTitle',
  'voidcomp.emptyBody',
  'voidcomp.printButton',
  'voidcomp.colWhen',
  'voidcomp.colKind',
  'voidcomp.colValue',
  'voidcomp.colReason',
  'voidcomp.colApprover',
  'voidcomp.colBy',
  'voidcomp.totalVoids',
  'voidcomp.totalComps',
  'nav.voidComp',
  'restaurant.doorVoidComp',
  'plansLib.businessIncludes.voidComp',
  'training.lessons.owner-void-comp.title',
  'training.lessons.owner-void-comp.step1',
  'training.lessons.owner-void-comp.step2',
  'training.lessons.owner-void-comp.step3',
  'training.lessons.owner-void-comp.step4',
  'training.lessons.owner-void-comp.step5',
  'apiErrors.voidComp.moneyOnly',
  'apiErrors.voidComp.kindNeeded',
  'apiErrors.voidComp.valueNeeded',
  'apiErrors.voidComp.reasonNeeded',
  'apiErrors.voidComp.approverNeeded',
];

test('the keyset is uniform at 7048 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 7048, code);
});

test('all 36 G-C keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 36);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('no G-C value is byte-identical to English outside the English sets (zero debt)', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    if (code.startsWith('en')) continue;
    for (const key of NEW_KEYS) assert.notEqual(table[key], en[key], `${code} ${key} is untranslated`);
  }
});

test('English variants and base-riding locales carry the same G-C strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('the honest copy: hand-entered, no till claims, in English', () => {
  assert.ok(en['voidcomp.handNote'].includes('Typed in by hand'), 'the page says entries are typed in by hand');
  assert.ok(en['voidcomp.handNote'].includes('nothing here comes from a till'), 'the page makes no till claim');
  assert.ok(en['training.lessons.owner-void-comp.step2'].includes('nothing comes from a till'), 'the lesson repeats the honest note');
});

test('DEDUPE: the plan line appears exactly once per plan per surface', () => {
  const plansSrc = read('src/lib/plans.js');
  // Source-level: the key is referenced exactly 3 times —
  // Plans Business, Welcome Business, the matrix.
  assert.equal(plansSrc.split('plansLib.businessIncludes.voidComp').length - 1, 3, 'Plans + Welcome Business lists and the matrix only');
  const line = en['plansLib.businessIncludes.voidComp'];
  const count = (list) => list.filter((x) => x === line).length;
  assert.equal(count(PLANS.business.includes), 1, 'Plans Business carries it once');
  assert.equal(count(PLANS.essentials.includes), 0, 'Plans Essentials never carries a Business-only feature');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.equal(count(welcomeBusiness.includes), 1, 'Welcome Business carries it once');
  assert.equal(count(welcomeEssentials.includes), 0, 'Welcome Essentials never carries it');
  const rows = COMPARISON_ROWS.filter((r) => r.label === line);
  assert.equal(rows.length, 1, 'the matrix carries exactly one row');
  assert.ok(rows[0].essentials === false && rows[0].business === true, 'matrix row is Business only');
  // No plan list anywhere contains ANY duplicate line.
  for (const list of [PLANS.essentials.includes, PLANS.business.includes, welcomeEssentials.includes, welcomeBusiness.includes]) {
    assert.equal(new Set(list).size, list.length, 'a plan list contains a duplicate line');
  }
});

test('the catalogs agree at 140 lessons and the G-C lesson rides the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 140);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-void-comp');
  assert.ok(lesson, 'G-C lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant', 'a Business-only feature carries its plan gate');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-void-comp.title'], 'The void & comp log');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 116);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 24);
});

test('cleanVoidCompEntry: kind, value, reason and approver are required', () => {
  const ok = cleanVoidCompEntry({ kind: 'COMP', amount: '18.5', reason: ' Dessert came out late ', approver: ' Maria ' });
  assert.deepEqual(ok, { kind: 'comp', amount: 18.5, reason: 'Dessert came out late', approver: 'Maria' });
  assert.equal(cleanVoidCompEntry({ kind: 'void', value: 9, reason: 'Wrong table', approver: 'Owner' }).amount, 9);
  assert.throws(() => cleanVoidCompEntry({ kind: 'discount', amount: 5, reason: 'x', approver: 'A' }), /void or a comp/);
  assert.throws(() => cleanVoidCompEntry({ kind: 'void', amount: 0, reason: 'x', approver: 'A' }), /greater than zero/);
  assert.throws(() => cleanVoidCompEntry({ kind: 'void', amount: '', reason: 'x', approver: 'A' }), /greater than zero/);
  assert.throws(() => cleanVoidCompEntry({ kind: 'void', amount: 5, reason: ' ', approver: 'A' }), /why it was voided or comped/);
  assert.throws(() => cleanVoidCompEntry({ kind: 'comp', amount: 5, reason: 'x', approver: '' }), /who approved it/);
});

test('shaping and totals: values are numbers, client and server totals agree', () => {
  const row = shapeVoidCompEntry({ kind: 'void', amount: '12.50' });
  assert.equal(row.amount, 12.5);
  const entries = [
    { kind: 'void', amount: 12.5 },
    { kind: 'void', amount: 5 },
    { kind: 'comp', amount: 20 },
  ];
  const totals = voidCompTotals(entries);
  assert.deepEqual(totals, { totalVoids: 17.5, totalComps: 20, voidCount: 2, compCount: 1 });
  assert.deepEqual(clientVoidCompTotals(entries), totals);
  assert.deepEqual(voidCompTotals([]), { totalVoids: 0, totalComps: 0, voidCount: 0, compCount: 0 });
});

test('canSeeVoidComp: the owner and managers pass; plain staff do not', () => {
  assert.equal(canSeeVoidComp(null), false);
  assert.equal(canSeeVoidComp({ isOwner: true, staffRow: null }), true);
  assert.equal(canSeeVoidComp({ isOwner: false, staffRow: { role_id: 'preset-manager', role_name: 'Manager' } }), true);
  assert.equal(canSeeVoidComp({ isOwner: false, staffRow: { role_id: 'custom-1', role_name: 'manager' } }), true);
  assert.equal(canSeeVoidComp({ isOwner: false, staffRow: { role_id: 'preset-staff', role_name: 'Server' } }), false);
  assert.equal(canSeeVoidComp({ isOwner: false, staffRow: null }), false);
});

test('migration 074 carries the register table with the record shape', () => {
  const sql = read('migrations/074_void_comp_log.sql');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS void_comp_entries'));
  for (const col of ['kind', 'amount', 'reason', 'approver', 'created_by', 'business_id']) {
    assert.ok(sql.includes(col), col);
  }
});

test('the 5 new server wordings are keyed in the apiErrors registry', () => {
  const want = {
    'Voids and comps are for the owner and managers only.': 'apiErrors.voidComp.moneyOnly',
    'Say whether it was a void or a comp.': 'apiErrors.voidComp.kindNeeded',
    'Enter the value — it must be greater than zero.': 'apiErrors.voidComp.valueNeeded',
    'Say why it was voided or comped.': 'apiErrors.voidComp.reasonNeeded',
    'Say who approved it.': 'apiErrors.voidComp.approverNeeded',
  };
  for (const [message, key] of Object.entries(want)) {
    assert.equal(API_ERROR_MESSAGE_KEYS[message], key, message);
    assert.ok(en[key], `${key} has English`);
  }
});

test('wiring: gated routes, registered; ONE door on the money shelf; the Studio print; the wipe', () => {
  const routes = read('server/voidCompRoutes.js');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"), 'the restaurant plan gate stands on the routes');
  assert.ok(routes.includes("throw err(403, 'voidcomp_money_only'"), 'non owner/managers are refused server-side');
  assert.ok(routes.indexOf('voidcomp_money_only') < routes.indexOf('loadLog(access.business.id)'), 'the money refusal stands before any read');
  assert.ok(routes.includes('assertNotInGrace'), 'writes respect the grace wall');
  const app = read('server/app.js');
  assert.ok(app.includes('createVoidCompRouter'), 'the router is registered');
  const appJsx = read('src/App.jsx');
  assert.ok(appJsx.includes('path="/restaurant/void-comp"'), 'the route exists');
  assert.ok(appJsx.includes('<PlanRedirect feature="restaurant">'), 'the route rides the restaurant plan gate');
  const shelves = read('src/lib/restaurantShelves.js');
  const moneyShelf = shelves.slice(shelves.indexOf("id: 'money'"), shelves.indexOf("id: 'safety'"));
  assert.ok(moneyShelf.includes("door('/restaurant/void-comp', 'nav.voidComp'"), 'ONE door, on the Invoices & Money shelf');
  assert.equal(shelves.split("'/restaurant/void-comp'").length - 1, 1, 'the door appears exactly once in the corner');
  const page = read('src/pages/RestaurantVoidComp.jsx');
  assert.ok(page.includes('VoidCompDoc'), 'the page prints through the Studio doc');
  assert.ok(page.includes("t('voidcomp.handNote')"), 'the page carries the honest hand-entered note');
  const doc = read('src/components/print/VoidCompDoc.jsx');
  assert.ok(doc.includes("t('voidcomp.colApprover')") && doc.includes("t('voidcomp.totalVoids')"), 'the Studio document carries the full register shape');
  const billing = read('server/billing.js');
  assert.ok(billing.includes('DELETE FROM void_comp_entries'), 'the wipe deletes the register');
});
