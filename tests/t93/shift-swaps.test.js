// t93 — Plan Part 7, item 391: SHIFT SWAPS, COVERS AND
// THE OPEN-SHIFT POOL — plus STAFF AVAILABILITY (round-2
// Gap 2). GENERAL, both plans (her Q1–Q4 pattern): the
// feature lives with the general workforce tools and the
// Restaurant Team & Place shelf cross-links it.
//
// Pinned here:
//   - 68 new keys exist in all 52 locales, never fall back
//     to the raw key, and the keyset is uniform at 6838
//     (6838 + 68 swaps); placeholders survive translation.
//   - The plan presentation carries the swaps line in
//     BOTH plans (Plans Essentials, Welcome Essentials,
//     and the comparison matrix ✓/✓) — a general feature.
//   - The training catalogs agree at 135 lessons; the
//     swaps lesson rides the owner track under the
//     GENERAL heading with 5 steps and no feature gate.
//   - The pure core: a cover moves the shift whole, a
//     trade exchanges both shifts, a stale snapshot or a
//     doubled day refuses; the overtime flag rides the
//     labor-watch engine and fires only when the swap
//     PUSHES someone into a verdict; availability clashes
//     read unavailable / outside-window / none.
//   - Migration 069 carries the two tables.
//   - The wiring: the router is registered; the schedule
//     is rewritten only inside the approval transaction;
//     availability writes only the caller's own rows; the
//     Restaurant shelf cross-links the general home; the
//     18 new server wordings are keyed in apiErrors.
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
  applySwapToSchedules,
  availabilityConflict,
  cleanAvailabilityDays,
  sameRole,
  swapOvertimeFlags,
} from '../../server/shiftSwapsCore.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'plansLib.includes.shiftSwaps',
  'nav.shiftSwaps',
  'restaurant.doorShiftSwaps',
  'workforce.tab.swaps',
  'workforce.swaps.title',
  'workforce.swaps.help',
  'workforce.swaps.offerTitle',
  'workforce.swaps.myShift',
  'workforce.swaps.kindPool',
  'workforce.swaps.kindTrade',
  'workforce.swaps.coworker',
  'workforce.swaps.theirShift',
  'workforce.swaps.note',
  'workforce.swaps.offerButton',
  'workforce.swaps.offered',
  'workforce.swaps.poolTitle',
  'workforce.swaps.poolEmpty',
  'workforce.swaps.takeButton',
  'workforce.swaps.acceptTradeButton',
  'workforce.swaps.takenToast',
  'workforce.swaps.requestsTitle',
  'workforce.swaps.requestsEmpty',
  'workforce.swaps.decidedToast',
  'workforce.swaps.cancelledToast',
  'workforce.swaps.statusAccepted',
  'workforce.swaps.statusCancelled',
  'workforce.swaps.overtimeFlag',
  'workforce.swaps.availabilityConflict',
  'workforce.swaps.viewerConflict',
  'workforce.swaps.poolLine',
  'workforce.swaps.tradeLine',
  'workforce.swaps.takerLine',
  'workforce.swaps.cancelButton',
  'workforce.availability.title',
  'workforce.availability.help',
  'workforce.availability.canWork',
  'workforce.availability.earliest',
  'workforce.availability.latest',
  'workforce.availability.save',
  'workforce.availability.saved',
  'workforce.availability.teamTitle',
  'workforce.availability.notSet',
  'workforce.availability.unavailable',
  'workforce.schedule.availability',
  'training.lessons.owner-shift-swaps.title',
  'training.lessons.owner-shift-swaps.step1',
  'training.lessons.owner-shift-swaps.step2',
  'training.lessons.owner-shift-swaps.step3',
  'training.lessons.owner-shift-swaps.step4',
  'training.lessons.owner-shift-swaps.step5',
  'apiErrors.swaps.notOwnShift',
  'apiErrors.swaps.alreadyOffered',
  'apiErrors.swaps.tradePartner',
  'apiErrors.swaps.partnerNoShift',
  'apiErrors.swaps.notFound',
  'apiErrors.swaps.notOpen',
  'apiErrors.swaps.onlyNamedCoworker',
  'apiErrors.swaps.sameRolePool',
  'apiErrors.swaps.ownShiftTake',
  'apiErrors.swaps.onlyRequesterCancel',
  'apiErrors.swaps.staffDecide',
  'apiErrors.swaps.managerSwapOwner',
  'apiErrors.swaps.declineReason',
  'apiErrors.swaps.scheduleChanged',
  'apiErrors.swaps.takerBusy',
  'apiErrors.swaps.badAction',
  'apiErrors.availability.weekShape',
  'apiErrors.availability.dayShape',
];

