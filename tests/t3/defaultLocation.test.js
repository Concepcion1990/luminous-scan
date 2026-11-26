/**
 * Default location (Nov 14, 2026): a fresh business used to get NO
 * location at all, so a new customer could not stock anything —
 * every picker was an empty dropdown whose only answer was a
 * scolding. The owner's rulings, pinned here:
 *  - creating a business seeds exactly ONE default location
 *    (kind 'store', deterministic id 'default-<businessId>');
 *  - the default takes its identity FROM THE BUSINESS: it is
 *    named with the business's name as recorded in Settings;
 *  - an existing business found with zero locations heals to
 *    exactly one (the runtime twin of migration 021's backfill —
 *    the migration itself covers production data at deploy);
 *  - a business that has locations is never touched;
 *  - the name link is ONE-WAY: while the default still wears the
 *    business name (untouched), a Settings rename flows through;
 *    once the owner renames the location itself, their name
 *    sticks — and a location rename NEVER writes back into the
 *    business record.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  req,
  pool,
  close,
  ownerWithBusiness,
  createLocation,
} from './helpers.js';

after(close);

let counter = 0;
const nextEmail = () => `defloc-${Date.now()}-${counter++}@example.com`;

async function listLocations(cookie, businessId) {
  const res = await req('/api/entities/Location/query', {
    method: 'POST',
    body: { filter: { business_id: businessId } },
    cookie,
  });
  assert.equal(res.status, 200, res.text);
  return res.json.items;
}

async function businessName(cookie, businessId) {
  const res = await req('/api/businesses', { cookie });
  assert.equal(res.status, 200, res.text);
  const list = res.json.items || res.json.businesses || res.json;
  const found = (Array.isArray(list) ? list : []).find((b) => b.id === businessId);
  assert.ok(found, 'business listed');
  return found.name;
}

async function renameBusiness(cookie, businessId, name) {
  const res = await req(`/api/businesses/${businessId}`, {
    method: 'PATCH',
    body: { name },
    cookie,
  });
  assert.equal(res.status, 200, res.text);
  return res.json;
}

test('a new business starts with exactly one default location named after the business', async () => {
  const { cookie, business } = await ownerWithBusiness(nextEmail(), 'Test Shop');
  const locations = await listLocations(cookie, business.id);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].id, `default-${business.id}`);
  assert.equal(locations[0].name, 'Test Shop');
  assert.equal(locations[0].kind, 'store');
});

test('a zero-location legacy business heals to exactly one, named after the business, idempotently', async () => {
  const { cookie, business } = await ownerWithBusiness(nextEmail(), 'Heal Me Store');
  // Simulate a pre-fix business: wipe its locations directly.
  await pool.query('DELETE FROM locations WHERE business_id = $1', [business.id]);
  const healed = await listLocations(cookie, business.id);
  assert.equal(healed.length, 1);
  assert.equal(healed[0].name, 'Heal Me Store');
  const again = await listLocations(cookie, business.id);
  assert.equal(again.length, 1);
  assert.equal(again[0].id, healed[0].id);
});

test('a business with locations is never given another', async () => {
  const { cookie, business } = await ownerWithBusiness(nextEmail(), 'Test Shop');
  await createLocation(cookie, business.id, { name: 'Back room', kind: 'storage' });
  const locations = await listLocations(cookie, business.id);
  assert.equal(locations.length, 2);
  assert.equal(
    locations.filter((l) => l.id === `default-${business.id}`).length,
    1,
    'the seeded default stays the only default',
  );
});

test('a Settings rename flows through to the untouched default location', async () => {
  const { cookie, business } = await ownerWithBusiness(nextEmail(), 'Old Name Gifts');
  await renameBusiness(cookie, business.id, 'New Name Gifts');
  const locations = await listLocations(cookie, business.id);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].name, 'New Name Gifts');
});

test('a location-side rename sticks: later Settings renames no longer flow', async () => {
  const { cookie, business } = await ownerWithBusiness(nextEmail(), 'First Name Books');
  const [seeded] = await listLocations(cookie, business.id);
  const renamed = await req(`/api/entities/Location/${seeded.id}`, {
    method: 'PATCH',
    body: { name: 'Shelf A' },
    cookie,
  });
  assert.equal(renamed.status, 200, renamed.text);
  await renameBusiness(cookie, business.id, 'Second Name Books');
  const locations = await listLocations(cookie, business.id);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].name, 'Shelf A', 'the owner’s own location name wins');
});

test('ONE-WAY: renaming the default location never renames the business', async () => {
  const { cookie, business } = await ownerWithBusiness(nextEmail(), 'Byte Identical Books');
  const before = await businessName(cookie, business.id);
  const [seeded] = await listLocations(cookie, business.id);
  const renamed = await req(`/api/entities/Location/${seeded.id}`, {
    method: 'PATCH',
    body: { name: 'Shelf A' },
    cookie,
  });
  assert.equal(renamed.status, 200, renamed.text);
  const after = await businessName(cookie, business.id);
  assert.equal(after, before);
  assert.equal(after, 'Byte Identical Books');
});

test('migration 021 backfills zero-location businesses at deploy, named from the business', () => {
  const sql = readFileSync(new URL('../../migrations/021_default_location.sql', import.meta.url), 'utf8');
  assert.match(sql, /INSERT INTO locations/);
  assert.match(sql, /LEFT JOIN locations/);
  assert.match(sql, /businesses\.name/);
});

test('the empty-picker door exists in the adjust dialog, the product form and Scan', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const adjust = read('../../src/components/inventory/AdjustStockDialog.jsx');
  const form = read('../../src/components/products/ProductFormDialog.jsx');
  const scan = read('../../src/pages/Scan.jsx');
  for (const [name, src] of [['adjust', adjust], ['form', form], ['scan', scan]]) {
    assert.match(src, /AddLocationInline/, `${name} offers the inline add-a-location door`);
  }
  assert.match(adjust, /localLocations\.length === 0/);
  const inline = read('../../src/components/locations/AddLocationInline.jsx');
  assert.match(inline, /entities\.Location\.create/);
  assert.match(inline, /locations\.inlineAddHint/);
});

test('categories ride the freshness bus like products do', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const client = read('../../src/api/client.js');
  assert.match(client, /INVENTORY_ENTITIES = new Set\(\[[^\]]*'Category'/);
  const vocab = read('../../src/hooks/useCatalogVocabulary.js');
  assert.match(vocab, /subscribeData\('inventory'/);
  const categories = read('../../src/pages/Categories.jsx');
  assert.match(categories, /useDataFresh\('inventory', '\/categories'/);
});

test('locations ride the freshness bus too (Movements filter, Scan picker)', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const client = read('../../src/api/client.js');
  assert.match(client, /INVENTORY_ENTITIES = new Set\(\[[^\]]*'Location'/);
  const movements = read('../../src/pages/Movements.jsx');
  assert.match(movements, /useDataFresh\('inventory', '\/movements'/);
  const scan = read('../../src/pages/Scan.jsx');
  assert.match(scan, /useDataFresh\('inventory', '\/scan'/);
});

test('the Start-a-count picker offers the same door and preselects the single location', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const dialog = read('../../src/components/counts/CountSessionDialog.jsx');
  assert.match(dialog, /AddLocationInline/);
  assert.match(dialog, /localLocations\.length === 0/);
  assert.match(dialog, /setLocationId\(locations\[0\]\?\.id \|\| ''\)/, 'the first (single) location is preselected on open');
  const counts = read('../../src/pages/Counts.jsx');
  assert.match(counts, /useDataFresh\('inventory', '\/counts'/);
});

test('the Log-a-return "Returned to" picker offers the same door', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const form = read('../../src/components/returns/ReturnFormDialog.jsx');
  assert.match(form, /AddLocationInline/, 'the return form offers the inline door when no location exists');
  // Amended by the smalls bundle (Nov 25, 2026): "Returned to" names a
  // STORE, never a shelf (the owner's ruling closing the 352 flag), so
  // the door now shows when no operating site exists — a shelf alone
  // no longer fills the picker.
  assert.match(form, /shipFromLocations\(localLocations, form\.location_id\)\.length === 0/);
  assert.match(form, /localLocations\.find/, 'the return form saves against its local location list');
  const returnsPage = read('../../src/pages/Returns.jsx');
  assert.match(returnsPage, /useDataFresh\('inventory', '\/returns'/, 'location renames reach Returns on next view');
});
