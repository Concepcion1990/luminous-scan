/**
 * Reservations book + walk-in waitlist + deposit line —
 * the core (Nov 26, 2026; plan release 376 with its two
 * Part 7 riders: round-2 Gap 1 waitlist, deposit quick-fire).
 *
 * THE BOOK: date and time, party name and size, phone,
 * table or section as a simple owner-named label, where it
 * came from (phone / walk-in), status (booked → seated /
 * no-show / cancelled), notes. Day view and week view on
 * the page; today's list surfaces on the Today page; a
 * staff digest of today's list rides the existing team
 * messaging (the workforce inbox fan-out).
 *
 * HONEST BOUNDARY, IN THE SHAPE: this is a BOOK, not a
 * live dining-room floor — no minute-to-minute table
 * state, no online booking widget. The waitlist is a
 * queue, not a floor plan: the host says when a party is
 * seated.
 *
 * DOCTRINES:
 *  - BUSINESS-ONLY: the routes sit behind the restaurant
 *    corner's plan gate; nothing here exists on Essentials.
 *  - TAKING RESERVATIONS IS HOST WORK: writes ride the
 *    owner-grant tick `reservations.host`, off by default
 *    (the owner and managers always keep the book). Reads
 *    are open to the whole team — the floor works from
 *    the book.
 *  - GUEST CONTACT DETAILS LIVE ONLY IN THE BOOK: phone
 *    and email are stored here, used only for the word
 *    the guest agreed to (a reminder they asked for, the
 *    waitlist "your table is ready"), and never exported.
 *  - Q6 — GUESTS ARE REMINDED ONLY WITH THEIR OWN
 *    ACCEPTANCE: at booking the guest is asked; only a
 *    guest who said yes (reminder_opt_in) is ever sent a
 *    reminder, on either channel. Channels: EMAIL (live,
 *    on the app's Resend machinery) and TEXT (behind the
 *    SMS keyset gate — server/smsGate.js; until the
 *    keyset exists the text channel is "not available
 *    yet" BY DESIGN and a text is never marked sent).
 *    For the waitlist, handing over a number to be texted
 *    when the table is ready IS the ask and the yes in
 *    one act — that is the opt-in for the waitlist text.
 *  - THE DEPOSIT LINE IS A RECORD, NOT A PAYMENT: a
 *    booking records "deposit taken, how much, how".
 *    Taking card holds is payments territory and stays
 *    out — nothing here moves money.
 *  - Per-business private: every read and write is scoped
 *    to one business.
 */
import crypto from 'node:crypto';
import { emailStringsFor, fillEmail } from './emailStrings.js';
import { sendMail } from './email.js';
import { sendSms, smsConfigured } from './smsGate.js';

export const HOST_MESSAGE =
  'Only the owner, a manager, or a person the owner gave the host tick, can take reservations.';
export const BOOKING_MESSAGE = 'Check the reservation details and try again.';
export const WAITLIST_MESSAGE = 'Check the waitlist details and try again.';

export const RESERVATIONS_HOST_TICK = 'reservations.host';

export const RESERVATION_STATUSES = ['booked', 'seated', 'no-show', 'cancelled'];
export const RESERVATION_SOURCES = ['phone', 'walk-in'];
export const WAITLIST_STATUSES = ['waiting', 'seated', 'no-show', 'dropped'];

/** A reminder is due inside this window before the booking. */
export const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanText(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanDate(value, message) {
  const date = cleanText(value, 10);
  if (!DATE_RE.test(date)) throw err(400, 'reservations_invalid', message);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw err(400, 'reservations_invalid', message);
  }
  return date;
}

