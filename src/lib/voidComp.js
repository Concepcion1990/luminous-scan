/**
 * Void & comp log — client doors (Nov 26, 2026; plan
 * Part 7, owner-ruled addition G-C).
 *
 * Thin wrappers over server/voidCompRoutes.js, plus the
 * one pure helper the page and the Studio print share:
 * the register's totals.
 *
 * BUSINESS-ONLY, Restaurant Corner, Invoices & Money
 * shelf — and OWNER/MANAGER money: the server refuses
 * every plain-staff read and write, so these doors are
 * only ever called from the owner/manager page.
 * HAND-ENTERED: until a live till feed exists, a person
 * types each entry — nothing here claims a till sent it.
 */
import { apiRequest } from '../api/client.js';

const base = (businessId) => `/api/businesses/${encodeURIComponent(businessId || '')}/void-comp`;

export function fetchVoidComp(businessId) {
  return apiRequest(base(businessId));
}

export function recordVoidComp(businessId, entry) {
  return apiRequest(base(businessId), { method: 'POST', body: entry });
}

/** Totals for the page footer and its print: what was
 *  voided, what was comped, and the count of each. */
export function voidCompTotals(entries = []) {
  const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  const rows = entries || [];
  const sum = (kind) => round2(rows.filter((e) => e.kind === kind).reduce((s, e) => s + (Number(e.amount) || 0), 0));
  return {
    totalVoids: sum('void'),
    totalComps: sum('comp'),
    voidCount: rows.filter((e) => e.kind === 'void').length,
    compCount: rows.filter((e) => e.kind === 'comp').length,
  };
}
