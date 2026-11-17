/**
 * Stock counts — the sheet's scanner, in two owner chapters.
 *
 * Nov 14, 2026 (her catch): the 'Scan or type a code' row's Add
 * button carries the scan icon but never opened the scanner — with
 * the box empty it silently did nothing. The in-sheet scanner
 * overlay was born: empty box -> the overlay opens over the sheet.
 *
 * Nov 16, 2026 (scan-to-tally, her ruling): the camera's job inside
 * a count changed. It no longer takes one capture and closes, and
 * it no longer refuses a product that is not on the sheet. The
 * scanner now STAYS OPEN and tallies — every scan adds +1 to that
 * product's line and the count climbs on its own; a scanned
 * product not on the sheet joins it at 1 (the line the typed-code
 * Add has always appended). Scans touch ONLY the sheet: Save /
 * Send for review / Apply still govern when stock moves. Archived
 * products stay frozen — a scan of one is refused with the
 * restore-first guidance and no quantity moves.
 *
 * The freeze: her isolation test showed drags starting on the
 * count-lines region did nothing while drags elsewhere scrolled.
 * The mechanism was a blanket CSS rule — every overflow-y-auto
 * element carried overscroll-behavior-y: none, so a region whose
 * content did not fill it (four lines in a 320px box) swallowed
 * the gesture: it could not scroll itself and was forbidden from
 * chaining to the page. The CSS pins below fail on that stylesheet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// counts.js imports the '@/api' alias, so node tests cannot import
// it directly; the tally helper is self-contained, so its REAL
// source is extracted and run — the tests below exercise the
// shipped code, not a copy.
const countsSrc = readFileSync(new URL('../../src/lib/counts.js', import.meta.url), 'utf8');
const fnMatch = countsSrc.match(/export function tallyCountedLine[\s\S]*?\n\}/);
assert.ok(fnMatch, 'tallyCountedLine exists in lib/counts.js');
const tallyCountedLine = new Function(
  `${fnMatch[0].replace('export function', 'function')}; return tallyCountedLine;`,
)();

const sheet = (p) => readFileSync(new URL(`../../src/components/counts/${p}`, import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
const countSheet = sheet('CountSheet.jsx');

const LINES = [
  { product_id: 'rb1', product_name: '16oz Redbull', sku: 'RB-1', expected: 14, counted: 3 },
  { product_id: 'ibu', product_name: 'Little Ibuprofen', sku: 'IB-1', expected: 2, counted: null },
  { product_id: 'dor', product_name: 'Cool Ranch Doritos', sku: 'DO-1', expected: 5, counted: '' },
];
const product = (id, name = 'Backpack', sku = 'BP-1') => ({ id, name, sku, status: 'active' });

test('a scan bumps the line by one from its current counted value', () => {
  const next = tallyCountedLine(LINES, product('rb1'));
  assert.equal(next.find((l) => l.product_id === 'rb1').counted, 4);
  assert.equal(next.find((l) => l.product_id === 'ibu').counted, null, 'other lines untouched');
});

test('a scan on an untouched line counts from zero', () => {
  assert.equal(tallyCountedLine(LINES, product('ibu')).find((l) => l.product_id === 'ibu').counted, 1);
  assert.equal(tallyCountedLine(LINES, product('dor')).find((l) => l.product_id === 'dor').counted, 1);
});

test('three scans of the same product tally to three', () => {
  let lines = [];
  lines = tallyCountedLine(lines, product('bp'), 30);
  lines = tallyCountedLine(lines, product('bp'));
  lines = tallyCountedLine(lines, product('bp'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].counted, 3);
  assert.equal(lines[0].expected, 30, "the sheet's location expectation rides the new line");
});

test('a scanned product that is not on the sheet joins it at one, wearing the sheet line shape', () => {
  const next = tallyCountedLine(LINES, product('bp'), 7);
  const joined = next.find((l) => l.product_id === 'bp');
  assert.deepEqual(joined, {
    product_id: 'bp',
    product_name: 'Backpack',
    sku: 'BP-1',
    expected: 7,
    counted: 1,
  });
  assert.equal(next.length, LINES.length + 1);
});

test('the Add button opens the scanner when the code box is empty, and keeps typed behavior otherwise', () => {
  assert.match(countSheet, /const onAddPressed = \(\) => \{\s*if \(scan\.trim\(\)\) \{\s*addByScan\(\);\s*\} else \{\s*setTallyNote\(null\);\s*setScannerOpen\(true\);/);
  assert.match(countSheet, /onClick=\{onAddPressed\}/);
});

test('the tally scanner lives inside the sheet and stays open — no one-capture guard remains', () => {
  assert.match(countSheet, /from '@\/components\/scan\/BarcodeScanner'/);
  assert.match(countSheet, /\{scannerOpen && \(/);
  assert.match(countSheet, /<BarcodeScanner onDetect=\{handleTallyDetect\} \/>/);
  assert.ok(!countSheet.includes('scanHandledRef'), 'the one-capture guard is gone');
  assert.ok(!countSheet.includes('handleScanDetect'), 'the single-capture handler is gone');
  // The overlay teaches and closes in the owner's words.
  assert.match(countSheet, /t\('scanTally\.title'\)/);
  assert.match(countSheet, /t\('scanTally\.hint'\)/);
  assert.match(countSheet, /t\('scanTally\.done'\)/);
  assert.match(countSheet, /t\('scanTally\.scanned', \{ name: line\.product_name, count: line\.counted \}\)/);
});

test('tally captures are serialized through the scan queue, so racing scans never lose a count', () => {
  assert.match(countSheet, /scanQueueRef\.current = scanQueueRef\.current\s*\.then\(\(\) => processTallyScan\(code\)\)/);
  assert.match(countSheet, /tallyCountedLine\(\s*linesRef\.current,/);
});

test('an unknown code keeps the no-match notice; an archived product is refused frozen, in both scan paths', () => {
  assert.match(countSheet, /t\('counts\.noProductMatch', \{ code \}\)/);
  // One shared scan processor carries the archived guard, and both
  // the typed Add and the camera tally run through it.
  assert.match(countSheet, /const applyScannedProduct = \(product\) => \{\s*if \(\(product\.status \|\| 'active'\) === 'archived'\) \{\s*throw new Error\(t\('inventoryLib\.archivedFrozen', \{ name: product\.name \}\)\);/);
  assert.match(countSheet, /applyScannedProduct\(matches\[0\]\)/);
  assert.match(countSheet, /const line = applyScannedProduct\(matches\[0\]\);/);
});

test('FREEZE PIN: scroll regions are no longer blanket-forbidden from chaining', () => {
  assert.ok(
    !/\[class~="overflow-y-auto"\][^{]*\{[^}]*overscroll-behavior/.test(css),
    'the blanket overflow-y-auto overscroll rule must stay gone — it trapped drags in non-overflowing regions',
  );
  assert.ok(
    !/\[class~="overflow-auto"\][^{]*\{[^}]*overscroll-behavior/.test(css),
    'the blanket overflow-auto overscroll rule must stay gone',
  );
  // The page-level rule and the opt-in list class remain as designed.
  assert.match(css, /html,\s*body \{\s*overscroll-behavior-y: none;/);
  assert.match(css, /\.stockhaven-scroll-list \{\s*overscroll-behavior-y: none;/);
});
