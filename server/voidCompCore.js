/**
 * Void & comp log — the pure core (Nov 26, 2026; plan
 * Part 7, owner-ruled addition G-C, gap-check round 3).
 *
 * WHAT LIVES HERE (no database, no HTTP):
 *  - the wording constants every refusal carries (keyed
 *    in the apiErrors registry, translated ×52);
 *  - the entry cleaning for the register of voids and
 *    comps that lives on the Restaurant Corner's
 *    Invoices & Money shelf: which kind it was (void or
 *    comp), its value, the reason, and who approved it.
 *    The date/time and who recorded it ride along in
 *    the house log shape — stamped server-side when the
 *    entry is written, never typed by the recorder.
 *  - the totals the page and the Studio print share.
 *
 * HAND-ENTERED, HONESTLY: until a live till feed exists,
 * a person types each entry. Nothing here pretends an
 * entry arrived from a till — the page's own copy says
 * it is typed in by hand, and that is how it works today.
 *
 * OWNER/MANAGER MONEY: the register is money, so the
 * routes serve it to the owner and managers only — a
 * plain staff member is refused before a single row is
 * read (the owner/manager line the app's money surfaces
 * already use, enforced server-side).
 *
 * BUSINESS-ONLY: the Restaurant Corner is Business-only,
 * and the routes carry its plan gate.
 */

export const VOIDCOMP_MONEY_MESSAGE = 'Voids and comps are for the owner and managers only.';
export const VOIDCOMP_KIND_MESSAGE = 'Say whether it was a void or a comp.';
export const VOIDCOMP_VALUE_MESSAGE = 'Enter the value — it must be greater than zero.';
export const VOIDCOMP_REASON_MESSAGE = 'Say why it was voided or comped.';
export const VOIDCOMP_APPROVER_MESSAGE = 'Say who approved it.';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function cleanText(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cleanAmount(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? round2(n) : null;
}

/**
 * Clean one void/comp entry: the kind (void or comp —
 * nothing else is a register entry), a value greater
 * than zero, the reason (required — a void or comp with
 * no reason is no record), and the approver (required —
 * every void and comp was approved by somebody, and the
 * register names them).
 */
export function cleanVoidCompEntry(input = {}) {
  const kind = cleanText(input.kind, 10).toLowerCase();
  const out = {
    kind,
    amount: cleanAmount(input.amount ?? input.value),
    reason: cleanText(input.reason, 300),
    approver: cleanText(input.approver, 120),
  };
  if (out.kind !== 'void' && out.kind !== 'comp') throw err(400, 'voidcomp_kind_needed', VOIDCOMP_KIND_MESSAGE);
  if (!(out.amount > 0)) throw err(400, 'voidcomp_value_needed', VOIDCOMP_VALUE_MESSAGE);
  if (!out.reason) throw err(400, 'voidcomp_reason_needed', VOIDCOMP_REASON_MESSAGE);
  if (!out.approver) throw err(400, 'voidcomp_approver_needed', VOIDCOMP_APPROVER_MESSAGE);
  return out;
}

/** Shape one stored row for the wire: the value as a
 *  number, the kind as recorded. */
export function shapeVoidCompEntry(row) {
  return {
    ...row,
    amount: Number(row.amount) || 0,
  };
}

/** The register's totals: what was voided, what was
 *  comped, and how many entries of each — the numbers
 *  the owner checks the night's paperwork against. */
export function voidCompTotals(entries = []) {
  const rows = entries || [];
  const sum = (kind) => round2(rows.filter((e) => e.kind === kind).reduce((s, e) => s + (Number(e.amount) || 0), 0));
  return {
    totalVoids: sum('void'),
    totalComps: sum('comp'),
    voidCount: rows.filter((e) => e.kind === 'void').length,
    compCount: rows.filter((e) => e.kind === 'comp').length,
  };
}