function cleanMoney(value, message) {
  if (value === null || value === undefined || String(value).trim() === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw err(400, 'reservations_invalid', message);
  return round2(n);
}

/** A manager-level member (the roster/clock ticks' own
 *  test, mirrored from checklistsCore): preset-manager
 *  role, or a role named "manager". */
export function isManagerAccess(access) {
  if (!access || access.isOwner) return Boolean(access?.isOwner);
  const row = access.staffRow;
  if (!row) return false;
  return row.role_id === 'preset-manager' || String(row.role_name || '').trim().toLowerCase() === 'manager';
}

/** Who may take reservations and run the waitlist: the
 *  owner, a manager, or a member holding the host tick. */
export function canTakeReservations(access) {
  if (!access) return false;
  if (access.isOwner || isManagerAccess(access)) return true;
  return Array.isArray(access.permissions) && access.permissions.includes(RESERVATIONS_HOST_TICK);
}

/* ------------------------------------------------- the book */

/** One booking, cleaned for writing. The reminder opt-in
 *  is the guest's own word: anything but an explicit true
 *  is a no. The deposit is a record — amount + how — and
 *  an amount of zero clears the "how" with it. */
export function cleanReservation(input) {
  const resDate = cleanDate(input?.res_date, BOOKING_MESSAGE);
  const resTime = cleanText(input?.res_time, 5);
  if (resTime && !TIME_RE.test(resTime)) throw err(400, 'reservations_invalid', BOOKING_MESSAGE);
  const partyName = cleanText(input?.party_name, 200);
  if (!partyName) throw err(400, 'reservations_invalid', BOOKING_MESSAGE);
  const party = Number(input?.party_size);
  if (!Number.isFinite(party) || party < 1 || party > 100000) {
    throw err(400, 'reservations_invalid', BOOKING_MESSAGE);
  }
  const deposit = cleanMoney(input?.deposit_amount, BOOKING_MESSAGE);
  return {
    res_date: resDate,
    res_time: resTime,
    party_name: partyName,
    party_size: Math.round(party),
    phone: cleanText(input?.phone, 60),
    email: cleanText(input?.email, 200),
    table_label: cleanText(input?.table_label, 120),
    source: RESERVATION_SOURCES.includes(input?.source) ? input.source : 'phone',
    status: RESERVATION_STATUSES.includes(input?.status) ? input.status : 'booked',
    notes: cleanText(input?.notes, 2000),
    deposit_amount: deposit,
    deposit_how: deposit > 0 ? cleanText(input?.deposit_how, 120) : '',
    reminder_opt_in: input?.reminder_opt_in === true,
  };
}

export function shapeReservation(row) {
  return {
    id: row.id,
    res_date: row.res_date || '',
    res_time: row.res_time || '',
    party_name: row.party_name || '',
    party_size: Number(row.party_size) || 0,
    phone: row.phone || '',
    email: row.email || '',
    table_label: row.table_label || '',
    source: row.source || 'phone',
    status: row.status || 'booked',
    notes: row.notes || '',
    deposit_amount: round2(row.deposit_amount),
    deposit_how: row.deposit_how || '',
    reminder_opt_in: row.reminder_opt_in === true,
    reminder_email_sent_at: row.reminder_email_sent_at || null,
    reminder_text_sent_at: row.reminder_text_sent_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

/* ------------------------------------------------- the queue */

/** One waitlist entry, cleaned for writing. The quoted
 *  wait is part of the record and is kept after the party
 *  leaves the queue, whichever way they leave it. */
export function cleanWaitlistEntry(input) {
  const partyName = cleanText(input?.party_name, 200);
  if (!partyName) throw err(400, 'waitlist_invalid', WAITLIST_MESSAGE);
  const party = Number(input?.party_size);
  if (!Number.isFinite(party) || party < 1 || party > 100000) {
    throw err(400, 'waitlist_invalid', WAITLIST_MESSAGE);
  }
  const quoted = Number(input?.quoted_wait_minutes);
  if (!Number.isFinite(quoted) || quoted < 0 || quoted > 10000) {
    throw err(400, 'waitlist_invalid', WAITLIST_MESSAGE);
  }
  return {
    party_name: partyName,
    party_size: Math.round(party),
    phone: cleanText(input?.phone, 60),
    email: cleanText(input?.email, 200),
    quoted_wait_minutes: Math.round(quoted),
    status: WAITLIST_STATUSES.includes(input?.status) ? input.status : 'waiting',
  };
}

export function shapeWaitlistEntry(row) {
  return {
    id: row.id,
    party_name: row.party_name || '',
    party_size: Number(row.party_size) || 0,
    phone: row.phone || '',
    email: row.email || '',
    quoted_wait_minutes: Number(row.quoted_wait_minutes) || 0,
    status: row.status || 'waiting',
    ready_notified_at: row.ready_notified_at || null,
    ready_channel: row.ready_channel || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

/* ------------------------------------- reminders (Q6) */

/** The booking's moment as a timestamp: its date at its
 *  time (or midday when no time was taken), read as UTC —
 *  the same convention the date cleaner validates with.
 *  Null when the row carries no usable date. */
export function reservationMoment(row) {
  const date = String(row?.res_date || '');
  if (!DATE_RE.test(date)) return null;
  const time = TIME_RE.test(String(row?.res_time || '')) ? row.res_time : '12:00';
  const ms = Date.parse(`${date}T${time}:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Which reminder channels are due for one booking at `now`
 * — the Q6 discipline as a pure rule, so it can be tested
 * by name:
 *  - the booking is still booked (not seated, no-showed
 *    or cancelled);
 *  - the guest said YES (reminder_opt_in) — a no, or no
 *    answer, is never reminded on either channel;
 *  - its moment is ahead of now and at most 24 hours away;
 *  - a channel is due only when the guest gave that
 *    channel an address (an email for email, a phone for
 *    text) and that channel has not already been sent.
 * Returns a subset of ['email', 'text'].
 */
export function reminderChannelsDue(row, now = new Date()) {
  if (!row || row.status !== 'booked' || row.reminder_opt_in !== true) return [];
  const moment = reservationMoment(row);
  if (moment === null) return [];
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) return [];
  const ahead = moment - nowMs;
  if (ahead <= 0 || ahead > REMINDER_WINDOW_MS) return [];
  const due = [];
  if (row.email && !row.reminder_email_sent_at) due.push('email');
  if (row.phone && !row.reminder_text_sent_at) due.push('text');
  return due;
}

/** The guest reminder email, in the business's language —
 *  the restaurant writing to its own guest, so the words
 *  carry the business's name and nothing else (the
 *  white-label rule the purchase-order mail follows). */
export function guestReminderEmail({ businessName, businessLang, reservation }) {
  const s = emailStringsFor(businessLang);
  const values = {
    business: businessName || '',
    name: reservation.party_name || '',
    date: reservation.res_date || '',
    time: reservation.res_time || '',
    count: reservation.party_size || 0,
  };
  return {
    to: reservation.email,
    subject: fillEmail(s['guestReminder.subject'], values),
    text: fillEmail(s['guestReminder.body'], values),
  };
}

/** The same reminder as a text — short, same words' shape. */
export function guestReminderText({ businessName, businessLang, reservation }) {
  const s = emailStringsFor(businessLang);
  return fillEmail(s['guestText.reminder'], {
    business: businessName || '',
    date: reservation.res_date || '',
    time: reservation.res_time || '',
    count: reservation.party_size || 0,
  });
}

/** The "your table is ready" email for a waitlist party. */
export function waitlistReadyEmail({ businessName, businessLang, entry }) {
  const s = emailStringsFor(businessLang);
  const values = { business: businessName || '', name: entry.party_name || '' };
  return {
    to: entry.email,
    subject: fillEmail(s['waitlistReady.subject'], values),
    text: fillEmail(s['waitlistReady.body'], values),
  };
}

/** The "your table is ready" text for a waitlist party. */
export function waitlistReadyText({ businessName, businessLang, entry }) {
  const s = emailStringsFor(businessLang);
  return fillEmail(s['guestText.ready'], {
    business: businessName || '',
    name: entry.party_name || '',
  });
}

/* ------------------------------------- the staff digest */

/**
 * The "today's reservations" digest text — composed in
 * the business's language from the server string table,
 * capped so a huge night stays one message: the first
 * DIGEST_MAX_LINES parties by name, then the "and N more"
 * line. Pure.
 */
export const DIGEST_MAX_LINES = 15;

export function digestText(reservations, date, businessLang) {
  const s = emailStringsFor(businessLang);
  const booked = (reservations || []).filter((r) => r.status === 'booked' || r.status === 'seated');
  const lines = [fillEmail(s['digest.header'], { date })];
  if (!booked.length) {
    lines.push(s['digest.empty']);
    return lines.join('\n');
  }
  for (const r of booked.slice(0, DIGEST_MAX_LINES)) {
    lines.push(fillEmail(s['digest.partyLine'], {
      time: r.res_time || '',
      name: r.party_name || '',
      count: r.party_size || 0,
    }));
  }
  if (booked.length > DIGEST_MAX_LINES) {
    lines.push(fillEmail(s['digest.more'], { count: booked.length - DIGEST_MAX_LINES }));
  }
  return lines.join('\n');
}

/* --------------------------------------------------- DB doors */

export async function listReservations(pool, businessId, { from = null, to = null } = {}) {
  const clauses = ['business_id = $1'];
  const params = [businessId];
  if (from && DATE_RE.test(from)) { params.push(from); clauses.push(`res_date >= $${params.length}`); }
  if (to && DATE_RE.test(to)) { params.push(to); clauses.push(`res_date <= $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT * FROM reservations WHERE ${clauses.join(' AND ')}
     ORDER BY res_date ASC, res_time ASC, party_name ASC`,
    params,
  );
  return rows.map(shapeReservation);
}

export async function reservationsOn(pool, businessId, date) {
  const { rows } = await pool.query(
    `SELECT * FROM reservations WHERE business_id = $1 AND res_date = $2
     ORDER BY res_time ASC, party_name ASC`,
    [businessId, date],
  );
  return rows.map(shapeReservation);
}

export async function createReservation(pool, businessId, input, { userId = null } = {}) {
  const clean = cleanReservation(input);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO reservations
       (id, business_id, res_date, res_time, party_name, party_size, phone, email, table_label,
        source, status, notes, deposit_amount, deposit_how, reminder_opt_in, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [id, businessId, clean.res_date, clean.res_time, clean.party_name, clean.party_size,
      clean.phone, clean.email, clean.table_label, clean.source, clean.status, clean.notes,
      clean.deposit_amount, clean.deposit_how, clean.reminder_opt_in, userId],
  );
  return shapeReservation(rows[0]);
}

export async function updateReservation(pool, businessId, reservationId, input) {
  const existing = (await pool.query(
    'SELECT * FROM reservations WHERE id = $1 AND business_id = $2 LIMIT 1',
    [reservationId, businessId],
  )).rows[0];
  if (!existing) throw err(404, 'not_found', 'Not found.');
  const clean = cleanReservation(input);
  const { rows } = await pool.query(
    `UPDATE reservations SET
       res_date = $3, res_time = $4, party_name = $5, party_size = $6, phone = $7, email = $8,
       table_label = $9, source = $10, status = $11, notes = $12, deposit_amount = $13,
       deposit_how = $14, reminder_opt_in = $15, updated_at = NOW()
     WHERE id = $1 AND business_id = $2
     RETURNING *`,
    [reservationId, businessId, clean.res_date, clean.res_time, clean.party_name, clean.party_size,
      clean.phone, clean.email, clean.table_label, clean.source, clean.status, clean.notes,
      clean.deposit_amount, clean.deposit_how, clean.reminder_opt_in],
  );
  return shapeReservation(rows[0]);
}

export async function deleteReservation(pool, businessId, reservationId) {
  const { rowCount } = await pool.query(
    'DELETE FROM reservations WHERE id = $1 AND business_id = $2',
    [reservationId, businessId],
  );
  if (!rowCount) throw err(404, 'not_found', 'Not found.');
}

export async function listWaitlist(pool, businessId) {
  const { rows } = await pool.query(
    `SELECT * FROM waitlist_entries WHERE business_id = $1
     ORDER BY CASE WHEN status = 'waiting' THEN 0 ELSE 1 END, created_at ASC`,
    [businessId],
  );
  return rows.map(shapeWaitlistEntry);
}

export async function createWaitlistEntry(pool, businessId, input, { userId = null } = {}) {
  const clean = cleanWaitlistEntry(input);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO waitlist_entries
       (id, business_id, party_name, party_size, phone, email, quoted_wait_minutes, status, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [id, businessId, clean.party_name, clean.party_size, clean.phone, clean.email,
      clean.quoted_wait_minutes, clean.status, userId],
  );
  return shapeWaitlistEntry(rows[0]);
}

export async function updateWaitlistEntry(pool, businessId, entryId, input) {
  const existing = (await pool.query(
    'SELECT * FROM waitlist_entries WHERE id = $1 AND business_id = $2 LIMIT 1',
    [entryId, businessId],
  )).rows[0];
  if (!existing) throw err(404, 'not_found', 'Not found.');
  const clean = cleanWaitlistEntry({ ...shapeWaitlistEntry(existing), ...input });
  const { rows } = await pool.query(
    `UPDATE waitlist_entries SET
       party_name = $3, party_size = $4, phone = $5, email = $6, quoted_wait_minutes = $7,
       status = $8, updated_at = NOW()
     WHERE id = $1 AND business_id = $2
     RETURNING *`,
    [entryId, businessId, clean.party_name, clean.party_size, clean.phone, clean.email,
      clean.quoted_wait_minutes, clean.status],
  );
  return shapeWaitlistEntry(rows[0]);
}

/* ------------------------------------- sends */

/**
 * Tell one waitlist party their table is ready — every
 * channel the guest gave, each with its own honest
 * outcome:
 *  - TEXT: behind the SMS keyset gate. Gate closed → the
 *    channel reports 'not_available' and NOTHING is
 *    stamped; the party is told by any other channel
 *    that works, and the page says plainly that texting
 *    is not available yet.
 *  - EMAIL: live on the app's mail machinery wherever
 *    the guest gave an address.
 * The waitlist opt-in is the act itself: the number was
 * handed over to be texted when the table is ready.
 * A successful tell stamps ready_notified_at +
 * ready_channel on the entry (the first channel that
 * landed names the record; both are reported back).
 */
export async function notifyWaitlistReady(pool, business, entryId, {
  sendMailImpl = sendMail,
  sendSmsImpl = sendSms,
  smsReady = null,
} = {}) {
  const entry = (await pool.query(
    'SELECT * FROM waitlist_entries WHERE id = $1 AND business_id = $2 LIMIT 1',
    [entryId, business.id],
  )).rows[0];
  if (!entry) throw err(404, 'not_found', 'Not found.');
  const lang = business.language || 'en';
  const textAvailable = smsReady === null ? smsConfigured() : smsReady;
  const outcome = { email: 'skipped', text: 'skipped' };
  let landedChannel = '';

  if (entry.phone) {
    if (!textAvailable) {
      outcome.text = 'not_available';
    } else {
      try {
        await sendSmsImpl({ to: entry.phone, body: waitlistReadyText({ businessName: business.name, businessLang: lang, entry }) });
        outcome.text = 'sent';
        landedChannel = landedChannel || 'text';
      } catch {
        outcome.text = 'failed';
      }
    }
  }
  if (entry.email) {
    try {
      await sendMailImpl(waitlistReadyEmail({ businessName: business.name, businessLang: lang, entry }));
      outcome.email = 'sent';
      landedChannel = landedChannel || 'email';
    } catch {
      outcome.email = 'failed';
    }
  }
  if (landedChannel) {
    const { rows } = await pool.query(
      `UPDATE waitlist_entries SET ready_notified_at = NOW(), ready_channel = $3, updated_at = NOW()
       WHERE id = $1 AND business_id = $2 RETURNING *`,
      [entryId, business.id, landedChannel],
    );
    return { entry: shapeWaitlistEntry(rows[0]), outcome };
  }
  return { entry: shapeWaitlistEntry(entry), outcome };
}

/**
 * The guest-reminder sweep — the scheduled half of Q6.
 * Composed into the sweep scheduler behind the same
 * presence guard as the eBay sweep, and safe to run any
 * number of times: each channel send is CLAIMED first
 * (the stamp lands only if it was still null) and a
 * failed send releases the claim, so no guest is ever
 * reminded twice and nothing is marked sent that did
 * not go out (the trial-reminder ledger's discipline).
 *
 * The TEXT channel behind the gate: while the keyset is
 * absent the sweep does not even claim a text — it counts
 * the booking as text-pending and leaves the stamp null,
 * so the day the keyset lands the pending reminders are
 * still honestly unsent (any still inside their window
 * then go out; the rest simply stay a record).
 */
export async function runReservationReminderSweep(pool, {
  now = new Date(),
  logger = console,
  sendMailImpl = sendMail,
  sendSmsImpl = sendSms,
  smsReady = null,
} = {}) {
  const summary = { sent: [], pending: [], textPending: 0, failures: [] };
  if (!pool) return summary;
  const textAvailable = smsReady === null ? smsConfigured() : smsReady;
  const { rows } = await pool.query(
    `SELECT r.*, b.name AS business_name, b.language AS business_language
       FROM reservations r JOIN businesses b ON b.id = r.business_id
      WHERE r.status = 'booked' AND r.reminder_opt_in = TRUE
        AND (r.reminder_email_sent_at IS NULL OR r.reminder_text_sent_at IS NULL)
      ORDER BY r.res_date ASC, r.res_time ASC
      LIMIT 500`,
  );
  for (const row of rows) {
    const due = reminderChannelsDue(row, now);
    if (!due.length) continue;
    const businessName = row.business_name || '';
    const lang = row.business_language || 'en';
    for (const channel of due) {
      if (channel === 'text' && !textAvailable) {
        summary.textPending += 1;
        continue;
      }
      const stampColumn = channel === 'email' ? 'reminder_email_sent_at' : 'reminder_text_sent_at';
      const claimed = await pool.query(
        `UPDATE reservations SET ${stampColumn} = NOW()
          WHERE id = $1 AND ${stampColumn} IS NULL RETURNING id`,
        [row.id],
      );
      if (!claimed.rows[0]) continue; // another sweep holds this send
      try {
        if (channel === 'email') {
          await sendMailImpl(guestReminderEmail({ businessName, businessLang: lang, reservation: row }));
        } else {
          await sendSmsImpl({ to: row.phone, body: guestReminderText({ businessName, businessLang: lang, reservation: row }) });
        }
        summary.sent.push({ reservationId: row.id, channel });
      } catch (error) {
        await pool.query(
          `UPDATE reservations SET ${stampColumn} = NULL WHERE id = $1`,
          [row.id],
        ).catch(() => {});
        summary.pending.push({ reservationId: row.id, channel });
        summary.failures.push({ reservationId: row.id, channel, reason: error.message });
        logger.error?.(`[twin] guest reminder ${channel} failed for reservation ${row.id}: ${error.message}`);
      }
    }
  }
  return summary;
}
