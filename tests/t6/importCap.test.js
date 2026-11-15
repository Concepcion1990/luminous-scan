// Import cap-awareness (owner rulings, Nov 14, 2026): the dry run
// states the plan room in plain words and counts the rows that do
// not fit; 'Re-run dry run' genuinely re-tests against the current
// catalog; the cap refusal copy names the true doors (a delete
// frees a slot — archiving frees nothing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, rel), 'utf8');

// importProducts.js imports through the '@' alias; rewrite it to a
// relative path in a temp copy so node can load the real module.
const libSrc = read('../../src/lib/importProducts.js').replace(
  '@/lib/csvImport',
  path.join(here, '../../src/lib/csvImport.js'),
);
const tmp = path.join(tmpdir(), 'importProducts.testable.mjs');
writeFileSync(tmp, libSrc);
const { evaluateRows } = await import(pathToFileURL(tmp).href);

const table = {
  headers: ['name', 'sku', 'price'],
  rows: [
    ['Alpha', 'A-1', '1.00'],
    ['Beta', 'B-1', '2.00'],
    ['Gamma', 'G-1', '3.00'],
    ['Delta', 'D-1', '4.00'],
    ['Epsilon', 'E-1', '5.00'],
  ],
};
const mapping = ['name', 'sku', 'price'];

test('dry run is cap-aware: rows past the room are counted as over, never ready', () => {
  const verdict = evaluateRows({ table, mapping, existing: {}, room: 2 });
  assert.equal(verdict.ready, 2);
  assert.equal(verdict.over, 3);
  assert.equal(verdict.skipped, 0);
  assert.deepEqual(
    verdict.rows.map((r) => r.status),
    ['ready', 'ready', 'over', 'over', 'over'],
  );
  // Over rows explain themselves in the preview but stay out of the
  // problems list — they are reported by their own count.
  assert.match(verdict.rows[2].problem, /Plan is full/);
  assert.equal(verdict.problems.length, 0);
});

test('no cap (Business) means no over rows; zero room means everything is over', () => {
  const open = evaluateRows({ table, mapping, existing: {}, room: null });
  assert.equal(open.ready, 5);
  assert.equal(open.over, 0);
  const shut = evaluateRows({ table, mapping, existing: {}, room: 0 });
  assert.equal(shut.ready, 0);
  assert.equal(shut.over, 5);
});

test('the cap refusal copy names the true doors — delete frees a slot, archiving does not', async () => {
  const { productLimitMessage } = await import('../../server/plans.js');
  const msg = productLimitMessage(50, 50);
  assert.match(msg, /includes 50 products and 50 are already in the catalog/);
  assert.match(msg, /Delete a product you no longer need to free a slot/);
  assert.doesNotMatch(msg, /Archive/);
});

test('re-run dry run re-reads the catalog and refreshes the verdict', () => {
  const wb = read('../../src/components/import/ImportWorkbench.jsx');
  // runCheck fetches the current catalog instead of re-reading the
  // file-load snapshot, and stores the room in the verdict.
  assert.match(wb, /const runCheck = async \(\) => \{/);
  assert.match(wb, /base44\.entities\.Product\.filter\(scoped\(\{\}, businessId\), \{ limit: 1000 \}\)/);
  assert.match(wb, /have,\n        cap,\n        room,/);
  // The button shows it is working while the re-check runs.
  assert.match(wb, /checking \? \(/);
  // Pick-and-choose (Nov 15, 2026): verdicts are computed WITHOUT
  // the positional cap pass — the cap is judged on the TICKED
  // count, and the commit is refused while ticked > room.
  assert.match(wb, /evaluateRows\(\{ table, mapping, existing: existingKeys\(fresh\), room: null \}\)/);
  assert.match(wb, /evaluateRows\(\{ table, mapping, existing, room: null \}\)/);
  assert.match(wb, /over: room != null \? Math\.max\(0, ticked\.length - room\) : 0/);
  assert.match(wb, /overRoom > 0/);
});

test('re-run re-tests on Receive and Update too — all three operations', () => {
  const receive = read('../../src/components/import/ReceiveWorkbench.jsx');
  assert.match(receive, /const runCheck = async \(\) => \{/);
  assert.match(receive, /evaluateReceipts\(\{\s*table: sheet\.table,\s*mapping: sheet\.mapping,\s*products: freshProducts,\s*levels: freshLevels,\s*locationId,\s*\}\)/);
  assert.match(receive, /checking \? \(/);
  const update = read('../../src/components/import/UpdateWorkbench.jsx');
  assert.match(update, /const runCheck = async \(\) => \{/);
  assert.match(update, /evaluateUpdates\(\{ table: sheet\.table, mapping: sheet\.mapping, products: fresh, clearBlanks \}\)/);
  assert.match(update, /checking \? \(/);
});

test('the dry-run panel states the room and the not-fitting count', () => {
  const panel = read('../../src/components/import/DryRunPanel.jsx');
  assert.match(panel, /import\.dryRunRoom/);
  assert.match(panel, /import\.dryRunOver/);
  assert.match(panel, /capView\.cap != null/);
});
