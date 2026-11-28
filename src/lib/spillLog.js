/**
 * Spill & breakage log — client doors (Nov 26, 2026;
 * plan Part 7, item 392A).
 *
 * Thin wrappers over server/spillLogRoutes.js, plus the
 * one pure helper the page and the Studio print share:
 * the log's totals — the pour-cost total exists only on
 * rows that carry one (the owner's read; money is
 * owner-only, shaped server-side).
 *
 * Business-only (the Restaurant Corner), living with the
 * bar-counting family under its owner switch.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/spill-log`;

export function fetchSpillLog(businessId) {
  return apiRequest(base(businessId));
}

export function recordSpill(businessId, entry) {
  return apiRequest(base(businessId), { method: 'POST', body: entry });
}

/** Totals for the log's footer and its print: quantity
 *  always; the pour-cost total only when a row carries a
 *  cost (owner-only money — everyone else's rows never
 *  carry one, so their total is null, never zero). */
export function spillTotals(entries = []) {
  const showMoney = (entries || []).some((e) => e.total_cost !== null && e.total_cost !== undefined);
  const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  return {
    showMoney,
    totalCost: showMoney
      ? round2((entries || []).reduce((sum, e) => sum + (Number(e.total_cost) || 0), 0))
      : null,
    totalQuantity: round2((entries || []).reduce((sum, e) => sum + (Number(e.quantity) || 0), 0)),
  };
}
