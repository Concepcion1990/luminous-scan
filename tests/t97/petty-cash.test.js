// t97 — Plan Part 7, owner-ruled addition G-A: PETTY CASH +
// BANK DEPOSIT LOG (Nov 26, 2026). GENERAL money, BOTH
// plans, beside the manager cash-up / cash count on the
// Payroll page; OWNER-ONLY money server-side. Pinned here:
//   - 36 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 7048
//     (6976 + 36 G-A keys); zero translation debt.
//   - THE DEDUPE GUARDRAIL: the plan line appears ONCE in
//     the Essentials lists (Plans + Welcome), ONCE in the
//     comparison matrix (both plans ✓), and NEVER in a
//     Business includes list — Business reads "Everything
//     in Essentials, plus…" only.
//   - The training catalogs agree at 140 lessons; the
//     lesson owner-petty-cash rides the owner track under
//     the GENERAL heading with 5 steps and NO feature gate
//     (general feature, both plans).
//   - The pure core: petty cleaning (amount > 0, purpose
//     and initials required, real dates, receipt flag) and
//     deposit cleaning (amount > 0, bag and initials
//     required), the shaping and the totals.
//   - Migration 073 carries both tables; the wiring: the
//     routes are owner-only before any read, registered in
//     app.js, the Payroll section renders for the owner
//     beside the cash-up, both logs print as ONE Studio
//     document, and the billing wipe deletes both tables.
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
  cleanPettyEntry,
  cleanDeposit,
  cleanDate,
  shapePettyEntry,
  shapeDeposit,
  pettyTotals,
} from '../../server/pettyCashCore.js';
import { pettyTotals as clientPettyTotals } from '../../src/lib/pettyCash.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'petty.title',
  'petty.help',
  'petty.cashTitle',
  'petty.cashHelp',
  'petty.date',
  'petty.amount',
  'petty.purpose',
  'petty.receipt',
  'petty.receiptYes',
  'petty.receiptNo',
  'petty.initials',
  'petty.addCash',
  'petty.cashSaved',
  'petty.cashEmpty',
  'petty.depositTitle',
  'petty.depositHelp',
  'petty.bag',
  'petty.addDeposit',
  'petty.depositSaved',
  'petty.depositEmpty',
  'petty.printButton',
  'petty.totalOut',
  'petty.totalDeposited',
  'plansLib.includes.pettyCash',
  'training.lessons.owner-petty-cash.title',
  'training.lessons.owner-petty-cash.step1',
  'training.lessons.owner-petty-cash.step2',
  'training.lessons.owner-petty-cash.step3',
  'training.lessons.owner-petty-cash.step4',
  'training.lessons.owner-petty-cash.step5',
  'apiErrors.pettyCash.ownerOnly',
  'apiErrors.pettyCash.amountNeeded',
  'apiErrors.pettyCash.purposeNeeded',
  'apiErrors.pettyCash.initialsNeeded',
  'apiErrors.pettyCash.bagNeeded',
  'apiErrors.pettyCash.dateNeeded',
];

test('the keyset is uniform at 7048 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 7048, code);
});

test('all 36 G-A keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 36);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('no G-A value is byte-identical to English outside the English sets (zero debt)', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    if (code.startsWith('en')) continue;
    for (const key of NEW_KEYS) assert.notEqual(table[key], en[key], `${code} ${key} is untranslated`);
  }
});

