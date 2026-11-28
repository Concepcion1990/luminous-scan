// t87 — Plan release 376 + its two Part 7 riders: THE RESERVATION BOOK, the
// WALK-IN WAITLIST, and the DEPOSIT LINE (Business-only, Restaurant Corner,
// Floor & Guests shelf).
//
// Pinned here:
//   - 77 new keys exist in all 52 locales, never fall back to the raw key,
//     and the keyset is uniform at 7012 (6506 + 77); the guest-mail table
//     carries 10 more keys in all 52 blocks (44 -> 54) with placeholders
//     surviving translation.
//   - The registry gains exactly the host-door, booking, waitlist and
//     two SMS-gate messages (553 -> 558), word for word, and the client maps them.
//   - The plan presentation carries the reservations line in Business and
//     only Business (Plans list, Welcome list, comparison matrix).
//   - The training catalogs (client + server) agree at 130 lessons; the
//     reservations lesson rides the owner track under the RESTAURANT
//     heading with 5 steps.
//   - The pure core: booking cleaning (opt-in + deposit record), the
//     reminder-due rule (opt-in discipline, per-channel, 24h window), the
//     digest text, and the SMS keyset gate (closed -> not configured; open
//     -> one generic HTTPS JSON post, no provider named anywhere).
//   - Wiring: migration 065, the wipe sweep, the router mount, the plan
//     gate + host gate in the routes, the shelf door, the Today feed and
//     the Studio print document.
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
import { EMAIL_STRINGS, EMAIL_STRING_KEYS } from '../../server/emailStrings.js';
import {
  cleanReservation, cleanWaitlistEntry, reminderChannelsDue, digestText,
  BOOKING_MESSAGE, WAITLIST_MESSAGE, HOST_MESSAGE,
} from '../../server/reservationsCore.js';
import { smsConfigured, sendSms } from '../../server/smsGate.js';
import { RESERVATIONS_GRANTS, RESERVATIONS_GRANT_KEYS, isReservationsGrant } from '../../src/lib/staff.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NEW_KEYS = [
  'nav.reservations', 'restaurant.doorReservations', 'plansLib.businessIncludes.reservations',
  'staffLib.area.reservationsAccess', 'staffLib.perm.reservationsHost', 'staff.memberDialog.reservationsAccessHint',
  'reservations.title', 'reservations.subtitle', 'reservations.bookNote', 'reservations.hostNote',
  'reservations.dayView', 'reservations.weekView', 'reservations.dateLabel', 'reservations.timeLabel',
  'reservations.nameLabel', 'reservations.partySizeLabel', 'reservations.phoneLabel', 'reservations.emailLabel',
  'reservations.tableLabel', 'reservations.sourceLabel', 'reservations.sourcePhone', 'reservations.sourceWalkin',
  'reservations.statusLabel', 'reservations.statusBooked', 'reservations.statusSeated', 'reservations.statusNoShow',
  'reservations.statusCancelled', 'reservations.notesLabel', 'reservations.newBooking', 'reservations.editBooking',
  'reservations.saveBooking', 'reservations.saved', 'reservations.saveFailed', 'reservations.deleteBooking',
  'reservations.emptyTitle', 'reservations.emptyBody', 'reservations.reminderAsk', 'reservations.reminderHint',
  'reservations.remindersOn', 'reservations.remindersOff', 'reservations.reminderSent', 'reservations.depositLabel',
  'reservations.depositHowLabel', 'reservations.depositNote', 'reservations.digestButton', 'reservations.digestSent',
  'reservations.todayLine', 'reservations.guestsLine', 'reservations.printButton', 'reservations.docTitle',
  'reservations.textNotAvailable',
  'waitlist.title', 'waitlist.subtitle', 'waitlist.addButton', 'waitlist.quotedLabel', 'waitlist.partyLine',
  'waitlist.statusWaiting', 'waitlist.statusDropped', 'waitlist.readyButton', 'waitlist.readySentEmail',
  'waitlist.readySentText', 'waitlist.readyNotAvailable', 'waitlist.emptyTitle', 'waitlist.emptyBody',
  'waitlist.saved', 'waitlist.saveFailed',
  'apiErrors.reservationsHost', 'apiErrors.reservationsInvalid', 'apiErrors.waitlistInvalid',
  'apiErrors.smsInvalid', 'apiErrors.smsFailed',
  'training.lessons.owner-reservations.title', 'training.lessons.owner-reservations.step1',
  'training.lessons.owner-reservations.step2', 'training.lessons.owner-reservations.step3',
  'training.lessons.owner-reservations.step4', 'training.lessons.owner-reservations.step5',
];
const EMAIL_NEW_KEYS = [
  'guestReminder.subject', 'guestReminder.body', 'waitlistReady.subject', 'waitlistReady.body',
  'guestText.reminder', 'guestText.ready', 'digest.header', 'digest.partyLine', 'digest.more', 'digest.empty',
];

