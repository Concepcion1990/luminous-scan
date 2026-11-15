/**
 * Stock counts — the sheet's scan button + the frozen-page fix
 * (owner catches, Nov 14, 2026).
 *
 * Scan button: the 'Scan or type a code' row's Add button carries
 * the scan icon but never opened the scanner — with the box empty
 * it silently did nothing. Now: empty box -> the in-sheet scanner
 * overlay opens; a scanned product ON the sheet gains +1; a scanned
 * product NOT on the sheet gets a plain notice naming it and is
 * never silently added (counts are audited); a typed code keeps the
 * original Add behavior.
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
// it directly; the bump helper is self-contained, so its REAL source
// is extracted and run — the tests below exercise the shipped code,
// not a copy.
const countsSrc = readFileSync(new URL('../../src/lib/counts.js', import.meta.url), 'utf8');
const fnMatch = countsSrc.match(/export function bumpCountedLine[\s\S]*?\n\}/);
assert.ok(fnMatch, 'bumpCountedLine exists in lib/counts.js');
const bumpCountedLine = new Function(
  `${fnMatch[0].replace('export function', 'function')}; return bumpCountedLine;`,
)();

const sheet = (p) => readFileSync(new URL(`../../src/components/counts/${p}`, import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
const countSheet = sheet('CountSheet.jsx');

const LINES = [
  { product_id: 'rb1', product_name: '16oz Redbull', counted: 3 },
  { product_id: 'ibu', product_name: 'Little Ibuprofen', counted: null },
  { product_id: 'dor', product_name: 'Cool Ranch Doritos', counted: '' },
];

test('a scan bumps the line by one from its current counted value', () => {
  const next = bumpCountedLine(LINES, 'rb1');
  assert.equal(next.find((l) => l.product_id === 'rb1').counted, 4);
  assert.equal(next.find((l) => l.product_id === 'ibu').counted, null, 'other lines untouched');
});

test('a scan on an untouched line counts from zero', () => {
  assert.equal(bumpCountedLine(LINES, 'ibu').find((l) => l.product_id === 'ibu').counted, 1);
  assert.equal(bumpCountedLine(LINES, 'dor').find((l) => l.product_id === 'dor').counted, 1);
});

test('a scanned product that is not on the sheet is never added', () => {
  assert.equal(bumpCountedLine(LINES, 'off-sheet-product'), null);
  assert.equal(bumpCountedLine([], 'rb1'), null);
});

test('the Add button opens the scanner when the code box is empty, and keeps typed behavior otherwise', () => {
  assert.match(countSheet, /const onAddPressed = \(\) => \{\s*if \(scan\.trim\(\)\) \{\s*addByScan\(\);\s*\} else \{\s*scanHandledRef\.current = false;\s*setScannerOpen\(true\);/);
  assert.match(countSheet, /onClick=\{onAddPressed\}/);
});

test('the scanner overlay lives inside the sheet (state preserved) and one capture counts once', () => {
  assert.match(countSheet, /from '@\/components\/scan\/BarcodeScanner'/);
  assert.match(countSheet, /\{scannerOpen && \(/);
  assert.match(countSheet, /<BarcodeScanner onDetect=\{handleScanDetect\} \/>/);
  assert.match(countSheet, /if \(scanHandledRef\.current\) return;\s*scanHandledRef\.current = true;/);
});

test('a scanned off-sheet product gets the naming notice; an unknown code keeps the no-match notice', () => {
  assert.match(countSheet, /const bumped = bumpCountedLine\(lines, product\.id\);/);
  assert.match(countSheet, /if \(!bumped\) \{\s*setError\(t\('counts\.notOnSheet', \{ name: product\.name \}\)\);/);
  assert.match(countSheet, /t\('counts\.noProductMatch', \{ code \}\)/);
});

test('the typed-code path is unchanged: it may still append a new line', () => {
  const typed = countSheet.slice(countSheet.indexOf('const addByScan'), countSheet.indexOf('const handleScanDetect'));
  assert.match(typed, /counted: 1/);
  assert.match(typed, /expected: expectedAt\(levels, session\.location_id, product\.id\)/);
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
