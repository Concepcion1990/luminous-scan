/**
 * Scanner → print shelf tag hook (T5, Walmart scanner item 5).
 *
 * Static assertions (no browser harness in this repo): the scanner
 * offers "Print shelf tag" for the scanned product and lands on the
 * print page with the product preselected; the print page consumes
 * that navigation state into its selection. Labels print on both
 * plans, so the hook carries no plan check.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scanSrc = readFileSync(path.join(root, 'src/pages/Scan.jsx'), 'utf8');
const printSrc = readFileSync(path.join(root, 'src/pages/PrintCenter.jsx'), 'utf8');
const enSrc = readFileSync(path.join(root, 'src/lib/locales/en.js'), 'utf8');

test('scanner offers Print shelf tag for the scanned product', () => {
  // T6 i18n: the button label goes through t() — the English words
  // live in the locale file, the button carries the key.
  assert.match(scanSrc, /t\('scan\.printShelfTag'\)/);
  assert.match(enSrc, /'scan\.printShelfTag': 'Print shelf tag'/);
  // A plain synchronous navigate to /print carrying the product —
  // no pending state, so nothing that can stick (owner quality bar).
  assert.match(scanSrc, /navigate\('\/print', \{ state: \{ product \} \}\)/);
  assert.match(scanSrc, /useNavigate/);
  // The button sits on the scanned-product panel (with the product
  // in scope), next to Scan next — not on the empty/idle state.
  const panel = scanSrc.slice(scanSrc.indexOf('{product && ('));
  assert.match(panel, /scan\.printShelfTag/);
});

test('print page preselects the product the scanner sends it', () => {
  assert.match(printSrc, /useLocation/);
  assert.match(printSrc, /location\.state\?\.product/);
  assert.match(printSrc, /setSelected\(\(list\) =>/);
});

test('the shelf-tag hook carries no plan gate (labels are both plans)', () => {
  // The hook path must not consult the entitlement: labels print on
  // Essentials and Business alike. The plan gates only the document
  // templates (asserted in planLimits.test.js). Bound the slice to
  // the hook's own effect block — the rest of the page is full of
  // legitimate plan gating.
  const effect = printSrc.match(/Shelf-tag hook[\s\S]*?\}, \[location\.state\]\)/);
  assert.ok(effect, 'shelf-tag hook effect not found');
  assert.doesNotMatch(effect[0], /isEssentials/);
  assert.doesNotMatch(effect[0], /isBusiness/);
});
