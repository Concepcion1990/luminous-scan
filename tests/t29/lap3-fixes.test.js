/**
 * T29 — Lap-3 fix pack (Nov 15, 2026), proven on the owner's phone
 * during the Essentials retest and fixed the same night:
 *
 * 1. The All screens menu's last row (Settings) slid UNDER the fixed
 *    bottom tab bar — the menu's own 65vh cap ignored the header
 *    chrome above it and the bar below. The header is now a flex
 *    column capped at the viewport minus the tab bar, and the menu
 *    is its flexible scrolling child: the tail can always scroll
 *    fully clear. (Rendered geometry is pinned in the CDP harness;
 *    the structural contract is pinned here.)
 * 2. A phone served the previous bundle for ~an hour after a deploy
 *    — only a logout (a full document navigation) unstuck it. The
 *    worker's cache writes now fail open, navigations revalidate
 *    explicitly, and the page asks for an update check whenever it
 *    becomes visible again and hourly: a new build is discovered
 *    promptly and serves on the next navigation, no logout.
 * 3. Rounded prices on screen (the Scan shelf list showed $5 for a
 *    $4.99 product): the owner's price-honesty law is app-wide.
 *    Every price display is exact — formatMoney defaults to cents,
 *    and no call site may ask for whole dollars.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { close } from './helpers.js';

after(close);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(jsx?|tsx?)$/.test(entry)) yield path;
  }
}

test('menu: the header is capped above the tab bar and the menu is the flexible scroller', () => {
  const layout = readFileSync('src/components/Layout.jsx', 'utf8');
  // The cap: viewport height minus the 64px tab bar and safe area.
  assert.match(
    layout,
    /<header className="sticky top-0 z-20 flex max-h-\[calc\(100dvh_-_4rem_-_env\(safe-area-inset-bottom\)\)\] flex-col/,
    'the mobile header carries the tab-bar-aware height cap',
  );
  // The menu scrolls inside whatever room the cap leaves.
  assert.match(
    layout,
    /id="stockhaven-mobile-modules"[\s\S]*?className="min-h-0 flex-1 overflow-y-auto/,
    'the All screens menu is the flexible scrolling child',
  );
  assert.ok(!layout.includes('max-h-[65vh]'), 'the old 65vh cap — the bug — is gone');
  // The tab bar itself is unchanged: fixed, 64px.
  assert.match(layout, /stockhaven-mobile-tabbar fixed inset-x-0 bottom-0 z-30/);
  assert.match(layout, /min-h-\[64px\]/);
});

test('sw: the worker takes over promptly and its cache writes fail open', () => {
  const sw = readFileSync('public/sw.js', 'utf8');
  assert.match(sw, /self\.skipWaiting\(\)/, 'install skips waiting');
  assert.match(sw, /self\.clients\.claim\(\)/, 'activate claims clients');
  assert.match(sw, /__SW_VERSION__/, 'the cache name carries the per-build stamp');
  // Every cache.put is guarded: a refused write (quota) must never
  // mask a fresh network answer or sink an asset.
  const puts = sw.match(/cache\.put\(/g) || [];
  const guarded = sw.match(/cache\.put\([\s\S]*?\)\.catch\(\(\) => undefined\)/g) || [];
  assert.ok(puts.length >= 3, 'the three write sites are present');
  assert.equal(guarded.length, puts.length, 'every cache.put is fail-open');
  // Navigations revalidate explicitly — no HTTP cache layer may
  // hand the worker a stale shell document.
  assert.match(sw, /fetch\(request, \{ cache: 'no-cache' \}\)/);
});

test('sw: the page asks for update checks while it lives', () => {
  const main = readFileSync('src/main.jsx', 'utf8');
  assert.match(main, /navigator\.serviceWorker\s*\n?\s*\.register\('\/sw\.js'\)/);
  assert.match(main, /registration\.update\(\)/, 'update checks are wired');
  assert.match(main, /visibilitychange/, 'a check runs when the app becomes visible again');
  assert.match(main, /setInterval\(checkForUpdate, 60 \* 60 \* 1000\)/, 'and hourly while open');
});

test('prices: formatMoney is exact by default', () => {
  // The default fraction digits ARE the contract (the rendered
  // $4.99 on the Scan shelf list is proven in the CDP harness —
  // src/lib/inventory.js itself is not node-importable, it carries
  // the Vite @/ alias).
  const inventory = readFileSync('src/lib/inventory.js', 'utf8');
  assert.match(
    inventory,
    /export function formatMoney\(value, currency = 'USD', maximumFractionDigits = 2\)/,
    'formatMoney defaults to cents, never whole dollars',
  );
  assert.ok(!inventory.includes('maximumFractionDigits = 0'), 'the whole-dollar default is gone');
});

test('prices: no surface in the app asks for whole-dollar rendering', () => {
  const offenders = [];
  for (const file of walk('src')) {
    const source = readFileSync(file, 'utf8');
    if (source.includes('digits={0}')) offenders.push(`${file}: digits={0}`);
    // A formatMoney call with only (value, currency) relied on the
    // old whole-dollar default; the fixed sites pass 2 explicitly.
    for (const match of source.matchAll(/formatMoney\(([^)]*)\)/g)) {
      const args = match[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (args.length === 2 && !file.endsWith('lib/inventory.js')) {
        offenders.push(`${file}: formatMoney(${match[1]})`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('bulk edit: category fields use the app combobox + Add window, never a datalist', () => {
  // Owner ruling (Nov 15, 2026): bulk edit must be able to ADD a
  // category ('Books') exactly like the product form — the native
  // datalist never surfaces inside a modal on Android Chrome.
  const bulk = readFileSync('src/components/products/BulkEditDialog.jsx', 'utf8');
  assert.ok(!bulk.includes('<datalist id') && !bulk.includes('list="bulk-'),
    'no datalist machinery remains in bulk edit');
  assert.match(bulk, /import VocabularyCombobox from '\.\/VocabularyCombobox'/);
  assert.match(bulk, /import AddVocabularyDialog from '\.\/AddVocabularyDialog'/);
  assert.match(bulk, /import \{ judgeVocabularyValue \} from '@\/lib\/vocabulary'/);
  assert.equal((bulk.match(/<VocabularyCombobox/g) || []).length, 2, 'category AND subcategory are comboboxes');
  assert.match(bulk, /onAddNewRequest=\{\(\) => setAddNewField\('category'\)\}/);
  assert.match(bulk, /onAddNewRequest=\{\(\) => setAddNewField\('subcategory'\)\}/);
  // The same save guard as the product form: typed-but-unlisted
  // text stops the save; blank remains "leave unchanged".
  assert.match(bulk, /judgeVocabularyValue\(\{\s*typedRaw: form\.category,/);
  assert.match(bulk, /judgeVocabularyValue\(\{\s*typedRaw: form\.subcategory,/);
  assert.match(bulk, /productForm\.categoryNotFound/);
  assert.match(bulk, /productForm\.subcategoryNotFound/);
  assert.match(bulk, /businessId=\{businessId\}/, 'the Add window creates against the active business');
  const products = readFileSync('src/pages/Products.jsx', 'utf8');
  assert.match(products, /<BulkEditDialog[\s\S]*?businessId=\{activeId\}/);
});

test('labels: the label sheet centers on full-size paper only', () => {
  // Owner ruling (Nov 15, 2026): everything centered — the grid
  // centered on the sheet, every row centered, a partial last row
  // centered too. Sized media (4×6, thermal) keep their layout.
  const page = readFileSync('src/pages/PrintCenter.jsx', 'utf8');
  assert.match(page, /print-label-flow flex flex-wrap justify-center gap-3/,
    'the on-screen flow centers each row');
  const css = readFileSync('src/index.css', 'utf8');
  assert.match(css, /@media print and \(min-width: 150mm\) \{\s*\.print-label-flow \{\s*text-align: center;/,
    'print centers the inline label flow on full-size paper');
  assert.match(css, /\.print-label-flow > \.print-label \{\s*margin: 0 6px 12px;/,
    'symmetric side margins keep the printed center true');
  // The 4×6 carrier page is a different flow entirely and is not
  // touched by the centering rule.
  assert.match(css, /@page carrierLabel \{\s*size: 102mm 152mm;/);
});

test('prices: the three known rounded spots now pass cents explicitly', () => {
  const shelf = readFileSync('src/components/scan/ScanProductList.jsx', 'utf8');
  assert.match(shelf, /<ProductPrice product=\{product\} currency=\{currency\} digits=\{2\} \/>/);
  const details = readFileSync('src/components/products/ProductDetailsDialog.jsx', 'utf8');
  assert.match(details, /formatMoney\(product\.price, currency, 2\)/);
  assert.match(details, /formatMoney\(product\.cost, currency, 2\)/);
  const dashboard = readFileSync('src/pages/Dashboard.jsx', 'utf8');
  assert.match(dashboard, /formatMoney\(stats\.stockValue, profile\.currency, 2\)/);
});