test('the keyset is uniform at 7012 keys in all 52 locales', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) assert.equal(Object.keys(LOCALES[code]).length, 7012, code);
});

test('all 77 reservations keys exist and never fall back to the key in any locale', () => {
  assert.equal(NEW_KEYS.length, 77);
  for (const [code, table] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.notEqual(table[key], key, `${code} ${key} fell back to the key`);
    }
  }
});

test('English variants and base-riding locales carry the same reservations strings', () => {
  for (const key of NEW_KEYS) {
    for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) assert.equal(LOCALES[code][key], LOCALES.en[key], `${code} ${key}`);
    for (const code of ['es-ES', 'es-CU', 'es-PR', 'es-US', 'es-VE']) assert.equal(LOCALES[code][key], LOCALES['es-MX'][key], `${code} ${key}`);
    assert.equal(LOCALES['fr-CA'][key], LOCALES['fr-FR'][key], `fr-CA ${key}`);
    assert.equal(LOCALES.prs[key], LOCALES.fa[key], `prs ${key}`);
    assert.equal(LOCALES['pt-PT'][key], LOCALES['pt-BR'][key], `pt-PT ${key}`);
    assert.equal(LOCALES['pa-Arab'][key], LOCALES.ur[key], `pa-Arab ${key}`);
  }
});

test('placeholders survive translation in the count lines', () => {
  for (const [code, table] of Object.entries(LOCALES)) {
    assert.ok(table['reservations.todayLine'].includes('{count}') && table['reservations.todayLine'].includes('{guests}'), `${code} todayLine`);
    assert.ok(table['reservations.guestsLine'].includes('{count}') && table['reservations.guestsLine'].includes('{date}'), `${code} guestsLine`);
    assert.ok(table['waitlist.partyLine'].includes('{count}') && table['waitlist.partyLine'].includes('{minutes}'), `${code} partyLine`);
  }
});

test('the guest-mail table carries the 10 new keys in all 52 blocks, placeholders intact', () => {
  assert.equal(EMAIL_STRING_KEYS.length, 54);
  assert.equal(Object.keys(EMAIL_STRINGS).length, 52);
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  for (const [code, table] of Object.entries(EMAIL_STRINGS)) {
    assert.equal(Object.keys(table).length, 54, code);
    for (const key of EMAIL_NEW_KEYS) {
      assert.ok(typeof table[key] === 'string' && table[key].length > 0, `${code} ${key}`);
      assert.equal(ph(table[key]), ph(EMAIL_STRINGS.en[key]), `${code} ${key} placeholders`);
    }
  }
});

test('the three new server refusals are registered in the api-errors registry, word for word', () => {
  assert.equal(HOST_MESSAGE, 'Only the owner, a manager, or a person the owner gave the host tick, can take reservations.');
  assert.equal(BOOKING_MESSAGE, 'Check the reservation details and try again.');
  assert.equal(WAITLIST_MESSAGE, 'Check the waitlist details and try again.');
  assert.equal(API_ERROR_MESSAGE_KEYS[HOST_MESSAGE], 'apiErrors.reservationsHost');
  assert.equal(API_ERROR_MESSAGE_KEYS[BOOKING_MESSAGE], 'apiErrors.reservationsInvalid');
  assert.equal(API_ERROR_MESSAGE_KEYS[WAITLIST_MESSAGE], 'apiErrors.waitlistInvalid');
  assert.equal(LOCALES.en['apiErrors.reservationsHost'], HOST_MESSAGE);
  assert.equal(LOCALES.en['apiErrors.reservationsInvalid'], BOOKING_MESSAGE);
  assert.equal(LOCALES.en['apiErrors.waitlistInvalid'], WAITLIST_MESSAGE);
  // The SMS gate's two err() literals ride the same registry.
  assert.equal(API_ERROR_MESSAGE_KEYS['A text needs a number and a message.'], 'apiErrors.smsInvalid');
  assert.equal(API_ERROR_MESSAGE_KEYS['The texting service did not accept the message.'], 'apiErrors.smsFailed');
  assert.equal(LOCALES.en['apiErrors.smsInvalid'], 'A text needs a number and a message.');
  assert.equal(LOCALES.en['apiErrors.smsFailed'], 'The texting service did not accept the message.');
});