test('English variants and base-riding locales carry the same G-A strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('DEDUPE: the plan line appears exactly once per plan per surface', () => {
  const plansSrc = read('src/lib/plans.js');
  // Source-level: the key is referenced exactly 3 times —
  // Plans Essentials, Welcome Essentials, the matrix.
  assert.equal(plansSrc.split('plansLib.includes.pettyCash').length - 1, 3, 'Plans + Welcome Essentials lists and the matrix only');
  const line = en['plansLib.includes.pettyCash'];
  const count = (list) => list.filter((x) => x === line).length;
  assert.equal(count(PLANS.essentials.includes), 1, 'Plans Essentials carries it once');
  assert.equal(count(PLANS.business.includes), 0, 'Plans Business never repeats an Essentials feature');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.equal(count(welcomeEssentials.includes), 1, 'Welcome Essentials carries it once');
  assert.equal(count(welcomeBusiness.includes), 0, 'Welcome Business never repeats it');
  const rows = COMPARISON_ROWS.filter((r) => r.label === line);
  assert.equal(rows.length, 1, 'the matrix carries exactly one row');
  assert.ok(rows[0].essentials === true && rows[0].business === true, 'matrix row is on both plans');
  // No plan list anywhere contains ANY duplicate line.
  for (const list of [PLANS.essentials.includes, PLANS.business.includes, welcomeEssentials.includes, welcomeBusiness.includes]) {
    assert.equal(new Set(list).size, list.length, 'a plan list contains a duplicate line');
  }
});

test('the catalogs agree at 140 lessons and the G-A lesson rides the GENERAL heading', () => {
  assert.equal(CLIENT_LESSONS.length, 140);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-petty-cash');
  assert.ok(lesson, 'G-A lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'payroll');
  assert.equal(lesson.heading, 'general');
  assert.equal(lesson.feature, undefined, 'a general feature carries no plan gate');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-petty-cash.title'], 'Petty cash & the bank deposit log');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 116);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 24);
});

test('cleanDate: only real calendar dates survive', () => {
  assert.equal(cleanDate('2026-11-26'), '2026-11-26');
  assert.equal(cleanDate('2026-02-30'), null);
  assert.equal(cleanDate('26/11/2026'), null);
  assert.equal(cleanDate(''), null);
});

test('cleanPettyEntry: amount, purpose and initials are required; the receipt flag is a boolean', () => {
  const ok = cleanPettyEntry({ entry_date: '2026-11-26', amount: '12.5', purpose: ' Limes and ice ', receipt_back: true, initials: 'cp' });
  assert.deepEqual(ok, { entry_date: '2026-11-26', amount: 12.5, purpose: 'Limes and ice', receipt_back: true, initials: 'CP' });
  assert.equal(cleanPettyEntry({ entry_date: '2026-11-26', amount: 5, purpose: 'Ice', initials: 'AB' }).receipt_back, false);
  assert.throws(() => cleanPettyEntry({ entry_date: '2026-11-26', amount: 0, purpose: 'Ice', initials: 'AB' }), /greater than zero/);
  assert.throws(() => cleanPettyEntry({ entry_date: '2026-11-26', amount: '', purpose: 'Ice', initials: 'AB' }), /greater than zero/);
  assert.throws(() => cleanPettyEntry({ entry_date: '2026-11-26', amount: 5, purpose: ' ', initials: 'AB' }), /what the petty cash was for/);
  assert.throws(() => cleanPettyEntry({ entry_date: '2026-11-26', amount: 5, purpose: 'Ice', initials: '' }), /initials/);
  assert.throws(() => cleanPettyEntry({ entry_date: '2026-02-30', amount: 5, purpose: 'Ice', initials: 'AB' }), /real date/);
});

test('cleanDeposit: amount, bag and initials are required', () => {
  const ok = cleanDeposit({ deposit_date: '2026-11-26', amount: '400', bag_ref: ' Blue bag 2 ', initials: 'cp' });
  assert.deepEqual(ok, { deposit_date: '2026-11-26', amount: 400, bag_ref: 'Blue bag 2', initials: 'CP' });
  assert.throws(() => cleanDeposit({ deposit_date: '2026-11-26', amount: -1, bag_ref: 'B1', initials: 'AB' }), /greater than zero/);
  assert.throws(() => cleanDeposit({ deposit_date: '2026-11-26', amount: 5, bag_ref: '', initials: 'AB' }), /which bag/);
  assert.throws(() => cleanDeposit({ deposit_date: '2026-11-26', amount: 5, bag_ref: 'B1', initials: ' ' }), /initials/);
  assert.throws(() => cleanDeposit({ amount: 5, bag_ref: 'B1', initials: 'AB' }), /real date/);
});

test('shaping and totals: amounts are numbers, dates are plain, client and server totals agree', () => {
  const petty = shapePettyEntry({ entry_date: '2026-11-26T00:00:00.000Z', amount: '12.50', receipt_back: 1 });
  assert.equal(petty.amount, 12.5);
  assert.equal(petty.entry_date, '2026-11-26');
  assert.equal(petty.receipt_back, false, 'only a true boolean reads as receipt back');
  const dep = shapeDeposit({ deposit_date: '2026-11-25', amount: '400.00' });
  assert.equal(dep.amount, 400);
  const totals = pettyTotals([petty, { amount: 5 }], [dep]);
  assert.deepEqual(totals, { totalOut: 17.5, totalDeposited: 400 });
  assert.deepEqual(clientPettyTotals([petty, { amount: 5 }], [dep]), totals);
});

test('migration 073 carries both tables with the record shapes', () => {
  const sql = read('migrations/073_petty_cash_deposits.sql');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS petty_cash_entries'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS bank_deposits'));
  for (const col of ['entry_date', 'purpose', 'receipt_back', 'initials', 'deposit_date', 'bag_ref', 'business_id']) {
    assert.ok(sql.includes(col), col);
  }
});

