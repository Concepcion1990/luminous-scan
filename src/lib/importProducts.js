/**
 * Spreadsheet import checks. Rows are matched, cleaned and tested here, so the
 * preview, the dry run and the real import all read the same verdict.
 */

import { draftFromRow, uniqueSku } from '@/lib/csvImport';

export const IGNORE = 'ignore';

function pickRow(cells, mapping) {
  const picked = {};
  mapping.forEach((field, column) => {
    if (field && field !== IGNORE) picked[field] = cells[column] || '';
  });
  return picked;
}

/**
 * Every row of the file with its verdict. Nothing is written here.
 * `existing` is what the catalog already holds: { skus, codes }.
 * `room` is how many more distinct products the plan can take
 * (null = no cap): ready rows past the room are marked 'over' —
 * reported by count, never silently trimmed or admitted (owner
 * ruling, Nov 14, 2026 — the dry run must be cap-aware).
 */
export function evaluateRows({ table, mapping, existing = {}, room = null }) {
  const empty = { rows: [], ready: 0, skipped: 0, over: 0, units: 0, problems: [] };
  if (!table) return empty;

  const taken = new Set((existing.skus || []).map((sku) => String(sku).toLowerCase()));
  const codes = new Set((existing.codes || []).map((code) => String(code).toLowerCase()));

  const rows = table.rows.map((cells, index) => {
    const picked = pickRow(cells, mapping);
    const { draft, quantity, error } = draftFromRow(picked);
    if (error) return { index, name: picked.name || '', status: 'skip', problem: error };

    const code = String(draft.upc || draft.barcode || draft.isbn || '').toLowerCase();
    if (draft.sku && taken.has(draft.sku.toLowerCase())) {
      return { index, name: draft.name, status: 'skip', problem: `SKU ${draft.sku} is already in the catalog` };
    }
    if (code && codes.has(code)) {
      return {
        index,
        name: draft.name,
        status: 'skip',
        problem: 'UPC / barcode already belongs to another product',
      };
    }

    let sku = draft.sku;
    if (sku) taken.add(sku.toLowerCase());
    else sku = uniqueSku(draft.name, taken, index + 1);
    if (code) codes.add(code);

    return { index, name: draft.name, status: 'ready', draft: { ...draft, sku }, quantity };
  });

  // Cap pass: the first `room` ready rows fit; the rest are 'over'.
  // Order is file order — the same order the commit writes in.
  let over = 0;
  if (room != null) {
    let fitted = 0;
    rows.forEach((row) => {
      if (row.status !== 'ready') return;
      fitted += 1;
      if (fitted > room) {
        row.status = 'over';
        row.problem = 'Plan is full — no room for this product';
        over += 1;
      }
    });
  }

  const valid = rows.filter((row) => row.status === 'ready');
  return {
    rows,
    ready: valid.length,
    skipped: rows.length - valid.length - over,
    over,
    units: valid.reduce((sum, row) => sum + (row.quantity || 0), 0),
    // 'over' rows carry a problem for the preview's tooltip but are
    // reported by their own count, not through the problems list.
    problems: rows.filter((row) => row.problem && row.status !== 'over'),
  };
}

/** The catalog's current SKUs and codes, for duplicate detection. */
export function existingKeys(products = []) {
  return {
    skus: products.map((product) => product.sku).filter(Boolean),
    codes: products
      .flatMap((product) => [product.upc, product.barcode, product.isbn])
      .filter(Boolean),
  };
}