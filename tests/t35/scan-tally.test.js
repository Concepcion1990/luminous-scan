/**
 * Scan-to-tally in its other two homes (owner ruling, Nov 16,
 * 2026): the Scan page's Receive and the Products Add stock sheet.
 * Each page's scanner serves only that page's job — Receive scans
 * climb the quantity being received for the product on screen;
 * the Add stock sheet's scanner (beside the quantity stepper, in
 * Receive mode) climbs that sheet's quantity for its one product.
 * Confirm steps are untouched: Scan's Record button and the
 * sheet's Save change remain the only writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const scan = readFileSync(new URL('../../src/pages/Scan.jsx', import.meta.url), 'utf8');
const dialog = readFileSync(
  new URL('../../src/components/inventory/AdjustStockDialog.jsx', import.meta.url),
  'utf8',
);

test('Scan Receive: a repeat scan of the shown product climbs the receive quantity', () => {
  assert.match(scan, /if \(action === 'receive' && product && match\.id === product\.id\) \{/);
  assert.match(scan, /const nextQty = \(Number\(qty\) \|\| 0\) \+ 1;/);
  assert.match(scan, /setQty\(String\(nextQty\)\);/);
  assert.match(scan, /t\('scanTally\.scanned', \{ name: match\.name, count: nextQty \}\)/);
});

test('Scan Receive: a fresh scan presents its product at one; confirms mark the box fresh', () => {
  assert.match(scan, /await selectProduct\(match\);\s*if \(action === 'receive'\) \{\s*\/\/ A scan presents its product at one — its tally starts here\.\s*setQty\('1'\);\s*tallyRef\.current = match\.id;/);
  const freshMarks = scan.match(/tallyRef\.current = 'fresh';/g) || [];
  assert.equal(freshMarks.length, 3, 'all three confirm paths (offline, hold, movement) mark fresh');
  // A hand-typed quantity is the user's own: the fresh mark clears.
  assert.match(scan, /if \(tallyRef\.current === 'fresh'\) tallyRef\.current = null;/);
});

test('Scan Receive: an archived product never tallies — the restore-first guidance answers', () => {
  assert.match(
    scan,
    /if \(\(match\.status \|\| 'active'\) === 'archived'\) \{\s*\/\/ Archived stock is frozen[\s\S]*?setError\(t\('inventoryLib\.archivedFrozen', \{ name: match\.name \}\)\);/,
  );
});

test('Add stock sheet: the tally button sits with the quantity stepper, Receive mode only', () => {
  const qtyBlock = dialog.slice(dialog.indexOf('<QuantityStepper'), dialog.indexOf("t('inventory.noteLabel')"));
  assert.match(qtyBlock, /mode === 'receive' && \(/);
  assert.match(qtyBlock, /t\('scanTally\.title'\)/);
  assert.match(qtyBlock, /setScannerOpen\(true\)/);
});

test('Add stock sheet: its scanner tallies only its own product, into the same quantity', () => {
  assert.match(dialog, /<BarcodeScanner onDetect=\{handleTallyDetect\} \/>/);
  assert.match(dialog, /if \(match\.id !== product\.id\) \{/);
  assert.match(dialog, /t\('scanTally\.otherProduct', \{ name: match\.name, product: product\.name \}\)/);
  assert.match(dialog, /const next = \(Number\(quantityRef\.current\) \|\| 0\) \+ 1;/);
  assert.match(dialog, /changeQuantity\(String\(next\)\);/);
  assert.match(dialog, /t\('inventoryLib\.archivedFrozen', \{ name: product\.name \}\)/);
  // The one confirm still writes the movement; the tally never does.
  assert.match(dialog, /await recordMovement\(\{\s*product,\s*location,\s*type: mode,\s*quantity: qty,/);
});

test('Add stock sheet: the first scan claims the default one; hand touches end the fresh state', () => {
  assert.match(dialog, /if \(tallyFreshRef\.current && \(Number\(quantityRef\.current\) \|\| 0\) === 1\) \{/);
  assert.match(dialog, /onChange=\{changeQuantityByHand\}/);
});

test('the five scanTally keys exist in all 52 locales with their placeholders intact', async () => {
  const dir = new URL('../../src/lib/locales/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.equal(files.length, 52, '52 locale files');
  for (const file of files) {
    const mod = await import(new URL(file, dir));
    const dict = Object.values(mod)[0];
    for (const key of ['scanTally.title', 'scanTally.hint', 'scanTally.done']) {
      assert.ok(typeof dict[key] === 'string' && dict[key].length > 0, `${file}: ${key}`);
    }
    assert.match(dict['scanTally.scanned'], /\{name\}/, `${file}: scanned {name}`);
    assert.match(dict['scanTally.scanned'], /\{count\}/, `${file}: scanned {count}`);
    assert.match(dict['scanTally.otherProduct'], /\{name\}/, `${file}: otherProduct {name}`);
    assert.match(dict['scanTally.otherProduct'], /\{product\}/, `${file}: otherProduct {product}`);
    // The count lesson teaches the tally way in this language too.
    assert.ok(dict['training.lessons.counts-run.step2'].length > 40, `${file}: counts step2 present`);
  }
});

test('the tally lesson steps are genuinely translated, not English copies', async () => {
  const dir = new URL('../../src/lib/locales/', import.meta.url);
  const en = Object.values(await import(new URL('en.js', dir)))[0];
  for (const file of ['es-MX.js', 'de.js', 'ar.js', 'ja.js', 'pcm.js', 'wuu.js']) {
    const dict = Object.values(await import(new URL(file, dir)))[0];
    assert.notEqual(
      dict['training.lessons.counts-run.step2'],
      en['training.lessons.counts-run.step2'],
      `${file}: counts step2 translated`,
    );
    assert.notEqual(dict['scanTally.title'], en['scanTally.title'], `${file}: title translated`);
    assert.ok(
      dict['training.lessons.products-find-edit.step6'].length >
        en['training.lessons.products-find-edit.step6'].length - 400,
      `${file}: products step6 carries the tally sentence`,
    );
  }
});