test('the keyset is uniform at 6838 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 6838, code);
});

test('all 68 swaps keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 68);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('English variants and base-riding locales carry the same swaps strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('placeholders survive translation in the flag and line strings', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const ph of ['{name}', '{hours}', '{limit}']) {
      assert.ok(table['workforce.swaps.overtimeFlag'].includes(ph), `${code} overtimeFlag ${ph}`);
    }
    for (const ph of ['{name}', '{day}', '{start}', '{end}']) {
      assert.ok(table['workforce.swaps.poolLine'].includes(ph), `${code} poolLine ${ph}`);
    }
    for (const ph of ['{name}', '{day}', '{start}', '{end}', '{day2}', '{start2}', '{end2}']) {
      assert.ok(table['workforce.swaps.tradeLine'].includes(ph), `${code} tradeLine ${ph}`);
    }
    assert.ok(table['workforce.swaps.availabilityConflict'].includes('{name}'), `${code} availabilityConflict`);
    assert.ok(table['workforce.swaps.takerLine'].includes('{name}'), `${code} takerLine`);
  }
});

test('plan presentation: the swaps line is on BOTH plans (general feature)', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.includes.shiftSwaps').length - 1, 3, 'Plans Essentials, Welcome Essentials and the matrix');
  const line = en['plansLib.includes.shiftSwaps'];
  assert.ok(PLANS.essentials.includes.includes(line), 'Plans Essentials carries the swaps line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(welcomeEssentials.includes.includes(line), 'Welcome Essentials carries the swaps line');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === true && row.business === true, 'matrix row is on both plans');
});

