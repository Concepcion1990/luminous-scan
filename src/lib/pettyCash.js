/**
 * Petty cash + bank deposit log — client doors
 * (Nov 26, 2026; plan Part 7, owner-ruled addition G-A).
 *
 * Thin wrappers over server/pettyCashRoutes.js, plus the
 * one pure helper the page and the Studio print share:
 * the logs' totals.
 *
 * GENERAL, both plans, living on the Payroll page beside
 * the cash-up / cash count — and OWNER-ONLY: the server
 * refuses every non-owner read and write, so these doors
 * are only ever called from the owner's section.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/petty-cash`;

export function fetchPettyCash(businessId) {
  return apiRequest(base(businessId));
}

export function recordPettyCash(businessId, entry) {
  return apiRequest(base(businessId), { method: 'POST', body: entry });
}

export function recordDeposit(businessId, deposit) {
  return apiRequest(`${base(businessId)}/deposits`, { method: 'POST', body: deposit });
}

/** Totals for the section footer and its print: what
 *  left the tin, and what was taken to the bank. */
export function pettyTotals(petty = [], deposits = []) {
  const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  return {
    totalOut: round2((petty || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0)),
    totalDeposited: round2((deposits || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0)),
  };
}
