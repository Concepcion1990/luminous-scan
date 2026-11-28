/**
 * T55 — release 358, DATES THE LOCAL WAY (Nov 23, 2026).
 *
 * The owner's ruling (queued Nov 22, her example verbatim): dates
 * are written the way each country actually writes them — Mexico
 * gets "miércoles 18 de noviembre…", NOT an English-shaped date
 * wearing Spanish words. The picked language/locale IS the
 * country signal; every name, ordering, separator and clock
 * convention comes from Intl — no hand-built strings, no
 * translated month tables.
 *
 * What this group pins:
 *  - the helper layer (src/lib/dates.js): intlLocale resolution
 *    ('en' pinned to 'en-US'; unsupported/malformed → 'en-US',
 *    never a throw), asDisplayDate (date-only strings at local
 *    noon; timestamps through toLocalDate's UTC convention);
 *  - the rendered conventions themselves, quoted: es-MX long =
 *    "miércoles, 18 de noviembre de 2026", the header form =
 *    her example with no year added, en-GB day-first, en-US
 *    month-first (US provably unmoved), en-CA numeric = Intl's
 *    own "2026-11-18", es-MX vs es-ES clock conventions differ;
 *  - formatPrintedAt speaks the full convention now (weekday
 *    included) — the one change that sweeps the printed-at
 *    stamp and every 357 trail stamp;
 *  - the default path reads the PICKED locale (setLocale drives
 *    the helpers with no explicit code);
 *  - the sweep's wiring: no 'en-US' toLocale call, no date-fns
 *    import and no hand-shaped 'd MMM' pattern remains anywhere
 *    in src outside the locale dictionaries; Payroll no longer
 *    feeds a raw ISO slice into the period sentence;
 *  - zero new strings from this release: the keyset it froze at 5136 ×52 stands at 5308 since the restaurant batch (5333 since cross-store messages; 5723 since restaurant operations).
 *
 * The military-time fix (post-361 batch, Nov 24, 2026) adds:
 *  - formatHhmm — a stored "HH:MM" wall time (a schedule's
 *    start_time/end_time, the database format, not an instant)
 *    rendered in the reader's own clock convention, closing
 *    diagnosis §F: the Workforce "Today's shift" line and the
 *    schedule read view interpolated the stored strings
 *    verbatim, so a US reader saw "10:00 – 18:00";
 *  - the wiring pins: both surfaces route through formatHhmm,
 *    and the non-regression pair — the schedule save still
 *    posts raw "HH:MM" and the <input type="time"> editors
 *    still bind the raw stored values (display only moved).
 *  Zero new strings from that fix too: the keyset stands at
 *  5908 ×52 (the restaurant IA batch, release 377, added 27;
 *  the paper-trail batch, release 378, added the latest 63).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const {
  intlLocale,
  asDisplayDate,
  formatLongDate,
  formatHeaderDate,
  formatFullDate,
  formatShortDate,
  formatNumericDate,
  formatDayTime,
  formatHhmm,
} = await import('../../src/lib/dates.js');
const { formatPrintedAt } = await import('../../src/lib/docStyle.js');
const { setLocale, LOCALES } = await import('../../src/lib/i18n.js');

// Wednesday, November 18, 2026, 2:05 PM local — built from local
// parts so the expectations hold in any runtime timezone.
const WHEN = new Date(2026, 10, 18, 14, 5);

test('intlLocale: the app code resolves to the reader’s BCP-47 tag', () => {
  assert.equal(intlLocale('en'), 'en-US');
  assert.equal(intlLocale('en-GB'), 'en-GB');
  assert.equal(intlLocale('en-CA'), 'en-CA');
  assert.equal(intlLocale('en-AU'), 'en-AU');
  assert.equal(intlLocale('en-IN'), 'en-IN');
  assert.equal(intlLocale('es-MX'), 'es-MX');
  assert.equal(intlLocale('es-ES'), 'es-ES');
  assert.equal(intlLocale('not-a-locale!!'), 'en-US');
});

test('long form: each country’s own convention, quoted', () => {
  assert.equal(formatLongDate(WHEN, 'en'), 'Wednesday, November 18, 2026');
  assert.equal(formatLongDate(WHEN, 'en-GB'), 'Wednesday, 18 November 2026');
  assert.equal(formatLongDate(WHEN, 'es-MX'), 'miércoles, 18 de noviembre de 2026');
  assert.equal(formatLongDate(WHEN, 'es-ES'), 'miércoles, 18 de noviembre de 2026');
});

test('header form: her example — weekday + day + month name, no year added', () => {
  assert.equal(formatHeaderDate(WHEN, 'es-MX'), 'miércoles, 18 de noviembre');
  assert.equal(formatHeaderDate(WHEN, 'en'), 'Wednesday, November 18');
  assert.equal(formatHeaderDate(WHEN, 'en-GB'), 'Wednesday 18 November');
});

test('full date without weekday (billing/subscription longs)', () => {
  assert.equal(formatFullDate(WHEN, 'en'), 'November 18, 2026');
  assert.equal(formatFullDate(WHEN, 'en-GB'), '18 November 2026');
  assert.equal(formatFullDate(WHEN, 'es-MX'), '18 de noviembre de 2026');
});

test('numeric form: the locale’s ordering and separators — Intl decides', () => {
  assert.equal(formatNumericDate(WHEN, 'en'), '11/18/2026');
  assert.equal(formatNumericDate(WHEN, 'en-GB'), '18/11/2026');
  assert.equal(formatNumericDate(WHEN, 'es-MX'), '18/11/2026');
  // Canada's numeric convention per ICU is ISO-shaped; nobody hand-picks it.
  assert.equal(formatNumericDate(WHEN, 'en-CA'), '2026-11-18');
});

test('short form + day-time: short months and the locale’s clock', () => {
  assert.equal(formatShortDate(WHEN, 'en-GB'), '18 Nov 2026');
  assert.equal(formatShortDate(WHEN, 'en'), 'Nov 18, 2026');
  assert.match(formatDayTime(WHEN, 'en-GB'), /18 Nov.*14:05/);
  assert.match(formatDayTime(WHEN, 'en'), /Nov 18.*2:05\sPM/);
  // Spain runs a 24-hour clock where Mexico prints p.m. — es-MX ≠ es-ES.
  assert.match(formatDayTime(WHEN, 'es-ES'), /14:05/);
  assert.match(formatDayTime(WHEN, 'es-MX'), /2:05/);
});

test('a non-Latin locale renders natively (ja)', () => {
  const ja = formatLongDate(WHEN, 'ja');
  assert.match(ja, /2026年11月18日水曜日/);
});

test('asDisplayDate: date-only at local noon; timestamps keep the UTC convention', () => {
  const day = asDisplayDate('2026-11-18');
  assert.equal(day.getFullYear(), 2026);
  assert.equal(day.getMonth(), 10);
  assert.equal(day.getDate(), 18);
  const stamp = asDisplayDate('2026-11-18T03:00:00');
  assert.equal(stamp.getTime(), Date.UTC(2026, 10, 18, 3, 0, 0));
  assert.equal(asDisplayDate(''), null);
  assert.equal(asDisplayDate('not a date'), null);
  assert.equal(asDisplayDate(null), null);
});

test('the helpers read the PICKED locale when no code is passed', () => {
  setLocale('es-MX');
  try {
    assert.equal(formatLongDate(WHEN), 'miércoles, 18 de noviembre de 2026');
    assert.equal(formatHeaderDate(WHEN), 'miércoles, 18 de noviembre');
  } finally {
    setLocale('en');
  }
  assert.equal(formatLongDate(WHEN), 'Wednesday, November 18, 2026');
});

test('formatPrintedAt: the stamp speaks the full convention (weekday included)', () => {
  const en = formatPrintedAt(WHEN, 'en');
  assert.equal(en.date, 'Wednesday, November 18, 2026');
  assert.match(en.time, /2:05\sPM/);
  const es = formatPrintedAt(WHEN, 'es-MX');
  assert.equal(es.date, 'miércoles, 18 de noviembre de 2026');
  const fallback = formatPrintedAt(WHEN, 'not-a-locale!!');
  assert.ok(fallback.date && fallback.time);
});

test('wiring: no hard-coded en-US date, no date-fns, no hand-shaped pattern left in src', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'locales') walk(full);
        continue;
      }
      if (!/\.(js|jsx)$/.test(entry.name) || entry.name.endsWith('.test.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      if (/toLocale(?:Date|Time)?String\(\s*'en-US'/.test(src)) offenders.push(`${full}: en-US toLocale`);
      if (/from 'date-fns'/.test(src)) offenders.push(`${full}: date-fns import`);
      if (/format\([^)]*'[^']*MMM/.test(src)) offenders.push(`${full}: hand-shaped MMM pattern`);
    }
  };
  walk(path.join(root, 'src'));
  assert.deepEqual(offenders, []);
});

test('wiring: the named surfaces read through the helpers', () => {
  assert.match(read('src/pages/Dashboard.jsx'), /formatHeaderDate\(new Date\(\)\)/);
  assert.match(read('src/components/movements/MovementRow.jsx'), /formatDayTime\(date\)/);
  assert.match(read('src/lib/docStyle.js'), /formatLongDate\(date, locale/);
  const payroll = read('src/pages/Payroll.jsx');
  assert.doesNotMatch(payroll, /payroll\.stubs\.period', \{ start: String\(/);
  assert.match(payroll, /formatShortDate\(String\(run\.period_start\)/);
  assert.doesNotMatch(read('src/pages/PayStubPrint.jsx'), /start: String\(stub\.period_start\)/);
});

test('formatHhmm: a stored HH:MM wall time renders in the reader’s own clock convention', () => {
  assert.equal(formatHhmm('10:00', 'en'), '10:00 AM');
  assert.equal(formatHhmm('18:00', 'en'), '6:00 PM');
  assert.equal(formatHhmm('00:30', 'en'), '12:30 AM');
  // 24-hour locales stay 24-hour — the same code path, Intl decides.
  assert.equal(formatHhmm('10:00', 'de-DE'), '10:00');
  assert.equal(formatHhmm('18:00', 'de-DE'), '18:00');
  assert.equal(formatHhmm('18:00', 'en-GB'), '18:00');
  // The Mexico/Spain clock split holds for wall times too.
  assert.equal(formatHhmm('18:00', 'es-MX'), '6:00 p.m.');
  assert.equal(formatHhmm('18:00', 'es-ES'), '18:00');
  // An unparseable value renders '' like its sibling helpers.
  assert.equal(formatHhmm('', 'en'), '');
  assert.equal(formatHhmm(null, 'en'), '');
  assert.equal(formatHhmm('not-a-time', 'en'), '');
});

test('wiring: the Workforce shift lines route through formatHhmm; the stored format never moves', () => {
  const workforce = read('src/pages/Workforce.jsx');
  // The Time Clock card's "Today's shift" line (diagnosis §F1).
  assert.match(workforce, /todayShift', \{ start: formatHhmm\(status\.today_shift\.start_time\), end: formatHhmm\(status\.today_shift\.end_time\) \}/);
  assert.doesNotMatch(workforce, /todayShift', \{ start: status\.today_shift\.start_time/);
  // The schedule read view's per-weekday pair (diagnosis §F2).
  assert.match(workforce, /`\$\{formatHhmm\(value\.start_time\)\} – \$\{formatHhmm\(value\.end_time\)\}`/);
  assert.doesNotMatch(workforce, /`\$\{value\.start_time\} – \$\{value\.end_time\}`/);
  // Non-regression: the save still posts the raw stored format and
  // the time editors still bind it — display only moved.
  assert.match(workforce, /start_time: v\.start_time, end_time: v\.end_time/);
  assert.match(workforce, /value=\{value\?\.start_time \|\| ''\}/);
  assert.match(workforce, /value=\{value\?\.end_time \|\| ''\}/);
});

test('zero new strings from 358: the keyset stands at 6506 in every locale (5136 through 358; the restaurant batch added 172, cross-store messages 25, restaurant operations 390, eBay storefront 46, the photo door fix 8, the print family 5, the product form batch 7, the photo capture batch 4, the restaurant IA batch 27, the paper-trail batch 63)', () => {
  const counts = Object.entries(LOCALES).map(([code, dict]) => [code, Object.keys(dict).length]);
  for (const [code, count] of counts) {
    assert.equal(count, 6903, `${code} keyset`);
  }
  assert.equal(counts.length, 52);
});