test('the catalogs agree at 135 lessons and the swaps lesson rides the GENERAL heading', () => {
  assert.equal(CLIENT_LESSONS.length, 135);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-shift-swaps');
  assert.ok(lesson, 'swaps lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'workforce');
  assert.equal(lesson.heading, 'general');
  assert.equal(lesson.feature, undefined, 'no feature gate — the lesson shows on both plans');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-shift-swaps.title'], 'Shift swaps and availability');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 115);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 20);
});

const WEEK = [
  { staff_member_id: 'ana', weekday: 1, start_time: '09:00', end_time: '17:00' },
  { staff_member_id: 'ana', weekday: 2, start_time: '09:00', end_time: '17:00' },
  { staff_member_id: 'bo', weekday: 3, start_time: '10:00', end_time: '14:00' },
];
const POOL_SWAP = {
  requester_id: 'ana', kind: 'pool', weekday: 1, start_time: '09:00', end_time: '17:00',
  target_id: null, target_weekday: null, target_start_time: null, target_end_time: null,
};

test('applySwapToSchedules: a cover moves the shift whole to the taker', () => {
  const applied = applySwapToSchedules(WEEK, POOL_SWAP, 'bo');
  assert.equal(applied.ok, true);
  assert.ok(!applied.schedules.some((s) => s.staff_member_id === 'ana' && s.weekday === 1), 'the giver no longer holds Monday');
  assert.ok(applied.schedules.some((s) => s.staff_member_id === 'bo' && s.weekday === 1 && s.start_time === '09:00' && s.end_time === '17:00'), 'the taker holds the offered shift whole');
  assert.equal(WEEK.length, 3, 'the input week is never mutated');
});

test('applySwapToSchedules: a trade exchanges both shifts', () => {
  const trade = {
    requester_id: 'ana', kind: 'trade', weekday: 2, start_time: '09:00', end_time: '17:00',
    target_id: 'bo', target_weekday: 3, target_start_time: '10:00', target_end_time: '14:00',
  };
  const applied = applySwapToSchedules(WEEK, trade, 'bo');
  assert.equal(applied.ok, true);
  assert.ok(applied.schedules.some((s) => s.staff_member_id === 'ana' && s.weekday === 3 && s.start_time === '10:00'), 'the giver now works the target day');
  assert.ok(applied.schedules.some((s) => s.staff_member_id === 'bo' && s.weekday === 2 && s.start_time === '09:00'), 'the target now works the giver day');
});

test('applySwapToSchedules: stale snapshots and doubled days refuse', () => {
  const stale = { ...POOL_SWAP, start_time: '08:00' };
  assert.deepEqual(applySwapToSchedules(WEEK, stale, 'bo'), { ok: false, code: 'schedule_changed' });
  const busyWeek = [...WEEK, { staff_member_id: 'bo', weekday: 1, start_time: '08:00', end_time: '12:00' }];
  assert.deepEqual(applySwapToSchedules(busyWeek, POOL_SWAP, 'bo'), { ok: false, code: 'taker_busy' });
});

test('swapOvertimeFlags rides the labor-watch engine: only a PUSH into a verdict flags', () => {
  const people = [
    { id: 'ana', full_name: 'Ana', role_name: 'Cook' },
    { id: 'bo', full_name: 'Bo', role_name: 'Cook' },
  ];
  // Bo works 4h; Ana's Monday is 8h. The owner's line is 10:
  // nobody is near it standing still, but Bo taking Ana's
  // Monday lands on 12 — the swap PUSHES Bo over.
  const settings = { overtime_hours: 10, warn_within_hours: null };
  const flags = swapOvertimeFlags({ settings, people, schedules: WEEK, swap: POOL_SWAP, takerId: 'bo' });
  assert.equal(flags.length, 1);
  assert.equal(flags[0].staff_member_id, 'bo');
  assert.equal(flags[0].code, 'overtime_over');
  assert.equal(flags[0].hours, 12);
  assert.equal(flags[0].limit, 10);
  // With no owner line set the engine is silent — and so is the flag.
  assert.deepEqual(swapOvertimeFlags({ settings: {}, people, schedules: WEEK, swap: POOL_SWAP, takerId: 'bo' }), []);
  // A swap that leaves the taker under the line flags
  // nothing: Cy holds no shifts, and Ana's 8-hour Tuesday
  // alone stays under the owner's 10-hour line.
  const noPush = { ...POOL_SWAP, weekday: 2 };
  const folks = [...people, { id: 'cy', full_name: 'Cy', role_name: 'Cook' }];
  assert.deepEqual(swapOvertimeFlags({ settings, people: folks, schedules: WEEK, swap: noPush, takerId: 'cy' }), []);
});

test('availabilityConflict: unavailable, outside the window, or no clash', () => {
  const rows = [
    { weekday: 1, available: false, start_time: null, end_time: null },
    { weekday: 2, available: true, start_time: '10:00', end_time: '18:00' },
    { weekday: 3, available: true, start_time: null, end_time: null },
  ];
  assert.equal(availabilityConflict(rows, { weekday: 1, start_time: '09:00', end_time: '17:00' }), 'unavailable');
  assert.equal(availabilityConflict(rows, { weekday: 2, start_time: '09:00', end_time: '17:00' }), 'outside');
  assert.equal(availabilityConflict(rows, { weekday: 2, start_time: '10:00', end_time: '18:00' }), null);
  assert.equal(availabilityConflict(rows, { weekday: 3, start_time: '09:00', end_time: '17:00' }), null, 'a day with no window is no clash');
  assert.equal(availabilityConflict(rows, { weekday: 4, start_time: '09:00', end_time: '17:00' }), null, 'not set is no preference, never a refusal');
  assert.equal(availabilityConflict([], { weekday: 1, start_time: '09:00', end_time: '17:00' }), null);
});

test('cleanAvailabilityDays: windows validated, cannot-work days carry none', () => {
  const days = cleanAvailabilityDays([
    { weekday: 1, available: false, start_time: '09:00', end_time: '17:00' },
    { weekday: 2, available: true, start_time: '10:00', end_time: '18:00' },
    { weekday: 3, available: true },
  ]);
  assert.deepEqual(days[0], { weekday: 1, available: false, start_time: null, end_time: null, note: '' });
  assert.deepEqual(days[1], { weekday: 2, available: true, start_time: '10:00', end_time: '18:00', note: '' });
  assert.throws(() => cleanAvailabilityDays([{ weekday: 2, available: true, start_time: '18:00', end_time: '10:00' }]), /weekday \(0-6\)/);
  assert.throws(() => cleanAvailabilityDays([{ weekday: 9, available: true }]), /weekday \(0-6\)/);
  assert.throws(() => cleanAvailabilityDays('nope'), /up to 7 days/);
});

test('sameRole matches the stored role name, trimmed and case-insensitive', () => {
  assert.equal(sameRole({ role_name: 'Cook' }, { role_name: ' cook ' }), true);
  assert.equal(sameRole({ role_name: 'Cook' }, { role_name: 'Server' }), false);
  assert.equal(sameRole({ role_name: '' }, { role_name: '' }), false);
});

test('migration 069 carries the swap requests and the availability rows', () => {
  const sql = read('migrations/069_shift_swaps.sql');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS shift_swap_requests'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS staff_availability'));
  for (const col of ['requester_id', 'accepted_by_id', 'target_weekday', 'decision_reason', 'available', 'start_time', 'end_time']) {
    assert.ok(sql.includes(col), col);
  }
  assert.ok(sql.includes("('pending', 'accepted', 'approved', 'declined', 'cancelled')"), 'the status walk is the doctrine walk');
});