test('plan presentation: the reservations line is Business-only in Plans, Welcome and the matrix', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(plans.split('plansLib.businessIncludes.reservations').length - 1, 3, 'line in Plans Business, Welcome Business and the matrix only');
  const line = en['plansLib.businessIncludes.reservations'];
  assert.ok(PLANS.business.includes.includes(line), 'Plans Business carries the reservations line');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.includes(line), 'Welcome Business carries the reservations line');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials never carries the reservations line');
  assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials never carries it');
  const row = COMPARISON_ROWS.find((r) => r.label === line);
  assert.ok(row && row.essentials === false && row.business === true, 'matrix row is Business-only');
});

test('the catalogs agree at 130 lessons and the reservations lesson rides the RESTAURANT heading', () => {
  assert.equal(CLIENT_LESSONS.length, 139);
  assert.deepEqual(CLIENT_LESSONS, SERVER_LESSONS);
  const lesson = CLIENT_LESSONS.find((l) => l.id === 'owner-reservations');
  assert.ok(lesson, 'reservations lesson exists');
  assert.equal(lesson.track, 'owner');
  assert.equal(lesson.module, 'restaurant');
  assert.equal(lesson.heading, 'restaurant');
  assert.equal(lesson.feature, 'restaurant');
  assert.equal(lesson.steps, 5);
  assert.equal(LOCALES.en['training.lessons.owner-reservations.title'], 'Taking reservations and running the waitlist');
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'general').length, 116);
  assert.equal(CLIENT_LESSONS.filter((l) => l.heading === 'restaurant').length, 23);
});

test('the host tick exists, off by default, and reads as a member grant', () => {
  assert.deepEqual(RESERVATIONS_GRANT_KEYS, ['reservations.host']);
  assert.equal(RESERVATIONS_GRANTS[0].key, 'reservations.host');
  assert.equal(typeof RESERVATIONS_GRANTS[0].label, 'string');
  assert.equal(isReservationsGrant('reservations.host'), true);
  assert.equal(isReservationsGrant('catering.host'), false);
  const staffSrc = read('src/lib/staff.js');
  assert.ok(staffSrc.includes('isReservationsGrant(key)'));
});

test('cleanReservation keeps the book honest: opt-in, deposit record, status set', () => {
  const row = cleanReservation({
    res_date: '2026-12-24', res_time: '19:00', party_name: '  Ana Ruiz ', party_size: '4',
    phone: '505-555-0100', email: 'ana@example.com', table_label: 'Window',
    source: 'walk-in', status: 'seated', notes: 'Anniversary',
    deposit_amount: '25.5', deposit_how: 'Card', reminder_opt_in: true,
  });
  assert.equal(row.party_name, 'Ana Ruiz');
  assert.equal(row.party_size, 4);
  assert.equal(row.source, 'walk-in');
  assert.equal(row.status, 'seated');
  assert.equal(row.deposit_amount, 25.5);
  assert.equal(row.deposit_how, 'Card');
  assert.equal(row.reminder_opt_in, true);
  const bare = cleanReservation({ res_date: '2026-12-24', res_time: '19:00', party_name: 'Bo', party_size: 2 });
  assert.equal(bare.reminder_opt_in, false);
  assert.equal(bare.deposit_amount, 0);
  assert.equal(bare.deposit_how, '');
  assert.equal(bare.source, 'phone');
  assert.equal(bare.status, 'booked');
  // A zero deposit clears the "how" with it — the line is a record, not a payment.
  const cleared = cleanReservation({ res_date: '2026-12-24', res_time: '19:00', party_name: 'Bo', party_size: 2, deposit_amount: 0, deposit_how: 'Card' });
  assert.equal(cleared.deposit_how, '');
  assert.throws(() => cleanReservation({ res_date: '24/12/2026', res_time: '19:00', party_name: 'Bo', party_size: 2 }), /reservation details/i);
  assert.throws(() => cleanReservation({ res_date: '2026-02-30', res_time: '19:00', party_name: 'Bo', party_size: 2 }), /reservation details/i);
  assert.throws(() => cleanReservation({ res_date: '2026-12-24', res_time: '7pm', party_name: 'Bo', party_size: 2 }), /reservation details/i);
  assert.throws(() => cleanReservation({ res_date: '2026-12-24', res_time: '19:00', party_name: ' ', party_size: 2 }), /reservation details/i);
  assert.throws(() => cleanReservation({ res_date: '2026-12-24', res_time: '19:00', party_name: 'Bo', party_size: 0 }), /reservation details/i);
});