test('the 6 new server wordings are keyed in the apiErrors registry', () => {
  const want = {
    'Petty cash and bank deposits are for the owner only.': 'apiErrors.pettyCash.ownerOnly',
    'Enter the amount — it must be greater than zero.': 'apiErrors.pettyCash.amountNeeded',
    'Say what the petty cash was for.': 'apiErrors.pettyCash.purposeNeeded',
    'Add the initials — the record is signed.': 'apiErrors.pettyCash.initialsNeeded',
    'Say which bag the deposit went in.': 'apiErrors.pettyCash.bagNeeded',
    'Choose a real date for the record.': 'apiErrors.pettyCash.dateNeeded',
  };
  for (const [message, key] of Object.entries(want)) {
    assert.equal(API_ERROR_MESSAGE_KEYS[message], key, message);
    assert.ok(en[key], `${key} has English`);
  }
});

test('wiring: owner-only routes, registered; the Payroll door beside the cash-up; one Studio print; the wipe', () => {
  const routes = read('server/pettyCashRoutes.js');
  assert.ok(routes.includes("if (!access.isOwner) throw err(403, 'petty_owner_only'"), 'non-owners are refused server-side');
  assert.ok(routes.indexOf('petty_owner_only') < routes.indexOf('loadLogs(access.business.id)'), 'the refusal stands before any read');
  assert.ok(!routes.includes('featureAllowed'), 'a general feature carries no plan gate');
  assert.ok(routes.includes('assertNotInGrace'), 'writes respect the grace wall');
  const app = read('server/app.js');
  assert.ok(app.includes('createPettyCashRouter'), 'the router is registered');
  const payroll = read('src/pages/Payroll.jsx');
  assert.ok(payroll.includes('function PettyCashSection'), 'the section exists');
  assert.ok(payroll.includes('ctx.is_owner && <PettyCashSection'), 'the section renders for the owner only');
  assert.ok(payroll.indexOf('<CashUpSection') < payroll.indexOf('<PettyCashSection'), 'the door sits beside its cash-up sibling');
  assert.ok(payroll.includes('PettyCashDoc'), 'the section prints through the Studio doc');
  const doc = read('src/components/print/PettyCashDoc.jsx');
  assert.ok(doc.includes("t('petty.cashTitle')") && doc.includes("t('petty.depositTitle')"), 'ONE Studio document carries both logs');
  const billing = read('server/billing.js');
  assert.ok(billing.includes('DELETE FROM petty_cash_entries'), 'the wipe deletes the tin log');
  assert.ok(billing.includes('DELETE FROM bank_deposits'), 'the wipe deletes the deposit log');
});
