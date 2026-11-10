import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * P2 data-safety fixes — page-by-page audit, Nov 7–8 2026, findings 18–22,
 * 26–28 and the 36 sub-items owned by this group.
 *
 * Most of these pages cannot be imported in node (they pull in the Base44
 * SDK through the `@/` alias), so — following RegisterOtpRecovery.test.js —
 * the tests assert on the shipped source. The pure helpers were additionally
 * verified at runtime before this PR (productTruncationNotice,
 * isOperatingSite, the valuation export's blank-money columns and the
 * 20,000-row fetchAll cap); see the PR body.
 */

const read = (path) => readFileSync(path, 'utf8');

const inventory = read('src/lib/inventory.js');
const entitlements = read('src/lib/entitlements.js');
const exportData = read('src/lib/exportData.js');
const counts = read('src/pages/Counts.jsx');
const listings = read('src/pages/Listings.jsx');
const locations = read('src/pages/Locations.jsx');
const inventoryPage = read('src/pages/Inventory.jsx');
const movements = read('src/pages/Movements.jsx');
const categories = read('src/pages/Categories.jsx');
const reorder = read('src/components/dashboard/ReorderPanel.jsx');
const valuation = read('src/pages/Valuation.jsx');
const reports = read('src/pages/Reports.jsx');
const exportsPage = read('src/pages/Exports.jsx');
const externalCode = read('src/components/scan/ExternalCodePanel.jsx');
const scan = read('src/pages/Scan.jsx');
const register = read('src/pages/Register.jsx');
const login = read('src/pages/Login.jsx');
const resetPassword = read('src/pages/ResetPassword.jsx');
const forgotPassword = read('src/pages/ForgotPassword.jsx');

// Finding 18 — the 500-product catalog page must never look complete.
test('18: loadInventory counts the catalog and reports truncation', () => {
  assert.match(inventory, /base44\.entities\.Product\.count\(scoped\(\{\}, businessId\)\)/);
  assert.match(inventory, /productTotal/);
  assert.match(inventory, /productsTruncated: productTotal > shown\.length/);
  assert.match(inventory, /export function productTruncationNotice\(shown, total\)/);
  assert.match(inventory, /Showing \$\{shown\} of \$\{total\} — refine your search/);
  assert.match(inventory, /INVENTORY_PRODUCT_LIMIT = 500/);
});

test('18: Counts, Listings and Locations count products and show the truncation notice', () => {
  for (const [name, page] of [['Counts', counts], ['Listings', listings], ['Locations', locations]]) {
    assert.match(page, /base44\.entities\.Product\.count\(scoped\(\{\}, activeId\)\)/, name);
    assert.match(page, /productTruncationNotice\(products\.length, productTotal\)/, name);
    assert.match(page, /productTotal/, name);
  }
});

test('18: Inventory page also shows the truncation notice from loadInventory', () => {
  assert.match(inventoryPage, /import \{ loadInventory, productTruncationNotice \} from '@\/lib\/inventory'/);
  assert.match(inventoryPage, /productTruncationNotice\(inventory\?\.products\?\.length \?\? 0, inventory\?\.productTotal \?\? 0\)/);
});

// Finding 19 — the ledger stops at 100 rows; say so and offer more.
test('19: Movements pages the ledger and labels what is shown', () => {
  assert.match(movements, /cursor: cursorRef\.current/);
  assert.match(movements, /Load more/);
  assert.match(movements, /Showing the \$\{movements\.length\} most recent movements/);
  assert.match(movements, /Showing all \$\{movements\.length\}/);
  assert.match(movements, /limit: 100/);
});

// Finding 20 — deleting a category also deletes its subcategories.
test('20: Categories delete confirms and names the child count', () => {
  assert.match(categories, /window\.confirm\(message\)/);
  assert.match(categories, /Delete \$\{row\.name\} and its \$\{childCount\} subcategor/);
  assert.match(categories, /Products keep their values\./);
});

// Finding 21 — a reorder must be a draft, never a $0 order booked as placed.
test('21: ReorderPanel creates a draft PO and blocks missing unit costs', () => {
  assert.match(reorder, /status: 'draft'/);
  assert.doesNotMatch(reorder, /status: 'ordered'/);
  assert.match(reorder, /missing cost is not \$0/);
  assert.match(reorder, /Create draft PO/);
  assert.match(reorder, /draft created for/);
  assert.match(reorder, /Set a supplier on the product/);
  assert.doesNotMatch(reorder, /Assign a supplier/);
  // A recorded $0 cost is real and kept; only a missing cost blocks.
  assert.match(reorder, /typeof item\.product\.cost !== 'number'/);
});

// Finding 22 — valuation money: split the unknowns, one rule, blank exports.
test('22a: Valuation splits the unknown units into no-cost and no-price', () => {
  assert.match(valuation, /have no cost/);
  assert.match(valuation, /have no price/);
  assert.doesNotMatch(valuation, /costUnknown\} unit.*sit outside these totals/);
});