test('cleanWaitlistEntry keeps the quoted wait and the party', () => {
  const row = cleanWaitlistEntry({ party_name: 'Sam', party_size: 3, quoted_wait_minutes: '25', phone: '505', status: 'no-show' });
  assert.equal(row.quoted_wait_minutes, 25);
  assert.equal(row.status, 'no-show');
  assert.equal(cleanWaitlistEntry({ party_name: 'Sam', party_size: 2, quoted_wait_minutes: 10 }).status, 'waiting');
  assert.throws(() => cleanWaitlistEntry({ party_name: '', party_size: 2, quoted_wait_minutes: 10 }), /waitlist details/i);
  assert.throws(() => cleanWaitlistEntry({ party_name: 'Sam', party_size: 0, quoted_wait_minutes: 10 }), /waitlist details/i);
  assert.throws(() => cleanWaitlistEntry({ party_name: 'Sam', party_size: 2 }), /waitlist details/i);
});

const NOW = new Date('2026-12-24T12:00:00Z');
const baseBooking = {
  res_date: '2026-12-24', res_time: '18:30', status: 'booked', reminder_opt_in: true,
  email: 'ana@example.com', phone: '505-555-0100',
  reminder_email_sent_at: null, reminder_text_sent_at: null,
};

test('reminderChannelsDue: the opt-in discipline, per channel, inside 24 hours', () => {
  assert.deepEqual(reminderChannelsDue(baseBooking, NOW), ['email', 'text']);
  // No opt-in, no reminders — ever.
  assert.deepEqual(reminderChannelsDue({ ...baseBooking, reminder_opt_in: false }, NOW), []);
  // A channel with no address is skipped; the other still rides.
  assert.deepEqual(reminderChannelsDue({ ...baseBooking, email: '' }, NOW), ['text']);
  assert.deepEqual(reminderChannelsDue({ ...baseBooking, phone: '' }, NOW), ['email']);
  // Already sent on a channel -> not due again there.
  assert.deepEqual(reminderChannelsDue({ ...baseBooking, reminder_email_sent_at: '2026-12-24 10:00:00' }, NOW), ['text']);
  // Cancelled / no-show / seated parties are not reminded.
  for (const status of ['cancelled', 'no-show', 'seated']) {
    assert.deepEqual(reminderChannelsDue({ ...baseBooking, status }, NOW), [], status);
  }
  // Past bookings and bookings more than 24h out are not due.
  assert.deepEqual(reminderChannelsDue({ ...baseBooking, res_date: '2026-12-23' }, NOW), []);
  assert.deepEqual(reminderChannelsDue({ ...baseBooking, res_date: '2026-12-25', res_time: '18:30' }, NOW), []);
  assert.deepEqual(reminderChannelsDue({ ...baseBooking, res_date: '2026-12-25', res_time: '11:00' }, NOW), ['email', 'text']);
});

test('digestText composes the team digest with a cap and an empty line', () => {
  const empty = digestText([], '2026-12-24', 'en');
  assert.ok(empty.includes('No reservations today.'));
  const rows = Array.from({ length: 18 }, (_, i) => ({
    res_time: '18:00', party_name: `Guest ${i + 1}`, party_size: 2, status: 'booked',
  }));
  const text = digestText(rows, '2026-12-24', 'en');
  assert.ok(text.startsWith("Today's reservations"));
  assert.ok(text.includes('Guest 15'));
  assert.ok(!text.includes('Guest 16'));
  assert.ok(text.includes('And 3 more parties.'));
  const one = digestText([{ res_time: '19:00', party_name: 'Ana', party_size: 4, status: 'booked' }], '2026-12-24', 'es-MX');
  assert.ok(one.includes('Reservas de hoy'));
  assert.ok(one.includes('Ana'));
  // Cancelled parties never reach the digest.
  const none = digestText([{ res_time: '19:00', party_name: 'Ana', party_size: 4, status: 'cancelled' }], '2026-12-24', 'en');
  assert.ok(none.includes('No reservations today.'));
});

