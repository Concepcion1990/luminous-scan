/**
 * Frontend mirror of base44/shared/cancellationGracePolicy.ts.
 *
 * Kept identical on purpose: the app's routes are the enforcement point
 * for the read-only grace view (the same as every other plan gate in this
 * codebase — see PlanGate), so the router needs this decision without
 * importing server code. If the rule changes, change BOTH files and keep
 * the tests in step.
 *
 * THE RULE (owner-decided 2026-11-07): cancel mid-month → full access
 * until the provider-confirmed paid-through date. After that date → a
 * 15-day READ-ONLY grace view (see products only; no adding, editing,
 * deleting, scanning, importing, exporting or migrating, no settings, no
 * staff). After the 15 days → the account and all its information are
 * permanently deleted and cannot be recovered. Resubscribing starts
 * fresh. (The wipe sweep runs daily on the server — server/billing.js
 * runWipeSweep; this module only decides the state.)
 *
 * CANONICAL COPY (audit findings 1/34): use CANCELLATION_WIPE_SENTENCE
 * and CANCELLATION_GRACE_PARAGRAPH verbatim everywhere the rule is
 * shown — the cancel dialog, Settings, the grace view and the policy
 * pages — so no screen promises the data survives the grace period.
 */

export const CANCELLATION_GRACE_DAYS = 15;
export const CANCELLATION_WIPE_SENTENCE =
  'After the 15-day grace period ends, your account and all its information are permanently deleted and cannot be recovered.';
export const CANCELLATION_GRACE_PARAGRAPH =
  'After your paid period ends, you have 15 days to view your products only — you can see SKUs, ISBNs, and everything you need to move elsewhere, but you cannot make changes, use the scanner, import, or export. After those 15 days, your account and all its information are permanently deleted and cannot be recovered. Resubscribing starts fresh.';
const GRACE_MS = CANCELLATION_GRACE_DAYS * 24 * 60 * 60 * 1000;

export function assessCancellationGrace(input, now = new Date()) {
  const none = (state) => ({ state, paidThrough: null, graceEndsAt: null });

  if (!input || !Number.isFinite(now.getTime())) return none('not_applicable');

  // Complimentary access never enters grace or lockout.
  if (input.status === 'grandfathered') return none('full_access');

  // Only a canceled subscription has a paid-through date to run out.
  if (input.status !== 'canceled') return none('not_applicable');

  const paidThroughMs = Date.parse(input.paidThrough ?? '');
  if (!Number.isFinite(paidThroughMs)) {
    // Fail closed: a canceled entitlement with no verifiable paid-through
    // date is locked, never silently granted.
    return none('locked');
  }
  const paidThrough = new Date(paidThroughMs).toISOString();
  const graceEndsAt = new Date(paidThroughMs + GRACE_MS).toISOString();

  if (now.getTime() < paidThroughMs) {
    return { state: 'full_access', paidThrough, graceEndsAt };
  }
  if (now.getTime() < paidThroughMs + GRACE_MS) {
    return { state: 'grace', paidThrough, graceEndsAt };
  }
  return { state: 'locked', paidThrough, graceEndsAt };
}
