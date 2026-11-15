/**
 * T6 — No loading flash on background refetches (owner ruling,
 * Nov 14, 2026): a stepper tap on Products saved its movement, the
 * freshness bus refetched, and the page flashed its full loading
 * state over the list — the number updated, but the flash made it
 * feel broken. The rule: a background refetch never blanks a list
 * that already has content; the loading state renders only when
 * there is nothing to show yet (a business's first load here).
 *
 * The mechanism, uniform across the freshness-bus pages: each data
 * effect records which business has completed a load
 * (loadedForRef) and only raises the loading state for a business
 * that has not loaded yet; the freshness subscription itself is
 * untouched, so pages still agree without a manual refresh.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const GUARDED = [
  ['src/pages/Products.jsx', "useDataFresh('inventory', '/products', () => setReload((r) => r + 1));"],
  ['src/pages/Dashboard.jsx', "useDataFresh('inventory', '/', () => setReload((r) => r + 1));"],
  ['src/pages/Categories.jsx', "useDataFresh('inventory', '/categories', () => setReload((r) => r + 1));"],
  ['src/pages/Counts.jsx', "useDataFresh('inventory', '/counts', () => setReload((r) => r + 1));"],
  ['src/pages/Orders.jsx', "useDataFresh('inventory', '/orders', () => setReload((r) => r + 1));"],
  ['src/pages/Returns.jsx', "useDataFresh('inventory', '/returns', () => setReload((r) => r + 1));"],
];

for (const [rel, subscription] of GUARDED) {
  test(`${rel}: background refetches never raise the loading state over content`, () => {
    const src = read(rel);
    assert.ok(
      src.includes('if (loadedForRef.current !== activeId) setLoading(true);'),
      'the loading state is raised only for a business that has not loaded yet',
    );
    assert.ok(
      src.includes('loadedForRef.current = activeId;'),
      'a completed load is recorded, so later refetches stay silent',
    );
    assert.doesNotMatch(
      src,
      /^\s+setLoading\(true\);$/m,
      'no unguarded setLoading(true) remains — every raise goes through the guard',
    );
    assert.ok(
      src.includes('const [loading, setLoading] = useState(true);'),
      'the first-ever load still shows the loading state',
    );
    assert.ok(src.includes(subscription), 'the freshness subscription is untouched — pages still agree without a manual refresh');
  });
}

test('scan product list: refresh keeps its rows while refetching', () => {
  const src = read('src/components/scan/ScanProductList.jsx');
  assert.ok(
    src.includes('if (itemsRef.current.length === 0) setLoading(true);'),
    'the loading state rises only when the list has nothing to show yet',
  );
  assert.doesNotMatch(src, /^\s+setLoading\(true\);$/m, 'no unguarded setLoading(true) remains');
  assert.ok(src.includes('itemsRef.current = products;'), 'landed rows are remembered for the next refetch');
});

test('my inventory: the freshness path never nulls the data it already shows', () => {
  const src = read('src/pages/Inventory.jsx');
  assert.ok(
    src.includes("useDataFresh('inventory', '/inventory', load);"),
    'freshness calls load directly, which replaces data only when the fresh copy lands',
  );
  assert.equal(
    (src.match(/setInventory\(null\)/g) || []).length,
    1,
    'setInventory(null) exists only in the mount/business-change effect, never on a freshness refetch',
  );
});

test('the guard is plan-independent: it keys on the business, never on a plan or entitlement', () => {
  // Shared-surface rule (owner requirement, Nov 14, 2026): the
  // no-flash guard behaves identically on Essentials and Business
  // because it consults nothing but which business has loaded.
  for (const [rel] of GUARDED) {
    const src = read(rel);
    const guardLine = src.split('\n').find((line) => line.includes('loadedForRef.current !== activeId'));
    assert.ok(guardLine, `${rel} carries the guard`);
    assert.ok(!/plan|entitlement|can\(/.test(guardLine), `${rel}'s guard never consults the plan`);
  }
});