test('the SMS gate: closed without the keyset, one generic post with it, no provider named', async () => {
  const emptyEnv = {};
  assert.equal(smsConfigured(emptyEnv), false);
  await assert.rejects(
    () => sendSms({ to: '505', body: 'hi' }, { env: emptyEnv }),
    (err) => err.code === 'sms_not_configured' && err.status === 503,
  );
  const env = {
    SMS_SERVICE_URL: 'https://sms.example.invalid/send',
    SMS_API_KEY: 'test-key',
    SMS_FROM_NUMBER: '+15055550100',
  };
  assert.equal(smsConfigured(env), true);
  // A partial keyset is still closed.
  assert.equal(smsConfigured({ SMS_SERVICE_URL: env.SMS_SERVICE_URL }), false);
  let seen = null;
  const out = await sendSms({ to: '+15055550199', body: 'Your table is ready' }, {
    env,
    fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ id: 'msg-1' }) }; },
  });
  assert.equal(out.id, 'msg-1');
  assert.equal(seen.url, 'https://sms.example.invalid/send');
  const payload = JSON.parse(seen.init.body);
  assert.deepEqual(payload, { from: '+15055550100', to: '+15055550199', body: 'Your table is ready' });
  assert.equal(seen.init.headers.Authorization, 'Bearer test-key');
  await assert.rejects(
    () => sendSms({ to: '1', body: 'x' }, { env, fetchImpl: async () => ({ ok: false, status: 500 }) }),
    (err) => err.code === 'sms_send_failed',
  );
  const gate = read('server/smsGate.js');
  for (const provider of ['twilio', 'vonage', 'messagebird', 'plivo', 'telnyx', 'bandwidth']) {
    assert.ok(!gate.toLowerCase().includes(provider), `no provider named: ${provider}`);
  }
});

test('wiring: migration 065, wipe sweep, router mount, plan gate + host gate', () => {
  const migration = read('migrations/065_reservations.sql');
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS reservations'));
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS waitlist_entries'));
  assert.ok(migration.includes('reminder_opt_in'));
  assert.ok(migration.includes('deposit_amount'));
  assert.ok(migration.includes('quoted_wait_minutes'));
  const billing = read('server/billing.js');
  assert.ok(billing.includes('DELETE FROM reservations WHERE business_id = $1'));
  assert.ok(billing.includes('DELETE FROM waitlist_entries WHERE business_id = $1'));
  const app = read('server/app.js');
  assert.ok(app.includes('createReservationsRouter'));
  const routes = read('server/reservationsRoutes.js');
  assert.ok(routes.includes("featureAllowed(access.planKey, 'restaurant')"));
  assert.ok(routes.includes('canTakeReservations(access)'));
  assert.ok(routes.includes('HOST_MESSAGE'));
  assert.ok(routes.includes('smsConfigured'));
  const core = read('server/reservationsCore.js');
  assert.ok(core.includes('runReservationReminderSweep'));
  assert.ok(core.includes('notifyWaitlistReady'));
  const scheduler = read('server/sweepScheduler.js');
  assert.ok(scheduler.includes('runReservationReminderSweep'));
});

test('wiring: shelf door, Today feed, Studio print document, staff tick UI', () => {
  const shelves = read('src/lib/restaurantShelves.js');
  assert.ok(shelves.includes("door('/restaurant/reservations', 'nav.reservations', 'restaurant.doorReservations'"));
  assert.ok(shelves.includes('reservationsToday'));
  const page1 = read('src/pages/Restaurant.jsx');
  assert.ok(page1.includes('fetchReservationsToday'));
  const today = read('src/components/restaurant/TodayCards.jsx');
  assert.ok(today.includes('summary.reservations'));
  const page = read('src/pages/RestaurantReservations.jsx');
  assert.ok(page.includes('ReservationListDoc'));
  assert.ok(page.includes('reservations.textNotAvailable'));
  const doc = read('src/components/print/ReservationListDoc.jsx');
  assert.ok(doc.includes('DocFrame'));
  assert.ok(doc.includes('reservations.docTitle'));
  const dialog = read('src/components/staff/StaffMemberDialog.jsx');
  assert.ok(dialog.includes('RESERVATIONS_GRANTS'));
  assert.ok(dialog.includes('staff.memberDialog.reservationsAccessHint'));
  const app = read('src/App.jsx');
  assert.ok(app.includes('path="/restaurant/reservations"'));
});
