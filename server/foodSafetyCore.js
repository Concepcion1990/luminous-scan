/**
 * The food-safety file, completed — the pure core (Nov 26,
 * 2026; plan release 370, Gap 6 + the round-2 riders).
 *
 * Five pieces + two riders, one family:
 *  1. CORRECTIVE ACTIONS on temperature logs: an out-of-range
 *     reading REQUIRES a "what did you do" note beside it
 *     before the entry stands complete. The rule lives here
 *     (correctiveActionError) and is enforced by the TempLog
 *     entity validator AND by the safety-log validator below —
 *     one wording, registered, for the whole family.
 *  2. COOLING / REHEATING / SANITIZER LOGS: the same log shape
 *     as the temperature logs (migration 059's safety_logs).
 *     Each kind carries its expected range, judged in Celsius
 *     for temperatures (the 361 preset discipline) and in ppm
 *     for sanitizer strength.
 *  3. The INSPECTION-READY PACKET is a client-side Studio
 *     document gathering the family's papers — no core here.
 *  4. FOOD-HANDLER CERTIFICATE TRACKING: per-person expiry
 *     dates riding the staff-documents machinery (the routes
 *     enforce the `staff.documents` tick pattern). The classes
 *     are the round-2 widened family: the basic food-handler
 *     card, ServSafe manager, alcohol-server, and owner-named
 *     classes ('other' + a label the owner gives it).
 *  5. The MOCK-INSPECTION SELF-CHECK runs on the checklist
 *     engine (server/checklistsCore.js) — the routes build its
 *     template from the caller's own language's item labels.
 *  6. THE SDS SHELF (round-2 rider): safety data sheets stored
 *     via the documents machinery (the staff-document file
 *     rules: types + the universal 25 MB cap), staff-readable.
 *
 * Per-business private throughout: every DB door below scopes
 * to one business; another business's row is simply not found.
 */
import crypto from 'node:crypto';

export const CORRECTIVE_ACTION_MESSAGE =
  'An out-of-range reading needs a note saying what you did about it before it can be saved.';
export const SAFETY_LOG_KIND_MESSAGE = 'That kind of food safety log does not exist.';
export const CERT_EXPIRY_MESSAGE = 'Give the certificate an expiry date.';
export const CERT_MEMBER_MESSAGE = 'That team member is not in this business.';

/** The warning window: a certificate expiring within this
 *  many days warns BEFORE it expires (the tracking's point). */
export const CERT_WARN_DAYS = 30;

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * The family's one rule (piece 1): a reading that missed its
 * range stands complete only with its corrective-action note
 * beside it. Returns the registered wording when the note is
 * owed and missing, else null. In-range readings never owe one.
 */
export function correctiveActionError({ in_range: inRange, corrective_action: action } = {}) {
  if (inRange === false && !String(action || '').trim()) return CORRECTIVE_ACTION_MESSAGE;
  return null;
}

/* ------------------------------------------- safety logs */

export const SAFETY_LOG_KINDS = ['cooling', 'reheating', 'sanitizer'];

/**
 * Each kind's expected range, in the reading's own judging
 * unit: temperatures judge in Celsius (converted from F, the
 * 361 discipline); sanitizer judges in ppm. Cooling is done
 * when the food is at fridge temperature or below; reheating
 * is done at the standard reheat temperature or hotter;
 * chlorine sanitizer is in range in its standard band.
 */
export const SAFETY_RANGES = {
  cooling: { judge: 'C', min: null, max: 5 },
  reheating: { judge: 'C', min: 74, max: null },
  sanitizer: { judge: 'ppm', min: 50, max: 100 },
};

export function safetyLogInRange(kind, reading, unit) {
  const range = SAFETY_RANGES[kind];
  // A missing reading is no reading (Number(null) would be 0 —
  // a phantom fridge-temperature cooling pass).
  const value = reading === null || reading === undefined || reading === '' ? NaN : Number(reading);
  if (!range || !Number.isFinite(value)) return false;
  let judged = value;
  // Fahrenheit converts and rounds to the whole degree a
  // thermometer reads, so the canonical pair agrees: 41 °F
  // is 5 °C and 165 °F is 74 °C, not a hair under either.
  if (range.judge === 'C' && unit === 'F') judged = Math.round(((value - 32) * 5) / 9);
  if (range.min != null && judged < range.min) return false;
  if (range.max != null && judged > range.max) return false;
  return true;
}

/**
 * A safety-log write, cleaned and validated. The unit follows
 * the kind: sanitizer readings are ppm; temperature checks are
 * F or C. The corrective rule is the family's: an out-of-range
 * reading without its note is refused with the registered
 * wording, so no incomplete entry ever stands.
 */
