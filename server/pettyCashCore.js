/**
 * Petty cash + bank deposit log — the pure core
 * (Nov 26, 2026; plan Part 7, owner-ruled addition G-A,
 * gap-check G1).
 *
 * WHAT LIVES HERE (no database, no HTTP):
 *  - the wording constants every refusal carries (keyed
 *    in the apiErrors registry, translated ×52);
 *  - the entry cleaning for the two small money records
 *    that live beside the manager cash-up / cash count:
 *      PETTY CASH — cash out of the tin: the amount, what
 *      it was for, whether the receipt came back in, and
 *      the initials of who took it.
 *      BANK DEPOSIT — what left for the bank: the amount,
 *      when, in what bag, and the initials of who
 *      carried it.
 *  - the totals the page and the Studio print share.
 *
 * OWNER-ONLY MONEY: both logs are the owner's books —
 * the routes serve them to the owner alone, so no
 * shaping question ever arises: a non-owner is refused
 * before a single row is read (the owner-only money
 * doctrine, enforced server-side).
 *
 * GENERAL, BOTH PLANS: every business with a cash tin
 * keeps these records — no plan gate, the workforce
 * family's own standing (workforce is on both plans).
 */

export const PETTY_OWNER_MESSAGE = 'Petty cash and bank deposits are for the owner only.';
export const PETTY_AMOUNT_MESSAGE = 'Enter the amount — it must be greater than zero.';
export const PETTY_PURPOSE_MESSAGE = 'Say what the petty cash was for.';
export const PETTY_INITIALS_MESSAGE = 'Add the initials — the record is signed.';
export const PETTY_BAG_MESSAGE = 'Say which bag the deposit went in.';
export const PETTY_DATE_MESSAGE = 'Choose a real date for the record.';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function cleanText(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** A real calendar date as YYYY-MM-DD, or null. */
export function cleanDate(value) {
  const s = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === s ? s : null;
}

function cleanAmount(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? round2(n) : null;
}

function cleanInitials(value) {
  return cleanText(value, 12).toUpperCase();
}

/**
 * Clean one petty-cash entry: a real date, an amount
 * greater than zero, what the cash was for (required —
 * money out of the tin with no purpose is no record),
 * whether the receipt came back in, and the initials of
 * who took it (required — the record is signed).
 */
export function cleanPettyEntry(input = {}) {
  const out = {
    entry_date: cleanDate(input.entry_date ?? input.date),
    amount: cleanAmount(input.amount),
    purpose: cleanText(input.purpose, 300),
    receipt_back: input.receipt_back === true || input.receipt_back === 'true',
    initials: cleanInitials(input.initials),
  };
  if (!out.entry_date) throw err(400, 'petty_date_needed', PETTY_DATE_MESSAGE);
  if (!(out.amount > 0)) throw err(400, 'petty_amount_needed', PETTY_AMOUNT_MESSAGE);
  if (!out.purpose) throw err(400, 'petty_purpose_needed', PETTY_PURPOSE_MESSAGE);
  if (!out.initials) throw err(400, 'petty_initials_needed', PETTY_INITIALS_MESSAGE);
  return out;
}

/**
 * Clean one bank deposit: a real date (when it left), an
 * amount greater than zero, the bag it went in
 * (required — the bag is how the run is traced), and the
 * initials of who carried it (required — signed).
 */
export function cleanDeposit(input = {}) {
  const out = {
    deposit_date: cleanDate(input.deposit_date ?? input.date),
    amount: cleanAmount(input.amount),
    bag_ref: cleanText(input.bag_ref ?? input.bag, 80),
    initials: cleanInitials(input.initials),
  };
  if (!out.deposit_date) throw err(400, 'petty_date_needed', PETTY_DATE_MESSAGE);
  if (!(out.amount > 0)) throw err(400, 'petty_amount_needed', PETTY_AMOUNT_MESSAGE);
  if (!out.bag_ref) throw err(400, 'petty_bag_needed', PETTY_BAG_MESSAGE);
  if (!out.initials) throw err(400, 'petty_initials_needed', PETTY_INITIALS_MESSAGE);
  return out;
}

/** Shape one stored row for the wire: amounts as numbers,
 *  dates as plain YYYY-MM-DD strings. */
export function shapePettyEntry(row) {
  return {
    ...row,
    entry_date: row.entry_date ? String(row.entry_date).slice(0, 10) : null,
    amount: Number(row.amount) || 0,
    receipt_back: row.receipt_back === true,
  };
}

export function shapeDeposit(row) {
  return {
    ...row,
    deposit_date: row.deposit_date ? String(row.deposit_date).slice(0, 10) : null,
    amount: Number(row.amount) || 0,
  };
}

/** The logs' totals: what left the tin, and what was
 *  taken to the bank — the two numbers the owner checks
 *  the bank statement against. */
export function pettyTotals(petty = [], deposits = []) {
  return {
    totalOut: round2((petty || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0)),
    totalDeposited: round2((deposits || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0)),
  };
}
