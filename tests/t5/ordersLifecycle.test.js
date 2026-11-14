/**
 * T5 — orders: ship-to address, the 90-day customer address book,
 * lifecycle truthfulness, and Till-connections invisibility
 * (the owner's Nov 14, 2026 rulings).
 *
 * Address book identity: NAME + ADDRESS together (a name alone
 * never identifies a customer). Same name + same address = one
 * entry, refreshed; same name + different address = a separate
 * entry with its own clock. The purge governs only the reusable
 * copy — an order keeps its own address forever.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { close, req, pool, ownerWithBusiness, setPlan } from './helpers.js';

after(close);

process.env.BILLING_JOB_SECRET = '<redacted>'

const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

let seq = 0;
async function setup(plan = 'essentials') {
  seq += 1;
  const owner = await ownerWithBusiness(`orders-life-${seq}@example.com`);
  await setPlan(owner.business.id, plan, owner.user.id);
  return owner;
}

async function createOrder(owner, values = {}) {
  seq += 1;
  const res = await req('/api/entities/Order', {
    method: 'POST',
    body: {
      business_id: owner.business.id,
      number: `ORD-T-${seq}`,
      customer_name: 'Jamie Rivera',
      lines: [],
      total: 0,
      ...values,
    },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 201, res.text);
  return res.json;
}

async function listOrders(owner) {
  const res = await req('/api/entities/Order/query', {
    method: 'POST',
    body: { filter: { business_id: owner.business.id } },
    cookie: owner.cookie,
  });
  assert.equal(res.status, 200, res.text);
  return res.json.items;
}

async function savedAddresses(owner, name) {
  const res = await req(
    `/api/businesses/${owner.business.id}/customer-addresses?name=${encodeURIComponent(name)}`,
    { cookie: owner.cookie },
  );
  assert.equal(res.status, 200, res.text);
  return res.json.addresses;
}

const ADDR_A = {
  ship_street: '12 Canyon Road',
  ship_city: 'Santa Fe',
  ship_region: 'NM',
  ship_postal: '87501',
  ship_country: 'US',
};
const ADDR_B = {
  ship_street: '900 Desert Lane',
  ship_city: 'Taos',
  ship_region: 'NM',
  ship_postal: '87571',
  ship_country: 'US',
};

test('ship-to address saves on the order and round-trips intact', async () => {
  const owner = await setup();
  const order = await createOrder(owner, { ...ADDR_A });
  assert.equal(order.ship_street, '12 Canyon Road');
  assert.equal(order.ship_city, 'Santa Fe');
  assert.equal(order.ship_region, 'NM');
  assert.equal(order.ship_postal, '87501');
  assert.equal(order.ship_country, 'US');

  const listed = (await listOrders(owner)).find((row) => row.id === order.id);
  assert.equal(listed.ship_street, '12 Canyon Road');
  assert.equal(listed.ship_postal, '87501');

  const bare = await createOrder(owner, {});
  assert.equal(bare.ship_street, '');
  assert.equal(bare.ship_city, '');
  assert.equal(bare.ship_country, '');
});

test('address book: an order with name + address creates one reusable entry', async () => {
  const owner = await setup();
  await createOrder(owner, { ...ADDR_A });
  const entries = await savedAddresses(owner, 'Jamie Rivera');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ship_street, '12 Canyon Road');
  assert.equal(entries[0].ship_city, 'Santa Fe');
  // Roughly 90 days out.
  const days = (new Date(entries[0].expires_at) - Date.now()) / 86400000;
  assert.ok(days > 89 && days <= 90, `expiry ~90 days out, got ${days}`);
});

test('address book: same name + same address (case/space aside) is ONE entry, refreshed', async () => {
  const owner = await setup();
  await createOrder(owner, { ...ADDR_A });
  const before = await savedAddresses(owner, 'Jamie Rivera');
  assert.equal(before.length, 1);

  await createOrder(owner, {
    customer_name: '  jamie   RIVERA ',
    ship_street: '12  Canyon   Road',
    ship_city: 'SANTA FE',
    ship_region: 'nm',
    ship_postal: '87501',
    ship_country: 'us',
  });
  const afterEntries = await savedAddresses(owner, 'Jamie Rivera');
  assert.equal(afterEntries.length, 1, 'normalization keeps it a single entry');
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM customer_addresses WHERE business_id = $1',
    [owner.business.id],
  );
  assert.equal(rows[0].n, 1);
});

test('address book: same name + DIFFERENT address is a separate entry with its own clock', async () => {
  const owner = await setup();
  await createOrder(owner, { ...ADDR_A });
  await createOrder(owner, { ...ADDR_B });
  const entries = await savedAddresses(owner, 'Jamie Rivera');
  assert.equal(entries.length, 2);
  const streets = entries.map((e) => e.ship_street).sort();
  assert.deepEqual(streets, ['12 Canyon Road', '900 Desert Lane']);
});

test('address book: an order with no address creates no entry', async () => {
  const owner = await setup();
  await createOrder(owner, {});
  const entries = await savedAddresses(owner, 'Jamie Rivera');
  assert.equal(entries.length, 0);
});

test('address book sweep: a lapsed entry is purged, a live one kept, the order keeps its address', async () => {
  const owner = await setup();
  const orderA = await createOrder(owner, { ...ADDR_A });
  await createOrder(owner, { ...ADDR_B });

  // Age entry A past its window; entry B stays live.
  await pool.query(
    `UPDATE customer_addresses SET expires_at = $1
     WHERE business_id = $2 AND ship_street = '12 Canyon Road'`,
    [new Date(Date.now() - 60000).toISOString(), owner.business.id],
  );

  const sweep = await req('/api/billing/wipe-sweep', {
    method: 'POST',
    headers: { 'x-job-secret': process.env.BILLING_JOB_SECRET },
    body: {},
  });
  assert.equal(sweep.status, 200, sweep.text);
  assert.ok(sweep.json.customerAddresses.purged >= 1, 'the lapsed entry was purged');

  const entries = await savedAddresses(owner, 'Jamie Rivera');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ship_street, '900 Desert Lane');

  // The purge governs only the reusable copy: order A still
  // carries its own address on its own record.
  const listed = (await listOrders(owner)).find((row) => row.id === orderA.id);
  assert.equal(listed.ship_street, '12 Canyon Road');
  assert.equal(listed.ship_city, 'Santa Fe');
});

test('lifecycle pins: card actions follow held truth; Edit covers packed; banner carries its door', () => {
  const card = src('src/components/orders/OrderCard.jsx');
  assert.match(card, /heldUnits\(order\) > 0/, 'the card reads the order’s real held units');
  assert.match(card, /holdable = \['new', 'pending', 'reserved', 'packed'\]/, 'Hold stock is offered in every holdable state');
  assert.match(card, /canEdit = \['new', 'pending', 'reserved', 'packed'\]/, 'Edit stays available through packed');

  const lib = src('src/lib/orders.js');
  assert.match(lib, /\['new', 'pending', 'packed'\]\.includes\(order\.status/, 'reserveOrder accepts a packed order');
  assert.match(lib, /order\.status === 'packed' \? 'packed' : 'reserved'/, 'holding a packed order keeps it packed');
  assert.match(lib, /err\.code = 'choose_ship_from'/, 'the ships-from block carries its code');

  const page = src('src/pages/Orders.jsx');
  assert.match(page, /editOrderId/, 'the blocked banner remembers which order to open');
  assert.match(page, /t\('orders\.editOrder'\)/, 'the banner renders the Edit order door');
  assert.match(page, /setFocusShipsFrom\(true\)/, 'the door opens the form focused on ships-from');

  const dialog = src('src/components/orders/OrderFormDialog.jsx');
  assert.match(dialog, /focusShipsFrom/, 'the form accepts the ships-from focus request');
  assert.match(dialog, /shipsFromRef/, 'the ships-from field is scroll-targeted');
});

test('POS invisibility pins: nav hides Till connections off Business; the route bounces', () => {
  const nav = src('src/components/layout/navGroups.js');
  assert.match(
    nav,
    /\{ to: '\/pos', label: 'Till connections', labelKey: 'nav\.pos', icon: Receipt, feature: 'pos' \}/,
    'the nav item carries the pos feature so Layout hides it off Business',
  );

  const app = src('src/App.jsx');
  assert.match(app, /<PlanRedirect feature="pos">\s*<PosConnections \/>/, 'the /pos route bounces off Business');

  const redirect = src('src/components/plan/PlanRedirect.jsx');
  assert.match(redirect, /<Navigate to="\/"/, 'PlanRedirect sends non-Business plans to the Overview');

  const page = src('src/pages/PosConnections.jsx');
  assert.ok(!page.includes('<PlanGate'), 'the POS page no longer renders the gate door');
});
