import { getLocale } from './i18n.js';

/**
 * Record timestamps come back without a timezone marker (for example
 * "2026-11-04T03:54:01.598000"), which browsers read as local time and can
 * push an evening movement onto the next calendar day. Stored values are UTC,
 * so mark them as UTC before formatting them for display.
 */
export function toLocalDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = new Date(hasZone ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function localTimeZoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * Dates the local way (release 358, Nov 23, 2026 — the owner's
 * ruling): every human-facing date is written the way the reader's
 * own country writes it — Mexico gets "miércoles, 18 de noviembre
 * de 2026", never an English-shaped date wearing Spanish words.
 * The picked language IS the country signal, and every name,
 * ordering and separator comes from Intl — no hand-built strings,
 * no translated month tables anywhere in the app.
 *
 * intlLocale resolves an app locale code to the BCP-47 tag Intl
 * should speak: the codes are already BCP-47-shaped ('es-MX',
 * 'en-GB', 'zh-Hans'…); the base code 'en' is pinned to 'en-US'
 * explicitly so the US convention never depends on the runtime's
 * default. A code the runtime's ICU does not carry falls back to
 * its base language, then to 'en-US' — a formatter never throws.
 */
export function intlLocale(code) {
  const wanted = code || getLocale() || 'en';
  const tag = wanted === 'en' ? 'en-US' : wanted;
  try {
    if (Intl.DateTimeFormat.supportedLocalesOf(tag).length) return tag;
    const base = tag.split('-')[0];
    if (base !== tag && Intl.DateTimeFormat.supportedLocalesOf(base).length) return base;
  } catch {
    // A malformed tag lands on the fallback below.
  }
  return 'en-US';
}

/**
 * Any stored value → the Date to DISPLAY, or null. Date-only
 * strings ("2026-11-18") parse at local noon — the app's standing
 * convention (Workforce/ProductPrice) — so a bare calendar day
 * never slides to the neighbouring day in a western timezone;
 * timestamps go through toLocalDate (stored values are UTC).
 */
export function asDisplayDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T12:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return toLocalDate(text);
}

function intlFormat(value, options, code) {
  const date = asDisplayDate(value);
  if (!date) return '';
  try {
    return new Intl.DateTimeFormat(intlLocale(code), options).format(date);
  } catch {
    try {
      return new Intl.DateTimeFormat('en-US', options).format(date);
    } catch {
      return '';
    }
  }
}

/** The full convention: weekday + day + month name + year
 * ("miércoles, 18 de noviembre de 2026" / "Wednesday, November 18, 2026"). */
export function formatLongDate(value, code) {
  return intlFormat(value, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, code);
}

/** The Overview header's fields — weekday + day + month name, no
 * year (the surface shows none today; its fields, localized). */
export function formatHeaderDate(value, code) {
  return intlFormat(value, { weekday: 'long', day: 'numeric', month: 'long' }, code);
}

/** Day + month name + year, no weekday ("18 de noviembre de 2026"). */
export function formatFullDate(value, code) {
  return intlFormat(value, { day: 'numeric', month: 'long', year: 'numeric' }, code);
}

/** Day + short month + year ("18 nov 2026" / "Nov 18, 2026"). */
export function formatShortDate(value, code) {
  return intlFormat(value, { day: 'numeric', month: 'short', year: 'numeric' }, code);
}

/** Day + short month, no year ("18 nov" / "Nov 18"). */
export function formatShortDay(value, code) {
  return intlFormat(value, { day: 'numeric', month: 'short' }, code);
}

/** All-numeric date — the locale's own ordering and separators
 * (18/11/2026 day-first, 11/18/2026 in the US, 2026-11-18 in en-CA:
 * Intl decides, nobody hand-picks). */
export function formatNumericDate(value, code) {
  return intlFormat(value, { day: 'numeric', month: 'numeric', year: 'numeric' }, code);
}

/** Short date with the time riding along, the locale's own clock
 * convention (movement rows: "18 nov, 2:05 p.m." / "18 Nov, 14:05"). */
export function formatDayTime(value, code) {
  return intlFormat(value, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }, code);
}

/** The locale's time of day ("2:05 PM" / "14:05"). */
export function formatTimeOnly(value, code) {
  return intlFormat(value, { hour: 'numeric', minute: '2-digit' }, code);
}

/** Whether two instants fall on the same local calendar day,
 * read through the same display-date path as every formatter
 * above. An unreadable value counts as the same day, so a caller
 * never invents a date for a value it cannot read. */
export function sameLocalDay(a, b) {
  const da = asDisplayDate(a);
  const db = asDisplayDate(b);
  if (!da || !db) return true;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** A clock time that names its own day when that day is not the
 * anchor's day — the far end of a span that crossed midnight or
 * was closed on a later day (an entry's clock-out, a break's
 * return). Same day as the anchor: the plain time, exactly as
 * before. Other day: formatDayTime — day and time from one Intl
 * call, never a hand-joined pair. (The date-next-to-the-time
 * rule, the owner's ruling of Nov 25, 2026: a bare time must
 * never hide which day it belongs to.) */
export function formatTimeFromDay(anchor, value, code) {
  return sameLocalDay(anchor, value) ? formatTimeOnly(value, code) : formatDayTime(value, code);
}

/** A stored "HH:MM" wall time (a schedule's start_time/end_time —
 * the database format, NOT an instant) in the locale's own clock
 * convention ("6:00 PM" in en-US, "18:00" in de-DE). The stored
 * string is parsed onto a fixed reference day and formatted
 * through the same Intl path as every other time, so no locale
 * is handed the raw 24-hour storage format. An unparseable
 * value renders '' like its sibling helpers. Display only: the
 * stored format and the <input type="time"> values never move. */
export function formatHhmm(hhmm, code) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(String(hhmm ?? '').trim());
  if (!match) return '';
  const date = new Date(2026, 0, 1, Number(match[1]), Number(match[2]));
  return intlFormat(date, { hour: 'numeric', minute: '2-digit' }, code);
}

/** Medium date + short time, the locale's own styles. */
export function formatDateTime(value, code) {
  return intlFormat(value, { dateStyle: 'medium', timeStyle: 'short' }, code);
}