test('22b: Valuation and Reports state the same missing-money rule', () => {
  assert.match(valuation, /Missing\s+money is never treated as zero/);
  assert.match(reports, /Missing\s+money is never treated as zero/);
  assert.doesNotMatch(reports, /so they count as zero/);
});

test('22c: valuation export leaves money blank when no cost or price is recorded', () => {
  assert.match(exportData, /row\.costKnown \? Number\(row\.cost\.toFixed\(2\)\) : ''/);
  assert.match(exportData, /row\.priceKnown \? Number\(row\.retail\.toFixed\(2\)\) : ''/);
  assert.match(exportData, /row\.costKnown && row\.priceKnown \? Number\(\(row\.retail - row\.cost\)\.toFixed\(2\)\) : ''/);
});

test('22d: Exports copy says the workbook is Excel-only; Valuation matches Reports on formats', () => {
  assert.match(exportsPage, /is Excel-only, with one sheet per dataset/);
  assert.doesNotMatch(exportsPage, /Every dataset comes as both CSV/);
  assert.match(valuation, /Download Excel/);
  assert.match(valuation, /runExport\('xlsx'\)/);
  assert.match(valuation, /Download CSV/);
});

// Finding 26 — a text scan's "Search inventory" button did nothing.
test('26: ExternalCodePanel hides Search inventory for text-kind scans', () => {
  assert.match(externalCode, /scanned\.kind !== 'text'/);
  assert.match(externalCode, /Search inventory/);
  assert.match(externalCode, /Copy/);
  assert.match(externalCode, /Scan next/);
});

// Finding 27 — Transfer with nowhere to transfer to.
test('27: Scan disables Transfer with one location and says why', () => {
  assert.match(scan, /canTransfer = locations\.length > 1/);
  assert.match(scan, /Add a second location to transfer/);
  assert.match(scan, /disabled=\{disabled\}/);
});

// Finding 36a — one site predicate for the page and the server count.
test('36a: Locations UI count and server count share isOperatingSite', () => {
  assert.match(entitlements, /export function isOperatingSite\(location\)/);
  assert.match(entitlements, /\$or: \[\{ parent_id: \{ \$exists: false \} \}, \{ parent_id: null \}\]/);
  assert.match(locations, /locations\.filter\(isOperatingSite\)/);
  assert.match(locations, /isOperatingSite/);
});

// Finding 36b — the 20,000-row export cap must be visible, not silent.
test('36b: exportData flags the 20,000-row cap in the filename', () => {
  assert.match(exportData, /EXPORT_ROW_CAP = FETCH_ALL_PAGE_LIMIT \* FETCH_ALL_PAGE_SIZE/);
  assert.match(exportData, /truncatedFilename\(base, truncated\)/);
  assert.match(exportData, /-truncated-\$\{EXPORT_ROW_CAP\}/);
  assert.match(exportData, /return \{ count: rows\.length, filename, truncated \}/);
  assert.match(exportsPage, /stop at 20,000 rows per dataset/);
  assert.match(exportsPage, /truncated-20000/);
});

// Finding 36c — the gated pages must be safe on their own, not only via the route.
test('36c: Valuation, Reports and Exports each carry an in-page entitlement guard', () => {
  assert.match(valuation, /can\('valuation'\)/);
  assert.match(valuation, /Stock valuation is a Business feature/);
  assert.match(reports, /can\('reports'\)/);
  assert.match(reports, /Advanced reports is a Business feature/);
  assert.match(exportsPage, /can\('exports'\)/);
  assert.match(exportsPage, /CSV and Excel exports is a Business feature/);
});

// Finding 36d — a reset ends with confirmation on Login.
test('36d: ResetPassword redirects with ?reset=success and Login shows it', () => {
  assert.match(resetPassword, /window\.location\.href = "\/login\?reset=success"/);
  assert.match(login, /searchParams\.get\("reset"\) === "success"/);
  assert.match(login, /Password changed — log in with your new password\./);
});

// Finding 36e — the server's real password rule, not an invented number.
// (Base44 Auth docs: at least 8 characters, at most 72 bytes, no complexity.)
test('36e: Register and Reset show the real password minimum under the field', () => {
  assert.match(register, /PASSWORD_HINT = "At least 8 characters \(up to 72 bytes\)\. No special characters required\."/);
  assert.match(resetPassword, /PASSWORD_HINT/);
  assert.match(register, /minLength=\{8\}/);
  assert.match(resetPassword, /minLength=\{8\}/);
});

// Finding 36f — the reset email may land in spam.
test('36f: ForgotPassword success copy mentions the spam folder', () => {
  assert.match(forgotPassword, /Check your spam folder/);
});

// Finding 36g — DELIBERATE: the amber low-stock styling on Scan stays.
// It is a reorder-point display (quantity at/below the product's reorder
// point), not a low-stock alert, so it is not gated on can('alerts').
test('36g: Scan keeps the amber reorder-point display (deliberate, not gated)', () => {
  assert.match(scan, /isLow = product\.reorder_point > 0 && q <= product\.reorder_point/);
  assert.match(scan, /isLow \? 'text-warn'/);
  assert.doesNotMatch(scan, /can\('alerts'\)/);
});