test('the 18 new server wordings are keyed in the apiErrors registry', () => {
  const pairs = [
    ['You can only offer one of your own scheduled shifts.', 'apiErrors.swaps.notOwnShift'],
    ['This shift already has an open swap request.', 'apiErrors.swaps.alreadyOffered'],
    ['Choose a coworker in the same role to trade with.', 'apiErrors.swaps.tradePartner'],
    ['That coworker has no shift that day to trade.', 'apiErrors.swaps.partnerNoShift'],
    ['Swap request not found.', 'apiErrors.swaps.notFound'],
    ['This swap is no longer open.', 'apiErrors.swaps.notOpen'],
    ['Only the coworker named in this trade can accept it.', 'apiErrors.swaps.onlyNamedCoworker'],
    ['Only a coworker in the same role can take a shift from the pool.', 'apiErrors.swaps.sameRolePool'],
    ['You cannot take your own offered shift.', 'apiErrors.swaps.ownShiftTake'],
    ['Only the person who offered this swap can cancel it.', 'apiErrors.swaps.onlyRequesterCancel'],
    ['Team members cannot decide shift swaps.', 'apiErrors.swaps.staffDecide'],
    ['Only the owner can decide a swap involving a manager.', 'apiErrors.swaps.managerSwapOwner'],
    ['A declined swap needs a reason, so the team members know why.', 'apiErrors.swaps.declineReason'],
    ['The schedule changed since this swap was offered, so it cannot go ahead. Ask for a fresh offer.', 'apiErrors.swaps.scheduleChanged'],
    ['The person taking this shift already has a shift that day, so the swap cannot go ahead.', 'apiErrors.swaps.takerBusy'],
    ['Choose what to do with this swap: accept, approve, decline or cancel.', 'apiErrors.swaps.badAction'],
    ['Send your availability as a list of up to 7 days.', 'apiErrors.availability.weekShape'],
    ['Each availability day needs a weekday (0-6), and any times must be HH:MM with the end after the start.', 'apiErrors.availability.dayShape'],
  ];
  assert.equal(pairs.length, 18);
  for (const [message, key] of pairs) assert.equal(API_ERROR_MESSAGE_KEYS[message], key, message);
});

test('wiring: approval alone rewrites the schedule, inside one transaction', () => {
  const routes = read('server/shiftSwapsRoutes.js');
  const app = read('server/app.js');
  assert.ok(app.includes('createShiftSwapsRouter'), 'the router is registered');
  assert.ok(routes.includes('applySwapToSchedules'), 'approval weighs the swap through the pure core');
  const approveAt = routes.indexOf("action === 'approve'");
  assert.ok(approveAt > 0);
  const txAt = routes.indexOf('withTx', approveAt);
  assert.ok(txAt > approveAt, 'the approval runs in a transaction');
  assert.ok(routes.indexOf('DELETE FROM work_schedules', approveAt) > txAt, 'the schedule rewrite lives inside the approval transaction');
  assert.ok(routes.indexOf("status = 'approved'", approveAt) > txAt, 'the decision and the rewrite land together');
  assert.ok(routes.includes('swapOvertimeFlags'), 'the board carries the engine flag before approval');
  assert.ok(routes.includes("swap.status !== 'accepted'"), 'approval requires an accepted swap — nothing lands unapproved');
});

test('wiring: availability is the person\u2019s own record, and the surfaces exist', () => {
  const routes = read('server/shiftSwapsRoutes.js');
  const putAt = routes.indexOf("router.put(`${base}/availability`");
  assert.ok(putAt > 0);
  assert.ok(routes.indexOf('requirePerson(access)', putAt) > putAt, 'the availability door needs the caller\u2019s own staff profile');
  assert.ok(routes.indexOf('DELETE FROM staff_availability', putAt) > putAt, 'the save replaces the caller\u2019s rows');
  assert.ok(routes.includes('person.id'), 'rows are written for the caller, never a named third party');
  const page = read('src/pages/Workforce.jsx');
  assert.ok(page.includes("id: 'swaps'"), 'the Workforce page carries the swaps tab');
  assert.ok(page.includes('workforce.availability.unavailable'), 'the schedule builder shows availability beside the day');
  assert.ok(page.includes('AvailabilityDoc'), 'the board prints as a Studio document');
  const doc = read('src/components/print/WorkforceDocs.jsx');
  assert.ok(doc.includes('export function AvailabilityDoc'), 'the Studio availability sheet exists (preview = print)');
  const shelves = read('src/lib/restaurantShelves.js');
  assert.ok(shelves.includes("door('/workforce', 'nav.shiftSwaps', 'restaurant.doorShiftSwaps'"), 'the Team & Place shelf cross-links the general home');
  assert.ok(shelves.includes('crossLink: true'), 'as a cross-link, like the other general features');
});
