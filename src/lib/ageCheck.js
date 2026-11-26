/**
 * Age check by license scan (the owner's spec, Nov 25, 2026).
 *
 * The scanner reads the PDF417 barcode on the back of a driver's
 * license / state ID; this module pulls the birthdate out of the
 * AAMVA payload, does the age math against the owner's own age
 * lines, and answers ONE question — green check or red check.
 *
 * THE APP KEEPS NOTHING WHATSOEVER (her emphasis, confirmed
 * twice). This module is pure: it imports nothing, touches no
 * storage, no network, no log, and holds no state between calls.
 * The payload text exists only as the argument of the call that
 * judges it; the verdict object carries only the answer and the
 * line it was judged against — never a name, a license number,
 * a birthdate, or the person's age. Any future request to log
 * checks goes back to the owner first (the spec's hard rule).
 */

/**
 * The shipped starting lines (Road B, her ruling, Nov 25, 2026:
 * the owner sets the lines in Settings for their own place's
 * law; the app ships sensible defaults). US federal law has set
 * tobacco at 21 since December 2019, and alcohol is 21 across
 * the US; other age-restricted goods commonly sit at 18.
 */
export const DEFAULT_AGE_LINES = { alcohol: 21, tobacco: 21, other: 18 };

export const AGE_CATEGORIES = ['alcohol', 'tobacco', 'other'];

/**
 * A stored line is the owner's number only when it is a whole
 * age in a sane range; anything else falls back to the shipped
 * default for that category — a line is never invented.
 */
function cleanLine(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  if (text === '') return fallback;
  const n = typeof value === 'number' ? value : Number(text);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : fallback;
}

/** The business's age lines, each falling back to its default. */
export function ageLinesFromBusiness(business) {
  return {
    alcohol: cleanLine(business?.age_alcohol, DEFAULT_AGE_LINES.alcohol),
    tobacco: cleanLine(business?.age_tobacco, DEFAULT_AGE_LINES.tobacco),
    other: cleanLine(business?.age_other, DEFAULT_AGE_LINES.other),
  };
}

function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/** AAMVA dates are MMDDYYYY, eight digits, nothing else. */
function parseAamvaDate(digits) {
  if (!/^\d{8}$/.test(digits)) return null;
  const month = Number(digits.slice(0, 2));
  const day = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  if (year < 1900 || year > 2100 || !isRealDate(year, month, day)) return null;
  return { year, month, day };
}

function compareDates(a, b) {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * Reads the two dates an age check may use out of an AAMVA
 * payload: DBB (date of birth) and DBA (expiration). Element
 * IDs sit at the start of a field, fields separated by LF / CR /
 * RS. Anything that does not carry the ANSI header shape and a
 * readable birthdate is not an ID barcode this app can judge —
 * it returns null and the caller answers "unreadable", never a
 * guess. The name, license number and every other element are
 * never read at all.
 */
export function parseIdBarcode(text) {
  const raw = String(text ?? '');
  if (!raw.includes('ANSI')) return null;
  const dobMatch = /(?:^|[\n\r\u001e])DBB(\d{8})/.exec(raw);
  if (!dobMatch) return null;
  const dob = parseAamvaDate(dobMatch[1]);
  if (!dob) return null;
  const expMatch = /(?:^|[\n\r\u001e])DBA(\d{8})/.exec(raw);
  const expiry = expMatch ? parseAamvaDate(expMatch[1]) : null;
  return { dob, expiry };
}

/**
 * Full years old on `today` ({year, month, day}). A February 29
 * birthday is reached on March 1 in a non-leap year (on February
 * 28 the birthday has not happened yet) — the plain month/day
 * comparison gives exactly that.
 */
export function ageOn(dob, today) {
  let age = today.year - dob.year;
  if (today.month < dob.month || (today.month === dob.month && today.day < dob.day)) age -= 1;
  return age;
}

/** Today's date as plain parts, in the reader's own timezone. */
export function todayParts(now = new Date()) {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * THE VERDICT. Judges one scanned payload against one category's
 * line. An expired ID never passes (build-time decision, Nov 25,
 * 2026: the expiration date is the last day the ID is valid; an
 * ID past it is refused with its own answer, whatever the age).
 * The result carries ONLY the status and the line — the payload,
 * the birthdate and the computed age never leave this call.
 *
 * status: 'pass' | 'fail' | 'expired' | 'unreadable'
 */
export function ageVerdict(text, category, lines, today) {
  const line = cleanLine(lines?.[category], DEFAULT_AGE_LINES[category] ?? DEFAULT_AGE_LINES.other);
  const parsed = parseIdBarcode(text);
  if (!parsed) return { status: 'unreadable', line };
  if (parsed.expiry && compareDates(parsed.expiry, today) < 0) return { status: 'expired', line };
  return { status: ageOn(parsed.dob, today) >= line ? 'pass' : 'fail', line };
}
