/**
 * T49 — Release 352: Ships from = stores only.
 *
 * The owner's catch and ruling (Nov 23, 2026): creating an
 * order, the Ships from picker offered "My Business" AND
 * "My Business 2" — but My Business 2 is a SHELF nested under
 * the store, and a shelf is never a shipping origin. "It
 * should only be their business name on there."
 *
 * These tests pin:
 *  - the picker's options are the business's operating sites
 *    only (top-level store / warehouse / other), in list
 *    order — nested locations and top-level shelves excluded;
 *  - a new order's default ships-from is the FIRST SITE, even
 *    when the raw list leads with a shelf;
 *  - edit mode: a legacy order whose stored ships-from names
 *    a shelf keeps that value among its options (shown, and
 *    preserved on save) — never silently rewritten;
 *  - the kind list behind the filter cannot drift from the
 *    one site predicate (isOperatingSite in entitlements.js);
 *  - the client wiring: the order form's picker and defaults
 *    ride the filtered helpers, and the stock / count pickers
 *    still offer shelves exactly as before (non-regression);
 *  - the print side only prints the stored value (unchanged).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  firstShipFromLocation,
  isShipFromLocation,
  shipFromLocations,
} from '../../src/lib/locations.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const store = { id: 'store-1', name: 'My Business', kind: 'store', parent_id: null };
const shelf = { id: 'shelf-1', name: 'My Business 2', kind: 'shelf', parent_id: 'store-1' };
const bin = { id: 'bin-1', name: 'Bin 3', kind: 'bin', parent_id: 'shelf-1' };
const warehouse = { id: 'wh-1', name: 'Back Warehouse', kind: 'warehouse', parent_id: null };
const topShelf = { id: 'shelf-top', name: 'Loose Shelf', kind: 'shelf', parent_id: null };
const kindless = { id: 'plain-1', name: 'Plain Place', parent_id: null };
const LIST = [shelf, store, bin, warehouse, topShelf, kindless];

test('options: operating sites only, in list order — shelves and bins never appear', () => {
  const options = shipFromLocations(LIST);
  assert.deepEqual(
    options.map((l) => l.id),
    ['store-1', 'wh-1', 'plain-1'],
    'the store, the warehouse and the kindless top-level place (a store by default) — nothing nested, no top-level shelf',
  );
  assert.equal(isShipFromLocation(store), true);
  assert.equal(isShipFromLocation(shelf), false, 'a shelf inside a store is not a shipping origin');
  assert.equal(isShipFromLocation(bin), false, 'a bin inside the shelf is not either');
  assert.equal(isShipFromLocation(topShelf), false, 'a shelf is a shelf even at the top level');
  assert.equal(isShipFromLocation(kindless), true, 'a top-level place with no kind reads as a store');
  assert.equal(isShipFromLocation(null), false);
  assert.deepEqual(shipFromLocations([]), []);
});

test('default: the first SITE, even when the raw list leads with a shelf', () => {
  assert.equal(firstShipFromLocation(LIST)?.id, 'store-1', 'the shelf at the head of the list is skipped');
  assert.equal(firstShipFromLocation([shelf, bin]), null, 'no site anywhere — no default');
  assert.equal(firstShipFromLocation([]), null);
  assert.equal(firstShipFromLocation([warehouse, store])?.id, 'wh-1', 'list order decides between sites');
});

test('edit mode: a legacy shelf value stays visible and saveable; a site value is never duplicated', () => {
  const legacy = shipFromLocations(LIST, 'shelf-1');
  assert.deepEqual(
    legacy.map((l) => l.id),
    ['store-1', 'wh-1', 'plain-1', 'shelf-1'],
    'the stored shelf rides along AFTER the sites, exactly once — shown, not rewritten',
  );
  const normal = shipFromLocations(LIST, 'store-1');
  assert.deepEqual(normal.map((l) => l.id), ['store-1', 'wh-1', 'plain-1'], 'a stored site adds nothing');
  assert.deepEqual(
    shipFromLocations(LIST, 'gone-id').map((l) => l.id),
    ['store-1', 'wh-1', 'plain-1'],
    'a stored id that no longer exists adds nothing',
  );
  assert.deepEqual(
    shipFromLocations(LIST, '').map((l) => l.id),
    ['store-1', 'wh-1', 'plain-1'],
    'no stored value — sites only',
  );
});

test('the kind list cannot drift from the one site predicate', () => {
  const entitlements = read('src/lib/entitlements.js');
  const locations = read('src/lib/locations.js');
  const kindsOf = (src, name) => {
    const m = src.match(new RegExp(`${name} = \\[([^\\]]+)\\]`));
    assert.ok(m, `${name} found`);
    return m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  };
  assert.deepEqual(
    kindsOf(locations, 'SHIP_FROM_KINDS'),
    kindsOf(entitlements, 'OPERATING_SITE_KINDS'),
    'ships-from kinds == operating-site kinds',
  );
  assert.match(entitlements, /export function isOperatingSite\(location\)/, 'the predicate itself still stands');
});

test('client wiring: the order form rides the filtered helpers for options AND defaults', () => {
  const form = read('src/components/orders/OrderFormDialog.jsx');
  assert.match(
    form,
    /import \{ firstShipFromLocation, shipFromLocations \} from '@\/lib\/locations';/,
    'the form imports the ships-from helpers',
  );
  assert.match(
    form,
    /const shipFromOptions = shipFromLocations\(localLocations, order \? form\.location_id : ''\);/,
    'options derive from the filtered helper, legacy value only in edit mode',
  );
  const defaults = form.match(/firstShipFromLocation\(locations\)\?\.id \|\| ''/g) || [];
  assert.equal(defaults.length, 2, 'both the edit fallback and the create default derive from the filtered list');
  assert.doesNotMatch(form, /locations\[0\]\?\.id/, 'the raw first-location default is gone');

  const pickerAt = form.indexOf("t('orders.shipsFrom')");
  const shipToAt = form.indexOf("t('orders.shipToTitle')", pickerAt);
  const picker = form.slice(pickerAt, shipToAt);
  assert.match(picker, /shipFromOptions\.map\(\(l\)/, 'the picker renders the filtered options');
  assert.doesNotMatch(picker, /localLocations\.map/, 'the picker no longer renders the full list');
  assert.match(
    form,
    /const location = localLocations\.find\(\(l\) => l\.id === form\.location_id\);/,
    "save still resolves the saved name from the FULL list — a legacy shelf keeps its name on save",
  );
});

test('non-regression: the stock and count pickers still offer every location, shelves included', () => {
  const counts = read('src/components/counts/CountSessionDialog.jsx');
  assert.match(counts, /localLocations\.map\(\(l\)/, 'the count picker still maps the full list');
  assert.doesNotMatch(counts, /shipFromLocations/, 'the count picker was not filtered');

  const productForm = read('src/components/products/ProductFormDialog.jsx');
  assert.match(productForm, /locations\.map\(\(l\)/, 'the product stock pickers still map the full list');
  assert.doesNotMatch(productForm, /shipFromLocations/, 'the product form was not filtered');

  const inventory = read('src/pages/Inventory.jsx');
  assert.match(inventory, /locations\.map\(\(location\)/, 'the Inventory filter still spans every location');
  assert.doesNotMatch(inventory, /shipFromLocations/, 'Inventory was not filtered');
});

test('print side: CustomerDoc only prints the stored ships-from value — no picker, no filter', () => {
  const doc = read('src/components/print/CustomerDoc.jsx');
  assert.match(doc, /order\.location_name/, 'the printed value is the order\u2019s stored name');
  assert.doesNotMatch(doc, /shipFromLocations|isShipFromLocation/, 'no ships-from filtering entered the print side');
});