export function cleanSafetyLog(input) {
  const kind = String(input?.kind || '').trim();
  if (!SAFETY_LOG_KINDS.includes(kind)) {
    throw err(400, 'safety_log_kind', SAFETY_LOG_KIND_MESSAGE);
  }
  const subject = String(input?.subject_name || '').trim().slice(0, 200);
  const rawReading = input?.reading;
  const reading = rawReading === null || rawReading === undefined || rawReading === '' ? NaN : Number(rawReading);
  const unit = kind === 'sanitizer' ? 'ppm' : input?.unit === 'C' ? 'C' : 'F';
  const inRange = Number.isFinite(reading) ? safetyLogInRange(kind, reading, unit) : false;
  const corrective = String(input?.corrective_action || '').trim().slice(0, 1000);
  const owed = correctiveActionError({ in_range: inRange, corrective_action: corrective });
  if (owed) throw err(400, 'corrective_action_required', owed);
  return {
    kind,
    subject_name: subject,
    location_id: String(input?.location_id || '').trim() || null,
    location_name: String(input?.location_name || '').trim().slice(0, 200),
    reading: Number.isFinite(reading) ? reading : null,
    unit,
    in_range: inRange,
    corrective_action: corrective,
  };
}

/* ---------------------------------------------- certificates */

export const CERT_CLASSES = ['food_handler', 'servsafe_manager', 'alcohol_server', 'other'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanDate(value) {
  const raw = String(value || '').trim();
  if (!DATE_RE.test(raw)) return null;
  const parsed = new Date(`${raw}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

/**
 * A certificate's standing against a day: 'expired' once its
 * expiry day has passed, 'expiring' inside the warning window
 * (CERT_WARN_DAYS, expiry day included), 'ok' beyond it, and
 * 'none' when the row carries no expiry date at all.
 */
export function certStatus(expiresOn, today, warnDays = CERT_WARN_DAYS) {
  const expiry = cleanDate(expiresOn);
  if (!expiry) return 'none';
  const day = cleanDate(today) || new Date().toISOString().slice(0, 10);
  if (expiry < day) return 'expired';
  const ms = new Date(`${expiry}T12:00:00Z`).getTime() - new Date(`${day}T12:00:00Z`).getTime();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  return days <= warnDays ? 'expiring' : 'ok';
}

/** Whole days from `today` until the expiry date (negative
 *  once it has passed), or null with no real expiry date. */
export function certDaysLeft(expiresOn, today) {
  const expiry = cleanDate(expiresOn);
  if (!expiry) return null;
  const day = cleanDate(today) || new Date().toISOString().slice(0, 10);
  const ms = new Date(`${expiry}T12:00:00Z`).getTime() - new Date(`${day}T12:00:00Z`).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * A certificate write, cleaned and validated: a known class
 * (owner-named classes ride 'other' + their label) and a real
 * expiry date — tracking without the date is not tracking, so
 * its absence is refused with the registered wording.
 */
export function cleanCert(input) {
  const certClass = CERT_CLASSES.includes(input?.cert_class) ? input.cert_class : 'food_handler';
  const expiresOn = cleanDate(input?.expires_on);
  if (!expiresOn) throw err(400, 'food_cert_expiry', CERT_EXPIRY_MESSAGE);
  return {
    cert_class: certClass,
    class_label: certClass === 'other' ? String(input?.class_label || '').trim().slice(0, 120) : '',
    issued_on: cleanDate(input?.issued_on),
    expires_on: expiresOn,
    note: String(input?.note || '').trim().slice(0, 500),
  };
}

function publicCert(row, today) {
  return {
    ...row,
    status: certStatus(row.expires_on, today),
    days_left: certDaysLeft(row.expires_on, today),
  };
}

export async function listCerts(pool, businessId, today) {
  const { rows } = await pool.query(
    'SELECT * FROM food_certs WHERE business_id = $1 ORDER BY expires_on ASC NULLS LAST, member_name ASC',
    [businessId],
  );
  return rows.map((row) => publicCert(row, today));
}

export async function createCert(pool, businessId, member, input, { userId = null, actorName = '' } = {}) {
  const clean = cleanCert(input);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO food_certs (id, business_id, staff_member_id, member_name, cert_class, class_label, issued_on, expires_on, note, created_by_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [id, businessId, member.id, member.full_name || '', clean.cert_class, clean.class_label, clean.issued_on, clean.expires_on, clean.note, userId, actorName],
  );
  return publicCert(rows[0]);
}

export async function deleteCert(pool, businessId, certId) {
  const { rowCount } = await pool.query(
    'DELETE FROM food_certs WHERE id = $1 AND business_id = $2',
    [certId, businessId],
  );
  if (!rowCount) throw err(404, 'not_found', 'Not found.');
}

/* ------------------------------------------------- SDS shelf */

/** One SDS row as the clients render it: metadata only — the
 *  bytes ride the file route (the documents discipline). */
export function shapeSdsSheet(row) {
  return {
    id: row.id,
    title: row.title || '',
    filename: row.filename || '',
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    uploaded_by_name: row.uploaded_by_name || '',
    uploaded_at: row.created_at,
  };
}

export async function listSdsSheets(pool, businessId) {
  const { rows } = await pool.query(
    `SELECT id, title, filename, content_type, size_bytes, uploaded_by_name, created_at
       FROM sds_sheets WHERE business_id = $1 ORDER BY title ASC, created_at DESC`,
    [businessId],
  );
  return rows.map(shapeSdsSheet);
}
