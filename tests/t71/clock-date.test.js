/**
 * T71 — the "Clocked in since" DATE fix (the release after 378;
 * the owner's ruling of Nov 25, 2026, her words: the line must
 * "say the exact date next to it — because I don't know when
 * 8:56 PM when that fell"). She had found her own Nov 23
 * called-in entry still open on Nov 25, wearing a bare
 * "Clocked in since 8:56 PM" with no date anywhere on it.
 *
 * What changed, and what this group pins BY EXECUTION:
 *  - the Time Clock card's line (workforce.clockedInSince) now
 *    carries a {date} placeholder beside its {time} in all 52
 *    locales — each value keeps its own sentence, the date
 *    seated in that language's grammar; the date VALUE comes
 *    from the Intl machinery (formatShortDay, release 358),
 *    never from translated word order. Keyset unchanged:
 *    5908 ×52, zero new keys, 52 values changed.
 *  - the composed line, executed through the real i18n t() and
 *    the real dates helpers exactly as Workforce.jsx composes
 *    it: a previous-day clock-in renders the owner's example
 *    verbatim ("Clocked in since Nov 23, 8:56 PM"), a same-day
 *    clock-in still names its date (the ruling is ALWAYS), and
 *    es-MX renders its own grammar ("Entrada registrada el
 *    23 nov a las …"), not the old time-only article.
 *  - the sibling sweep's one helper (lib/dates
 *    formatTimeFromDay): the far end of an entry span — the
 *    clock-out in the entries list, a break's out and return —
 *    renders the plain time when it shares the clock-in's day
 *    (byte-for-byte the old display) and day + time, from one
 *    Intl call, when it falls on another day (an overnight
 *    shift, a late-closed stranded entry).
 *  - the wiring pins: Workforce.jsx feeds the line {date} +
 *    {time} and routes the three far ends through
 *    formatTimeFromDay; the surfaces the sweep judged sound
 *    stay untouched (the clock board's "Clocked in {when}"
 *    already carried month + day; the on-break line renders
 *    no time at all).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const { LOCALES, setLocale, t } = await import('../../src/lib/i18n.js');
const { formatShortDay, formatTimeOnly, formatDayTime, formatTimeFromDay, sameLocalDay } =
  await import('../../src/lib/dates.js');

// Built from local parts so the expectations hold in any
// runtime timezone (the t55 convention).
const PREV_DAY = new Date(2026, 10, 23, 20, 56); // Mon Nov 23, 8:56 PM
const SAME_DAY = new Date(2026, 10, 25, 9, 0); // Wed Nov 25, 9:00 AM

const composeLine = (value) =>
  t('workforce.clockedInSince', { date: formatShortDay(value), time: formatTimeOnly(value) });

test('the keyset stands at 6506 in all 52 locales — zero new keys', () => {
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) {
    assert.equal(Object.keys(LOCALES[code]).length, 6583, `${code} keyset`);
  }
});

test('every locale’s pattern carries {date} and {time} exactly once each', () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    const value = dict['workforce.clockedInSince'];
    assert.equal(typeof value, 'string', `${code} value present`);
    assert.equal((value.match(/\{date\}/g) || []).length, 1, `${code} {{date}} count`);
    assert.equal((value.match(/\{time\}/g) || []).length, 1, `${code} {{time}} count`);
  }
});

test('the five Englishes stay byte-identical on the changed line', () => {
  const en = LOCALES.en['workforce.clockedInSince'];
  assert.equal(en, 'Clocked in since {date}, {time}');
  for (const code of ['en-AU', 'en-CA', 'en-GB', 'en-IN']) {
    assert.equal(LOCALES[code]['workforce.clockedInSince'], en, code);
  }
});

test('a previous-day clock-in renders the owner’s example verbatim', () => {
  setLocale('en');
  assert.equal(composeLine(PREV_DAY), 'Clocked in since Nov 23, 8:56 PM');
});

test('a same-day clock-in still names its date — the ruling is always', () => {
  setLocale('en');
  assert.equal(composeLine(SAME_DAY), 'Clocked in since Nov 25, 9:00 AM');
});

test('es-MX renders its own grammar, not the old time-only article', () => {
  setLocale('es-MX');
  const line = composeLine(PREV_DAY);
  assert.equal(line, `Entrada registrada el ${formatShortDay(PREV_DAY)} a las ${formatTimeOnly(PREV_DAY)}`);
  assert.ok(line.includes('23 nov'), line);
  assert.ok(!line.includes('desde las'), line);
});

test('no locale composes the line with a leftover placeholder or the raw key', () => {
  for (const code of Object.keys(LOCALES)) {
    setLocale(code);
    const line = composeLine(PREV_DAY);
    assert.ok(!line.includes('{date}') && !line.includes('{time}'), `${code}: ${line}`);
    assert.notEqual(line, 'workforce.clockedInSince', code);
    assert.ok(line.includes(formatShortDay(PREV_DAY)), `${code} carries its own date: ${line}`);
    assert.ok(line.includes(formatTimeOnly(PREV_DAY)), `${code} carries its own time: ${line}`);
  }
  setLocale('en');
});

test('sameLocalDay reads the local calendar, null-safe', () => {
  assert.equal(sameLocalDay(new Date(2026, 10, 23, 0, 1), new Date(2026, 10, 23, 23, 59)), true);
  assert.equal(sameLocalDay(new Date(2026, 10, 23, 23, 59), new Date(2026, 10, 24, 0, 1)), false);
  assert.equal(sameLocalDay('not a date', PREV_DAY), true);
  assert.equal(sameLocalDay(null, undefined), true);
});

test('formatTimeFromDay: same day is the plain time, exactly as before', () => {
  const out = new Date(2026, 10, 23, 23, 5);
  assert.equal(formatTimeFromDay(PREV_DAY, out), formatTimeOnly(out));
  assert.equal(formatTimeFromDay(PREV_DAY, out), '11:05 PM');
});

test('formatTimeFromDay: another day names the day, from one Intl call', () => {
  const out = new Date(2026, 10, 25, 17, 54); // the stranded entry's real close
  assert.equal(formatTimeFromDay(PREV_DAY, out), formatDayTime(out));
  assert.equal(formatTimeFromDay(PREV_DAY, out), 'Nov 25, 5:54 PM');
  // An overnight span: in late evening, out just past midnight.
  const lateIn = new Date(2026, 10, 23, 23, 48);
  const afterMidnight = new Date(2026, 10, 24, 0, 20);
  assert.equal(formatTimeFromDay(lateIn, afterMidnight), 'Nov 24, 12:20 AM');
});

test('wiring: the card line takes {date} + {time}; the far ends route through the helper', () => {
  const page = read('src/pages/Workforce.jsx');
  assert.ok(
    page.includes("t('workforce.clockedInSince', {") &&
      page.includes('date: formatDay(open.clock_in_at)') &&
      page.includes('time: formatTime(open.clock_in_at)'),
    'the clocked-in line is fed date + time',
  );
  assert.ok(
    page.includes('formatTimeFromDay(entry.clock_in_at, entry.clock_out_at)'),
    'the entries clock-out names its day when it differs',
  );
  assert.ok(
    page.includes('formatTimeFromDay(entry.clock_in_at, b.out_at)') &&
      page.includes('formatTimeFromDay(entry.clock_in_at, b.in_at)'),
    'the break ends name their day when they differ',
  );
  assert.ok(!page.includes("time: formatTime(open.clock_in_at) })"), 'the bare-time call is gone');
});

test('the sweep’s sound surfaces stay untouched', () => {
  const card = read('src/components/staff/ClockAttentionCard.jsx');
  // Amended by the smalls bundle (Nov 25, 2026): 379 judged this card's
  // own formatting sound on its face, but the card parsed stored
  // timestamps with the raw `new Date(...)`, which can read the hour in
  // the wrong zone and push a near-midnight moment across a day. The
  // owner's ruling ("Let's fix it please") swapped the card onto the
  // house machinery — the board's "Clocked in {when}" still carries
  // month + day, now through formatDayTime/formatTimeOnly.
  assert.ok(
    card.includes("from '@/lib/dates'") &&
      card.includes('formatDayTime(iso)') &&
      card.includes('formatTimeOnly(iso)') &&
      card.includes("t('staff.callIn.clockedInAt'"),
    'the attention card reads stored times through the house machinery',
  );
  // The on-break line renders no time at all — nothing to date.
  assert.equal(LOCALES.en['workforce.onBreak'], 'You are checked out on a break.');
});
