// Release 361 (Nov 23, 2026): RESTAURANT OPERATIONS — the
// deferred set on 359's foundation (pinned by t56).
//
// The rulings pinned here:
//  - Migration 048: eight new business-scoped tables plus the
//    three kitchen columns on products (allergens,
//    unit_conversions, shelf_life_days).
//  - Unit conversion (A11): a recipe line written in a
//    converted unit (500 g of a kg-stocked product) costs and
//    depletes in STOCK units — lineStockQty divides by `per`;
//    an unknown unit passes through untouched and legacy
//    no-conversion behaviour is unchanged.
//  - Supplier invoices carry a computed 3-way match on read
//    (ok / short / over / price_diff / not_ordered /
//    not_invoiced + overall), and opening an invoice whose
//    billed cost differs from the product's cost opens ONE
//    vendor price alert; accepting it writes the new cost
//    onto the product, dismissing it does not.
//  - The gate FORK: building/money doors (invoices, stock
//    batches, batch runs, price-alert answers) ride
//    restaurant.build, while the DAILY-LOG writes (waste,
//    temp logs, the 86 board, staff meals) are open to any
//    trusted member — no tick. Waste money is server-shaped
//    like recipe money (restaurant.money).
//  - Staff meals write a `staff_meal` movement and deplete
//    the dish's active recipe cause-keyed to it; a dish at
//    zero still records the meal, movement_id null, and
//    depletes nothing. Batch runs produce yield × makes of
//    the recipe's linked prep product and consume the full
//    expansion cause-keyed to the produce movement; a batch
//    on a recipe with no linked product is refused.
//  - Essentials invisibility (327 doctrine) for all eight
//    new entities, plan presentation (restaurantOps +
//    restaurantDaily join Business only), the twelve new
//    nav doors, the training catalog at 115, movement-type
//    parity for staff_meal, and the restaurantLedger export
//    dataset's seven columns / four sections.
//
// TWO IMPLEMENTATION NOTES (raised by the tests child,
// closed at integration, Nov 23, 2026):
//  - WasteEntry: the server slice first wrote only the
//    waste_entries row. Integration restored the design:
//    the create hook writes the `write_off` movement tied
//    to the entry and snapshots the product's cost when
//    the caller sent none. Pinned below as designed.
//  - EightySixItem: clearing first stamped nothing.
//    Integration restored the design: the update hook
//    stamps cleared_at / cleared_by on the flip to
//    inactive. Pinned below as designed.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
  seededLocation,
  createProducts,
  receive,
  onHand,
} from './helpers.js';
import { withTx } from '../../server/billing.js';
import { recordMovementTx, MOVEMENT_TYPES as SERVER_MOVEMENT_TYPES } from '../../server/movements.js';
import { lineStockQty, recipeCostPerMake, expandRecipeToProducts } from '../../server/recipes.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS, lessonVisibleOnPlan } from '../../server/trainingCatalog.js';
import { LESSON_REQUIREMENTS } from '../../server/trainingScope.js';
import { PLANS, COMPARISON_ROWS, FEATURES, WELCOME_OPTIONS } from '../../src/lib/plans.js';
import { NAV_GROUPS } from '../../src/components/layout/navGroups.js';
import { en } from '../../src/lib/locales/en.js';

after(close);
beforeEach(() => resetRateLimits());

let seq = 0;
const email = (label) => `${label}${++seq}@example.com`;

async function createEntity(cookie, name, body) {
  return req(`/api/entities/${name}`, { method: 'POST', cookie, body });
}

async function queryEntity(cookie, name, filter) {
  return req(`/api/entities/${name}/query`, { method: 'POST', cookie, body: { filter } });
}

async function movements(bid, productId, type) {
  const { rows } = await pool.query(
    `SELECT * FROM stock_movements WHERE business_id = $1 AND product_id = $2 AND type = $3 ORDER BY created_at`,
    [bid, productId, type],
  );
  return rows;
}

/** A Business kitchen: a location, ingredients and a sellable
 *  dish whose active recipe uses pasta (stock units) and flour
 *  (stocked by the kg, written in grams on the line). */
async function kitchen(label) {
  const owner = await ownerWithBusiness(email(label), 'Kitchen', { plan: 'business' });
  const bid = owner.business.id;
  const location = await seededLocation(owner.cookie, bid);
  const [tomato, pasta, flour, dish] = await createProducts(owner.cookie, bid, [
    { name: 'Tomato', sku: 'SKU-TOM', price: 2, cost: 0.5 },
    { name: 'Pasta', sku: 'SKU-PAS', price: 3, cost: 1 },
    { name: 'Flour', sku: 'SKU-FLO', price: 4, cost: 10 },
    { name: 'Pasta Dish', sku: 'SKU-DISH', price: 12, cost: 0 },
  ]);
  // The flour is stocked by the kilogram; recipe lines may be
  // written in grams (1000 g make one stock unit).
  const patched = await req(`/api/entities/Product/${flour.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { unit: 'kg', unit_conversions: [{ unit: 'g', per: 1000 }] },
  });
  assert.equal(patched.status, 200, patched.text);
  await receive(owner.cookie, bid, tomato.id, location.id, 100);
  await receive(owner.cookie, bid, pasta.id, location.id, 40);
  await receive(owner.cookie, bid, flour.id, location.id, 10);
  await receive(owner.cookie, bid, dish.id, location.id, 10);

  const dishRecipe = await createEntity(owner.cookie, 'Recipe', {
    business_id: bid,
    name: 'Pasta al Pomodoro',
    status: 'active',
    product_id: dish.id,
    product_name: 'Pasta Dish',
    yield_qty: 1,
    lines: [
      { kind: 'product', product_id: pasta.id, product_name: 'Pasta', sku: 'SKU-PAS', unit: 'each', quantity: 3, yield_pct: 100 },
      { kind: 'product', product_id: flour.id, product_name: 'Flour', sku: 'SKU-FLO', unit: 'g', quantity: 500, yield_pct: 100 },
    ],
  });
  assert.equal(dishRecipe.status, 201, dishRecipe.text);
  return { owner, bid, location, tomato, pasta, flour, dish, dishRecipe: dishRecipe.json };
}

async function member(owner, label, roleId = 'preset-manager', roleName = 'Manager') {
  const memberEmail = email(label);
  const invite = await createEntity(owner.cookie, 'StaffMember', {
    business_id: owner.business.id,
    full_name: roleName,
    email: memberEmail,
    role_id: roleId,
    role_name: roleName,
  });
  assert.equal(invite.status, 201, invite.text);
  const account = await registerVerifiedUser(memberEmail);
  const row = (
    await pool.query('SELECT id FROM staff_members WHERE business_id = $1 AND email = $2', [
      owner.business.id,
      memberEmail,
    ])
  ).rows[0];
  return { ...account, memberId: row.id, email: memberEmail };
}

async function grantTicks(owner, memberId, ticks) {
  const row = await req(`/api/entities/StaffMember/${memberId}`, { cookie: owner.cookie });
  const permissions = [...new Set([...(row.json.permissions || []), ...ticks])];
  const res = await req(`/api/entities/StaffMember/${memberId}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { permissions },
  });
  assert.equal(res.status, 200, res.text);
}

// ---------------------------------------------------------------------------
// Migration 048 + product kitchen fields.
// ---------------------------------------------------------------------------

test('migration 048 landed: the eight ops tables and the product kitchen columns exist', async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
      WHERE table_name IN ('stock_batches','waste_entries','temp_logs','eighty_six_items',
                           'supplier_invoices','vendor_price_alerts','batch_runs','staff_meals')
      ORDER BY table_name`,
  );
  assert.deepEqual(rows.map((r) => r.table_name), [
    'batch_runs',
    'eighty_six_items',
    'staff_meals',
    'stock_batches',
    'supplier_invoices',
    'temp_logs',
    'vendor_price_alerts',
    'waste_entries',
  ]);
  // Column probes, the t56 way: a zero-row read succeeds only
  // when the column is really there.
  await pool.query('SELECT allergens, unit_conversions, shelf_life_days FROM products LIMIT 0');
  await pool.query('SELECT movement_id FROM staff_meals LIMIT 0');
  await pool.query('SELECT produce_movement_id, output_qty FROM batch_runs LIMIT 0');
  await pool.query('SELECT cleared_at, cleared_by FROM eighty_six_items LIMIT 0');
  await pool.query('SELECT purchase_order_id, po_number FROM supplier_invoices LIMIT 0');
  await pool.query('SELECT invoice_id, status FROM vendor_price_alerts LIMIT 0');
  await pool.query('SELECT expires_on FROM stock_batches LIMIT 0');
});

test('product kitchen fields round-trip: allergens, unit conversions, shelf life', async () => {
  const owner = await ownerWithBusiness(email('kitchenfields'), 'Kitchen', { plan: 'business' });
  const bid = owner.business.id;
  const [flour] = await createProducts(owner.cookie, bid, [
    { name: 'Flour', sku: 'KF-1', price: 4, cost: 10 },
  ]);
  const patched = await req(`/api/entities/Product/${flour.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: {
      unit: 'kg',
      allergens: ['gluten'],
      unit_conversions: [{ unit: 'g', per: 1000 }],
      shelf_life_days: 30,
    },
  });
  assert.equal(patched.status, 200, patched.text);
  const read = await req(`/api/entities/Product/${flour.id}`, { cookie: owner.cookie });
  assert.equal(read.status, 200);
  assert.deepEqual(read.json.allergens, ['gluten']);
  assert.deepEqual(read.json.unit_conversions, [{ unit: 'g', per: 1000 }]);
  assert.equal(read.json.shelf_life_days, 30);
});

// ---------------------------------------------------------------------------
// Unit conversion math (server/recipes.js).
// ---------------------------------------------------------------------------

test('unit conversion: 500 g at per 1000 is half a stock unit — in cost and in expansion', () => {
  // The products table stores unit_conversions as TEXT; the
  // math layer accepts the string and the parsed array alike.
  const flourText = { id: 'flour', unit: 'kg', cost: 10, unit_conversions: '[{"unit":"g","per":1000}]' };
  const flourParsed = { id: 'flour', unit: 'kg', cost: 10, unit_conversions: [{ unit: 'g', per: 1000 }] };
  for (const flour of [flourText, flourParsed]) {
    assert.equal(lineStockQty(flour, { quantity: 500, unit: 'g' }), 0.5);
    assert.equal(lineStockQty(flour, { quantity: 2, unit: 'kg' }), 2, 'the stock unit itself passes through');
    assert.equal(lineStockQty(flour, { quantity: 7 }), 7, 'no unit on the line means stock units');
    assert.equal(lineStockQty(flour, { quantity: 500, unit: 'oz' }), 500, 'an unknown unit passes through, never invented');
  }
  // Legacy behaviour unchanged: a product with NO conversions
  // recorded treats every line as stock units, whatever unit
  // the line names.
  const legacy = { id: 'flour', unit: 'kg', cost: 10 };
  assert.equal(lineStockQty(legacy, { quantity: 500, unit: 'g' }), 500);

  // Cost: one make using 500 g of a $10-per-kg product costs
  // 0.5 stock units × $10 = $5 (yield 1, yield_pct 100).
  const recipe = {
    id: 'r-bread',
    yield_qty: 1,
    q_factor_pct: 0,
    lines: [{ kind: 'product', product_id: 'flour', quantity: 500, unit: 'g', yield_pct: 100 }],
  };
  const products = new Map([[flourParsed.id, flourParsed]]);
  const recipes = new Map([[recipe.id, recipe]]);
  assert.ok(Math.abs(recipeCostPerMake(recipes, products, recipe) - 5) < 1e-9);
  // Expansion (what depletion takes off the shelf) agrees.
  const flat = expandRecipeToProducts(recipes, recipe, new Set(), products);
  assert.equal(flat.get('flour'), 0.5);
});

// ---------------------------------------------------------------------------
// Supplier invoices: the 3-way match.
// ---------------------------------------------------------------------------

async function orderedPo(k, lines, receipts, number) {
  const supplier = await createEntity(k.owner.cookie, 'Supplier', { business_id: k.bid, name: 'Farm Co' });
  assert.equal(supplier.status, 201, supplier.text);
  const po = await createEntity(k.owner.cookie, 'PurchaseOrder', {
    business_id: k.bid,
    number,
    supplier_id: supplier.json.id,
    supplier_name: 'Farm Co',
    status: 'draft',
    location_id: k.location.id,
    location_name: k.location.name,
    lines,
    total: lines.reduce((sum, l) => sum + l.qty_ordered * l.unit_cost, 0),
  });
  assert.equal(po.status, 201, po.text);
  const ordered = await req(`/api/businesses/${k.bid}/purchase-orders/${po.json.id}/order`, {
    method: 'POST',
    cookie: k.owner.cookie,
    body: {},
  });
  assert.equal(ordered.status, 200, ordered.text);
  const received = await req(`/api/businesses/${k.bid}/purchase-orders/${po.json.id}/receive`, {
    method: 'POST',
    cookie: k.owner.cookie,
    body: { location_id: k.location.id, receipts },
  });
  assert.equal(received.status, 200, received.text);
  return { supplier: supplier.json, po: po.json };
}

test('invoice 3-way match: every flag, and the overall reads differences', async () => {
  const k = await kitchen('match');
  const [a, b, c, d, e, f] = await createProducts(k.owner.cookie, k.bid, [
    { name: 'Match A', sku: 'M-A', price: 2, cost: 0 },
    { name: 'Match B', sku: 'M-B', price: 2, cost: 0 },
    { name: 'Match C', sku: 'M-C', price: 2, cost: 0 },
    { name: 'Match D', sku: 'M-D', price: 2, cost: 0 },
    { name: 'Match E', sku: 'M-E', price: 2, cost: 0 },
    { name: 'Match F', sku: 'M-F', price: 2, cost: 1 },
  ]);
  const line = (p, qty, cost) => ({
    product_id: p.id, product_name: p.name, sku: p.sku, qty_ordered: qty, qty_received: 0, unit_cost: cost,
  });
  const { supplier, po } = await orderedPo(
    k,
    [line(a, 10, 1), line(b, 10, 2), line(c, 10, 3), line(d, 7, 4), line(e, 5, 5)],
    [10, 8, 4, 7, 5],
    'PO-361-MATCH',
  );

  const invoice = await createEntity(k.owner.cookie, 'SupplierInvoice', {
    business_id: k.bid,
    supplier_id: supplier.id,
    supplier_name: 'Farm Co',
    purchase_order_id: po.id,
    po_number: 'PO-361-MATCH',
    invoice_number: 'INV-1',
    lines: [
      { product_id: a.id, product_name: 'Match A', quantity: 10, unit_cost: 1 },
      { product_id: b.id, product_name: 'Match B', quantity: 5, unit_cost: 2 },
      { product_id: c.id, product_name: 'Match C', quantity: 6, unit_cost: 3 },
      { product_id: e.id, product_name: 'Match E', quantity: 5, unit_cost: 6 },
      { product_id: f.id, product_name: 'Match F', quantity: 2, unit_cost: 9 },
    ],
    total: 10 * 1 + 5 * 2 + 6 * 3 + 5 * 6 + 2 * 9,
  });
  assert.equal(invoice.status, 201, invoice.text);

  const read = await req(`/api/entities/SupplierInvoice/${invoice.json.id}`, { cookie: k.owner.cookie });
  assert.equal(read.status, 200, read.text);
  assert.ok(read.json.match, 'the read carries the computed match');
  assert.equal(read.json.match.overall, 'differences');
  const flags = new Map(read.json.match.lines.map((l) => [l.product_id, l.flag]));
  assert.equal(flags.get(a.id), 'ok');
  assert.equal(flags.get(b.id), 'short', 'billed 5 against 8 received');
  assert.equal(flags.get(c.id), 'over', 'billed 6 against 4 received');
  assert.equal(flags.get(e.id), 'price_diff', 'billed at 6 against the PO\u2019s 5');
  assert.equal(flags.get(f.id), 'not_ordered', 'never on the PO at all');
  assert.equal(flags.get(d.id), 'not_invoiced', 'on the PO, never billed');
  const bLine = read.json.match.lines.find((l) => l.product_id === b.id);
  assert.equal(bLine.ordered, 10);
  assert.equal(bLine.received, 8);
  assert.equal(bLine.invoiced, 5);
});

test('invoice match: a fully agreeing invoice reads matched; no PO reads match null', async () => {
  const k = await kitchen('matchok');
  const [solo] = await createProducts(k.owner.cookie, k.bid, [
    { name: 'Solo', sku: 'M-SOLO', price: 2, cost: 0 },
  ]);
  const { supplier, po } = await orderedPo(
    k,
    [{ product_id: solo.id, product_name: 'Solo', sku: 'M-SOLO', qty_ordered: 3, qty_received: 0, unit_cost: 2 }],
    [3],
    'PO-361-OK',
  );
  const agree = await createEntity(k.owner.cookie, 'SupplierInvoice', {
    business_id: k.bid,
    supplier_id: supplier.id,
    supplier_name: 'Farm Co',
    purchase_order_id: po.id,
    po_number: 'PO-361-OK',
    invoice_number: 'INV-OK',
    lines: [{ product_id: solo.id, product_name: 'Solo', quantity: 3, unit_cost: 2 }],
    total: 6,
  });
  assert.equal(agree.status, 201, agree.text);
  assert.equal(agree.json.match?.overall, 'matched');

  const noPo = await createEntity(k.owner.cookie, 'SupplierInvoice', {
    business_id: k.bid,
    supplier_name: 'Farm Co',
    invoice_number: 'INV-FREE',
    lines: [{ product_id: solo.id, product_name: 'Solo', quantity: 1, unit_cost: 2 }],
    total: 2,
  });
  assert.equal(noPo.status, 201, noPo.text);
  assert.equal(noPo.json.match, null, 'no PO, no invented comparison');
});

// ---------------------------------------------------------------------------
// Vendor price alerts.
// ---------------------------------------------------------------------------

test('price alerts: an invoice opens one alert per differing product; accept reprices, dismiss does not', async () => {
  const k = await kitchen('alerts');
  const [p, q] = await createProducts(k.owner.cookie, k.bid, [
    { name: 'Alert P', sku: 'AL-P', price: 3, cost: 0.5 },
    { name: 'Alert Q', sku: 'AL-Q', price: 3, cost: 1 },
  ]);
  const invoice = await createEntity(k.owner.cookie, 'SupplierInvoice', {
    business_id: k.bid,
    supplier_name: 'Farm Co',
    invoice_number: 'INV-ALERT',
    lines: [{ product_id: p.id, product_name: 'Alert P', quantity: 4, unit_cost: 0.75 }],
    total: 3,
  });
  assert.equal(invoice.status, 201, invoice.text);

  const open1 = await queryEntity(k.owner.cookie, 'VendorPriceAlert', { business_id: k.bid });
  const pAlerts = open1.json.items.filter((a) => a.product_id === p.id && a.status === 'open');
  assert.equal(pAlerts.length, 1, 'one open alert for the differing line');
  assert.equal(Number(pAlerts[0].old_cost), 0.5);
  assert.equal(Number(pAlerts[0].new_cost), 0.75);
  assert.equal(pAlerts[0].invoice_id, invoice.json.id);

  // Re-saving the invoice must not stack a second copy.
  const resave = await req(`/api/entities/SupplierInvoice/${invoice.json.id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: { note: 'checked' },
  });
  assert.equal(resave.status, 200, resave.text);
  const open2 = await queryEntity(k.owner.cookie, 'VendorPriceAlert', { business_id: k.bid });
  assert.equal(
    open2.json.items.filter((a) => a.product_id === p.id && a.status === 'open').length,
    1,
    'still exactly one open alert',
  );

  // Accept: the product takes the billed cost.
  const accept = await req(`/api/entities/VendorPriceAlert/${pAlerts[0].id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: { status: 'accepted' },
  });
  assert.equal(accept.status, 200, accept.text);
  const pNow = await req(`/api/entities/Product/${p.id}`, { cookie: k.owner.cookie });
  assert.equal(Number(pNow.json.cost), 0.75);

  // Dismiss: the product keeps its cost.
  const invoice2 = await createEntity(k.owner.cookie, 'SupplierInvoice', {
    business_id: k.bid,
    supplier_name: 'Farm Co',
    invoice_number: 'INV-ALERT-2',
    lines: [{ product_id: q.id, product_name: 'Alert Q', quantity: 2, unit_cost: 2 }],
    total: 4,
  });
  assert.equal(invoice2.status, 201, invoice2.text);
  const open3 = await queryEntity(k.owner.cookie, 'VendorPriceAlert', { business_id: k.bid });
  const qAlert = open3.json.items.find((a) => a.product_id === q.id && a.status === 'open');
  assert.ok(qAlert, 'the second invoice opened its alert');
  const dismiss = await req(`/api/entities/VendorPriceAlert/${qAlert.id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: { status: 'dismissed' },
  });
  assert.equal(dismiss.status, 200, dismiss.text);
  const qNow = await req(`/api/entities/Product/${q.id}`, { cookie: k.owner.cookie });
  assert.equal(Number(qNow.json.cost), 1, 'a dismissed alert changes nothing');
});

// ---------------------------------------------------------------------------
// Waste: the row, its money shaping, and the implemented
// stock behaviour (see the header note).
// ---------------------------------------------------------------------------

test('waste: money is shaped to money holders; the entry itself is the record', async () => {
  const k = await kitchen('waste');
  const staff = await member(k.owner, 'waster');

  const entry = await createEntity(k.owner.cookie, 'WasteEntry', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    sku: 'SKU-TOM',
    location_id: k.location.id,
    location_name: k.location.name,
    quantity: 3,
    reason: 'spoilage',
    unit_cost: 0.5,
  });
  assert.equal(entry.status, 201, entry.text);
  assert.equal(Number(entry.json.unit_cost), 0.5, 'the owner sees the snapshot they sent');
  assert.equal(entry.json.total_cost, 1.5, 'the owner sees qty × unit cost');

  const staffList = await queryEntity(staff.cookie, 'WasteEntry', { business_id: k.bid });
  const staffRow = staffList.json.items.find((r) => r.id === entry.json.id);
  assert.ok(staffRow, 'the entry itself is visible to the team');
  assert.ok(!('unit_cost' in staffRow), 'no unit_cost key for an unticked reader');
  assert.ok(!('total_cost' in staffRow), 'no total_cost key for an unticked reader');

  await grantTicks(k.owner, staff.memberId, ['restaurant.money']);
  const moneyList = await queryEntity(staff.cookie, 'WasteEntry', { business_id: k.bid });
  const moneyRow = moneyList.json.items.find((r) => r.id === entry.json.id);
  assert.equal(moneyRow.total_cost, 1.5, 'the money tick reveals the total');

  // The waste leaves the shelf: one write_off movement,
  // reference = the entry, and the shelf drops by the
  // logged quantity (integration fix, Nov 23, 2026 — the
  // design's behaviour, restored after the tests child's
  // divergence note).
  const writeOffs = await movements(k.bid, k.tomato.id, 'write_off');
  assert.equal(writeOffs.length, 1);
  assert.equal(writeOffs[0].reference, entry.json.id);
  assert.equal(entry.json.movement_id, writeOffs[0].id);
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 97);

  // An entry sent without a cost snapshots the product's
  // current cost on the server, whoever logged it.
  const bare = await createEntity(staff.cookie, 'WasteEntry', {
    business_id: k.bid,
    product_id: k.tomato.id,
    location_id: k.location.id,
    quantity: 2,
    reason: 'dropped',
  });
  assert.equal(bare.status, 201, bare.text);
  assert.equal(Number(bare.json.unit_cost), 0.5, 'the server snapshots the product cost');
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 95);
});

// ---------------------------------------------------------------------------
// Staff meals.
// ---------------------------------------------------------------------------

test('staff meal of a dish: a staff_meal movement, and the recipe depletes cause-keyed to it', async () => {
  const k = await kitchen('meal');
  const meal = await createEntity(k.owner.cookie, 'StaffMeal', {
    business_id: k.bid,
    product_id: k.dish.id,
    product_name: 'Pasta Dish',
    quantity: 2,
    location_id: k.location.id,
    location_name: k.location.name,
  });
  assert.equal(meal.status, 201, meal.text);
  assert.ok(meal.json.movement_id, 'the meal names its stock-out movement');
  assert.equal(meal.json.recipe_id, k.dishRecipe.id, 'the dish\u2019s active recipe is recorded');

  assert.equal(await onHand(k.bid, k.dish.id, k.location.id), 8);
  const outs = await movements(k.bid, k.dish.id, 'staff_meal');
  assert.equal(outs.length, 1);
  assert.equal(outs[0].id, meal.json.movement_id);
  assert.equal(Number(outs[0].quantity), 2);
  assert.equal(outs[0].reference, meal.json.id);

  // Two dishes: 3 pasta each in stock units, and 500 g of
  // flour each — half a stock unit (kg) per dish.
  assert.equal(await onHand(k.bid, k.pasta.id, k.location.id), 34);
  assert.equal(await onHand(k.bid, k.flour.id, k.location.id), 9);
  const pastaConsume = await movements(k.bid, k.pasta.id, 'consume');
  assert.equal(pastaConsume.length, 1);
  assert.equal(pastaConsume[0].cause_movement_id, meal.json.movement_id);
  const flourConsume = await movements(k.bid, k.flour.id, 'consume');
  assert.equal(flourConsume.length, 1);
  assert.equal(Number(flourConsume[0].quantity), 1, 'two 500 g lines deplete one kg stock unit');
  assert.equal(flourConsume[0].cause_movement_id, meal.json.movement_id);
});

test('staff meal of a plain product is just the movement; a zero-stock dish records with movement_id null', async () => {
  const k = await kitchen('mealzero');
  const [sandwich, emptyDish] = await createProducts(k.owner.cookie, k.bid, [
    { name: 'Staff Sandwich', sku: 'SKU-SAN', price: 5, cost: 2 },
    { name: 'Empty Dish', sku: 'SKU-EMPTY', price: 9, cost: 0 },
  ]);
  await receive(k.owner.cookie, k.bid, sandwich.id, k.location.id, 5);
  const emptyRecipe = await createEntity(k.owner.cookie, 'Recipe', {
    business_id: k.bid,
    name: 'Empty Dish Recipe',
    status: 'active',
    product_id: emptyDish.id,
    product_name: 'Empty Dish',
    yield_qty: 1,
    lines: [
      { kind: 'product', product_id: k.tomato.id, product_name: 'Tomato', sku: 'SKU-TOM', unit: 'each', quantity: 2, yield_pct: 100 },
    ],
  });
  assert.equal(emptyRecipe.status, 201, emptyRecipe.text);

  const plain = await createEntity(k.owner.cookie, 'StaffMeal', {
    business_id: k.bid,
    product_id: sandwich.id,
    product_name: 'Staff Sandwich',
    quantity: 2,
    location_id: k.location.id,
    location_name: k.location.name,
  });
  assert.equal(plain.status, 201, plain.text);
  assert.ok(plain.json.movement_id);
  assert.equal(plain.json.recipe_id, null, 'no recipe behind a plain product');
  assert.equal(await onHand(k.bid, sandwich.id, k.location.id), 3);
  assert.equal((await movements(k.bid, sandwich.id, 'staff_meal')).length, 1);

  // The dish was never stocked: the meal still records, the
  // movement is honestly absent, and nothing depletes.
  const zero = await createEntity(k.owner.cookie, 'StaffMeal', {
    business_id: k.bid,
    product_id: emptyDish.id,
    product_name: 'Empty Dish',
    quantity: 1,
    location_id: k.location.id,
    location_name: k.location.name,
  });
  assert.equal(zero.status, 201, zero.text);
  assert.equal(zero.json.movement_id, null);
  assert.equal((await movements(k.bid, emptyDish.id, 'staff_meal')).length, 0);
  assert.equal((await movements(k.bid, k.tomato.id, 'consume')).length, 0, 'nothing depleted for a meal that took nothing');
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 100);
});

// ---------------------------------------------------------------------------
// Batch runs.
// ---------------------------------------------------------------------------

test('batch run: produce lands at yield × makes, the full expansion is consumed cause-keyed, archived is skipped', async () => {
  const k = await kitchen('batch');
  const [basil, prep] = await createProducts(k.owner.cookie, k.bid, [
    { name: 'Basil', sku: 'SKU-BAS', price: 1, cost: 0.2 },
    { name: 'Sauce Base', sku: 'SKU-PREP', price: 6, cost: 0 },
  ]);
  await receive(k.owner.cookie, k.bid, basil.id, k.location.id, 50);
  const sauce = await createEntity(k.owner.cookie, 'Recipe', {
    business_id: k.bid,
    name: 'Batch Sauce',
    status: 'active',
    product_id: prep.id,
    product_name: 'Sauce Base',
    yield_qty: 2,
    lines: [
      { kind: 'product', product_id: k.tomato.id, product_name: 'Tomato', sku: 'SKU-TOM', unit: 'each', quantity: 4, yield_pct: 100 },
      { kind: 'product', product_id: basil.id, product_name: 'Basil', sku: 'SKU-BAS', unit: 'each', quantity: 1, yield_pct: 100 },
    ],
  });
  assert.equal(sauce.status, 201, sauce.text);
  // Freeze the basil: the run must skip it whole.
  await req(`/api/entities/Product/${basil.id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: { status: 'archived' },
  });

  const run = await createEntity(k.owner.cookie, 'BatchRun', {
    business_id: k.bid,
    recipe_id: sauce.json.id,
    recipe_name: 'Batch Sauce',
    makes: 3,
    location_id: k.location.id,
    location_name: k.location.name,
  });
  assert.equal(run.status, 201, run.text);
  assert.equal(Number(run.json.output_qty), 6, 'yield 2 × 3 makes');
  assert.ok(run.json.produce_movement_id);
  assert.equal(run.json.product_id, prep.id);
  assert.deepEqual(
    run.json.lines,
    [{ product_id: k.tomato.id, product_name: 'Tomato', quantity: 12 }],
    'the consumed snapshot names only what was actually consumed',
  );

  assert.equal(await onHand(k.bid, prep.id, k.location.id), 6, 'the prep product landed');
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 88, '4 per make × 3 makes');
  assert.equal(await onHand(k.bid, basil.id, k.location.id), 50, 'the archived ingredient was not touched');
  const produced = await movements(k.bid, prep.id, 'produce');
  assert.equal(produced.length, 1);
  assert.equal(produced[0].id, run.json.produce_movement_id);
  assert.equal(Number(produced[0].quantity), 6);
  const consumed = await movements(k.bid, k.tomato.id, 'consume');
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].cause_movement_id, run.json.produce_movement_id);
  assert.equal((await movements(k.bid, basil.id, 'consume')).length, 0);
});

test('batch run on a recipe without a linked prep product is refused', async () => {
  const k = await kitchen('batchnoproduct');
  const loose = await createEntity(k.owner.cookie, 'Recipe', {
    business_id: k.bid,
    name: 'Loose Sauce',
    status: 'active',
    yield_qty: 1,
    lines: [
      { kind: 'product', product_id: k.tomato.id, product_name: 'Tomato', sku: 'SKU-TOM', unit: 'each', quantity: 1, yield_pct: 100 },
    ],
  });
  assert.equal(loose.status, 201, loose.text);
  const run = await createEntity(k.owner.cookie, 'BatchRun', {
    business_id: k.bid,
    recipe_id: loose.json.id,
    recipe_name: 'Loose Sauce',
    makes: 1,
    location_id: k.location.id,
    location_name: k.location.name,
  });
  assert.equal(run.status, 400, run.text);
  assert.equal(run.json.error, 'batch_needs_product');
  // The registry carries the wording for the client door.
  assert.equal(en['apiErrors.batchNeedsProduct'], 'A batch run needs a recipe with a linked prep product.');
});

// ---------------------------------------------------------------------------
// Temp logs, the 86 board, stock batches.
// ---------------------------------------------------------------------------

test('temp logs and the 86 board: any member logs; clearing flips active', async () => {
  const k = await kitchen('daily');
  const staff = await member(k.owner, 'logger');

  const log = await createEntity(staff.cookie, 'TempLog', {
    business_id: k.bid,
    unit_name: 'Walk-in fridge',
    location_id: k.location.id,
    location_name: k.location.name,
    temperature: 38,
    scale: 'F',
    in_range: true,
  });
  assert.equal(log.status, 201, log.text);
  const logs = await queryEntity(staff.cookie, 'TempLog', { business_id: k.bid });
  assert.ok(logs.json.items.some((r) => r.id === log.json.id && Number(r.temperature) === 38));

  const item = await createEntity(staff.cookie, 'EightySixItem', {
    business_id: k.bid,
    product_id: k.dish.id,
    product_name: 'Pasta Dish',
    location_id: k.location.id,
    location_name: k.location.name,
    note: 'Out of pasta',
  });
  assert.equal(item.status, 201, item.text);
  assert.equal(item.json.active, true);
  const cleared = await req(`/api/entities/EightySixItem/${item.json.id}`, {
    method: 'PATCH',
    cookie: staff.cookie,
    body: { active: false },
  });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(cleared.json.active, false);
  // Clearing stamps who + when, server-side, on the flip
  // (integration fix, Nov 23, 2026 — the design's behaviour,
  // restored after the tests child's divergence note).
  assert.ok(cleared.json.cleared_at, 'the clear stamps cleared_at');
  assert.ok(
    typeof cleared.json.cleared_by === 'string' && cleared.json.cleared_by.length > 0,
    'the clear stamps cleared_by with the actor name',
  );
  const board = await queryEntity(staff.cookie, 'EightySixItem', { business_id: k.bid });
  const boardRow = board.json.items.find((r) => r.id === item.json.id);
  assert.equal(boardRow.active, false);
  assert.ok(boardRow.cleared_at, 'the stamps ride the board read too');
});

test('stock batches: plain CRUD on Business (FEFO ordering itself is client-side)', async () => {
  const k = await kitchen('batches');
  const batch = await createEntity(k.owner.cookie, 'StockBatch', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    sku: 'SKU-TOM',
    location_id: k.location.id,
    location_name: k.location.name,
    quantity: 12,
    expires_on: '2026-12-01',
    note: 'Case 1',
  });
  assert.equal(batch.status, 201, batch.text);
  assert.equal(Number(batch.json.quantity), 12);
  const list = await queryEntity(k.owner.cookie, 'StockBatch', { business_id: k.bid });
  assert.ok(list.json.items.some((r) => r.id === batch.json.id));
  const one = await req(`/api/entities/StockBatch/${batch.json.id}`, { cookie: k.owner.cookie });
  assert.equal(one.status, 200);
  assert.equal(String(one.json.expires_on).slice(0, 10), '2026-12-01');
});

// ---------------------------------------------------------------------------
// Gates: the fork, and Essentials invisibility.
// ---------------------------------------------------------------------------

test('tick gates: building doors refuse an unticked member; the daily log never does', async () => {
  const k = await kitchen('gates');
  const staff = await member(k.owner, 'gated');

  const invoiceBody = {
    business_id: k.bid,
    supplier_name: 'Farm Co',
    invoice_number: 'INV-GATE',
    lines: [{ product_id: k.tomato.id, product_name: 'Tomato', quantity: 1, unit_cost: 0.5 }],
    total: 0.5,
  };
  const invoice = await createEntity(staff.cookie, 'SupplierInvoice', invoiceBody);
  assert.equal(invoice.status, 403, invoice.text);
  const batch = await createEntity(staff.cookie, 'StockBatch', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    quantity: 5,
  });
  assert.equal(batch.status, 403, batch.text);
  const run = await createEntity(staff.cookie, 'BatchRun', {
    business_id: k.bid,
    recipe_id: k.dishRecipe.id,
    recipe_name: 'Pasta al Pomodoro',
    makes: 1,
    location_id: k.location.id,
    location_name: k.location.name,
  });
  assert.equal(run.status, 403, run.text);

  // The daily-log fork: none of these need a tick.
  const waste = await createEntity(staff.cookie, 'WasteEntry', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    quantity: 1,
    reason: 'spillage',
  });
  assert.equal(waste.status, 201, waste.text);
  const temp = await createEntity(staff.cookie, 'TempLog', {
    business_id: k.bid,
    unit_name: 'Line fridge',
    temperature: 40,
    scale: 'F',
    in_range: true,
  });
  assert.equal(temp.status, 201, temp.text);
  const eightySix = await createEntity(staff.cookie, 'EightySixItem', {
    business_id: k.bid,
    product_id: k.dish.id,
    product_name: 'Pasta Dish',
  });
  assert.equal(eightySix.status, 201, eightySix.text);
  const meal = await createEntity(staff.cookie, 'StaffMeal', {
    business_id: k.bid,
    product_id: k.dish.id,
    product_name: 'Pasta Dish',
    quantity: 1,
    location_id: k.location.id,
    location_name: k.location.name,
  });
  assert.equal(meal.status, 201, meal.text);

  await grantTicks(k.owner, staff.memberId, ['restaurant.build']);
  const invoiceOk = await createEntity(staff.cookie, 'SupplierInvoice', invoiceBody);
  assert.equal(invoiceOk.status, 201, invoiceOk.text);
  const batchOk = await createEntity(staff.cookie, 'StockBatch', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    quantity: 5,
  });
  assert.equal(batchOk.status, 201, batchOk.text);
  const runOk = await createEntity(staff.cookie, 'BatchRun', {
    business_id: k.bid,
    recipe_id: k.dishRecipe.id,
    recipe_name: 'Pasta al Pomodoro',
    makes: 1,
    location_id: k.location.id,
    location_name: k.location.name,
  });
  assert.equal(runOk.status, 201, runOk.text);
});

const OPS_ENTITIES = [
  'StockBatch',
  'WasteEntry',
  'TempLog',
  'EightySixItem',
  'SupplierInvoice',
  'VendorPriceAlert',
  'BatchRun',
  'StaffMeal',
];
const OPS_TABLES = {
  StockBatch: 'stock_batches',
  WasteEntry: 'waste_entries',
  TempLog: 'temp_logs',
  EightySixItem: 'eighty_six_items',
  SupplierInvoice: 'supplier_invoices',
  VendorPriceAlert: 'vendor_price_alerts',
  BatchRun: 'batch_runs',
  StaffMeal: 'staff_meals',
};

test('Essentials: all eight ops entities are invisible — writes refused, lists empty, single reads refuse', async () => {
  const owner = await ownerWithBusiness(email('essops'), 'Essentials Shop', { plan: 'essentials' });
  const bid = owner.business.id;
  const [prod] = await createProducts(owner.cookie, bid, [{ name: 'Soup', sku: 'SKU-SOUP', price: 5, cost: 1 }]);
  const bodies = {
    StockBatch: { product_id: prod.id, product_name: 'Soup', quantity: 5 },
    WasteEntry: { product_id: prod.id, product_name: 'Soup', quantity: 1, reason: 'other' },
    TempLog: { unit_name: 'Fridge', temperature: 4, scale: 'C', in_range: true },
    EightySixItem: { product_id: prod.id, product_name: 'Soup' },
    SupplierInvoice: { supplier_name: 'Farm Co', lines: [], total: 0 },
    VendorPriceAlert: { product_id: prod.id, product_name: 'Soup', old_cost: 1, new_cost: 2 },
    BatchRun: { recipe_id: 'no-such-recipe', makes: 1 },
    StaffMeal: { product_id: prod.id, product_name: 'Soup', quantity: 1 },
  };
  for (const name of OPS_ENTITIES) {
    const write = await createEntity(owner.cookie, name, { business_id: bid, ...bodies[name] });
    assert.notEqual(write.status, 201, `${name} write on Essentials: ${write.text}`);
    const list = await queryEntity(owner.cookie, name, { business_id: bid });
    assert.equal(list.status, 200, `${name} list`);
    assert.equal((list.json.items || []).length, 0, `${name} shows nothing on Essentials`);
  }
  // Even a row planted straight in the table stays invisible:
  // lists skip the entity and single reads refuse plan_gated.
  for (const name of OPS_ENTITIES) {
    const id = `ess-planted-${name}`;
    await pool.query(`INSERT INTO ${OPS_TABLES[name]} (id, business_id) VALUES ($1, $2)`, [id, bid]);
    const list = await queryEntity(owner.cookie, name, { business_id: bid });
    assert.equal((list.json.items || []).length, 0, `${name} planted row never lists on Essentials`);
    const one = await req(`/api/entities/${name}/${id}`, { cookie: owner.cookie });
    assert.equal(one.status, 403, `${name} single read on Essentials`);
    assert.equal(one.json.error, 'plan_gated');
  }
});

// ---------------------------------------------------------------------------
// Presentation: plans, nav, training, client wiring, movements.
// ---------------------------------------------------------------------------

test('plan presentation: the six shelf lines carry the corner on Business includes + comparison only', () => {
  // Release 377 regrouped the plan pages: the restaurantOps /
  // restaurantDaily lines were replaced by the six shelf lines
  // (Kitchen, Stock, Money, Safety, Floor, Team) in PLANS, on the
  // Welcome cards and in the comparison table. The old keys stay in
  // the dictionaries and in FEATURES (gate labels / training
  // scoping), but no plan page prints them any more.
  const shelfLines = [
    en['plansLib.businessIncludes.restaurantKitchen'],
    en['plansLib.businessIncludes.restaurantStock'],
    en['plansLib.businessIncludes.restaurantMoney'],
    en['plansLib.businessIncludes.restaurantSafety'],
    en['plansLib.businessIncludes.restaurantFloor'],
    en['plansLib.businessIncludes.restaurantTeam'],
  ];
  for (const line of shelfLines) {
    assert.ok(line, 'the shelf plan line exists in English');
    assert.ok(PLANS.business.includes.includes(line), 'PLANS business includes carries the line');
    assert.ok(!PLANS.essentials.includes.includes(line), 'Essentials includes never carries it');
    const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
    assert.ok(welcomeBusiness.includes.includes(line), 'the Welcome card carries the line');
    const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
    assert.ok(!welcomeEssentials.includes.includes(line), 'Welcome Essentials gains nothing');
    const row = COMPARISON_ROWS.find((r) => r.label === line);
    assert.ok(row, 'the comparison table has the row');
    assert.equal(row.business, true);
    assert.equal(row.essentials, false);
  }
  const opsLine = en['plansLib.businessIncludes.restaurantOps'];
  const dailyLine = en['plansLib.businessIncludes.restaurantDaily'];
  for (const line of [opsLine, dailyLine]) {
    assert.ok(!PLANS.business.includes.includes(line), 'the superseded line leaves the plan pages');
    assert.ok(!COMPARISON_ROWS.some((r) => r.label === line), 'the superseded line leaves the comparison table');
  }
  assert.equal(FEATURES.restaurantOps, opsLine, 'the FEATURES label stays for gate/training use');
  assert.equal(FEATURES.restaurantDaily, dailyLine, 'the FEATURES label stays for gate/training use');
});

test('nav: the restaurant group is one door — the Today page (Release 377 anti-clutter)', () => {
  const group = NAV_GROUPS.find((g) => g.labelKey === 'nav.group.restaurant');
  assert.ok(group, 'the Restaurant group exists');
  assert.deepEqual(group.items.map((i) => i.to), ['/restaurant']);
  assert.ok(group.items.every((i) => i.feature === 'restaurant'));
});

test('training: catalog 115, the four ops lessons scoped and in agreement', () => {
  assert.equal(CLIENT_LESSONS.length, 115);
  assert.equal(SERVER_LESSONS.length, 115);
  const expected = {
    'owner-restaurant-ops': { track: 'owner', steps: 5 },
    'staff-restaurant-daily': { track: 'staff', steps: 4 },
    'mgr-restaurant-invoices': { track: 'manager', steps: 4 },
    'mgr-restaurant-reports': { track: 'manager', steps: 4 },
  };
  for (const [id, want] of Object.entries(expected)) {
    const server = SERVER_LESSONS.find((l) => l.id === id);
    const client = CLIENT_LESSONS.find((l) => l.id === id);
    assert.ok(server && client, `${id} exists in both catalogs`);
    assert.deepEqual(
      { track: server.track, module: server.module, steps: server.steps, feature: server.feature },
      { track: client.track, module: client.module, steps: client.steps, feature: client.feature },
      `${id} agrees across catalogs`,
    );
    assert.equal(server.track, want.track, `${id} track`);
    assert.equal(server.steps, want.steps, `${id} steps`);
    assert.equal(server.module, 'restaurant');
    assert.equal(server.feature, 'restaurant');
    assert.equal(lessonVisibleOnPlan(server, false), false, `${id} is invisible on Essentials`);
    assert.equal(lessonVisibleOnPlan(server, true), true);
    assert.ok(en[`training.lessons.${id}.title`], `${id} has a title`);
    for (let s = 1; s <= server.steps; s += 1) {
      assert.ok(en[`training.lessons.${id}.step${s}`], `${id} step ${s} has words`);
    }
  }
  assert.deepEqual(LESSON_REQUIREMENTS['mgr-restaurant-invoices'], ['restaurant.build']);
  assert.deepEqual(LESSON_REQUIREMENTS['mgr-restaurant-reports'], ['restaurant.money']);
  assert.equal(LESSON_REQUIREMENTS['owner-restaurant-ops'], undefined, 'the owner lesson needs no tick');
  assert.equal(LESSON_REQUIREMENTS['staff-restaurant-daily'], undefined, 'the daily-habits lesson needs no tick');
});

test('client wiring: all eight ops entities are registered entity clients', () => {
  const client = fs.readFileSync(new URL('../../src/api/client.js', import.meta.url), 'utf8');
  const namesBlock = client.slice(client.indexOf('const ENTITY_NAMES = ['));
  const names = namesBlock.slice(0, namesBlock.indexOf('];'));
  for (const name of OPS_ENTITIES) {
    assert.ok(names.includes(`'${name}'`), `${name} is a registered client entity`);
  }
});

test('movement types: server and client mirrors agree, staff_meal is an irreversible out', () => {
  const client = fs.readFileSync(new URL('../../src/lib/inventory.js', import.meta.url), 'utf8');
  const block = client.slice(client.indexOf('export const MOVEMENT_TYPES = {'));
  const blockText = block.slice(0, block.indexOf('\n};'));
  const clientKeys = [...blockText.matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1]);
  assert.deepEqual([...clientKeys].sort(), Object.keys(SERVER_MOVEMENT_TYPES).sort(), 'the mirrors carry the same types');
  assert.equal(SERVER_MOVEMENT_TYPES.staff_meal.label, 'Staff meal');
  assert.equal(SERVER_MOVEMENT_TYPES.staff_meal.direction, 'out');
  const staffMealBlock = blockText.slice(blockText.indexOf('staff_meal:'));
  assert.match(staffMealBlock.slice(0, 200), /direction: 'out'/);
  // Like consume/produce, a staff meal is never reversed —
  // neither mirror's reversible list names it.
  const server = fs.readFileSync(new URL('../../server/movements.js', import.meta.url), 'utf8');
  const serverReversible = server.slice(server.indexOf('const REVERSIBLE_TYPES = ['));
  assert.ok(!serverReversible.slice(0, serverReversible.indexOf('];')).includes('staff_meal'));
  const clientReversible = client.slice(client.indexOf('const REVERSIBLE_TYPES = ['));
  assert.ok(!clientReversible.slice(0, clientReversible.indexOf('];')).includes('staff_meal'));
});

// ---------------------------------------------------------------------------
// The accounting export dataset.
// ---------------------------------------------------------------------------

test('export dataset restaurantLedger: seven columns, four sections, fixture values', async () => {
  const k = await kitchen('ledger');
  const [sandwich] = await createProducts(k.owner.cookie, k.bid, [
    { name: 'Staff Sandwich', sku: 'SKU-SAN', price: 5, cost: 2 },
  ]);
  await receive(k.owner.cookie, k.bid, sandwich.id, k.location.id, 5);

  // Purchases: a PO for tomatoes, 4 of 10 received at $0.50.
  await orderedPo(
    k,
    [{ product_id: k.tomato.id, product_name: 'Tomato', sku: 'SKU-TOM', qty_ordered: 10, qty_received: 0, unit_cost: 0.5 }],
    [4],
    'PO-361-LEDGER',
  );
  // Waste: 3 tomatoes at the $0.50 snapshot.
  const waste = await createEntity(k.owner.cookie, 'WasteEntry', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    sku: 'SKU-TOM',
    location_id: k.location.id,
    location_name: k.location.name,
    quantity: 3,
    reason: 'spoilage',
    unit_cost: 0.5,
  });
  assert.equal(waste.status, 201, waste.text);
  // Staff meals: 2 plain sandwiches at their $2 product cost.
  const meal = await createEntity(k.owner.cookie, 'StaffMeal', {
    business_id: k.bid,
    product_id: sandwich.id,
    product_name: 'Staff Sandwich',
    quantity: 2,
    location_id: k.location.id,
    location_name: k.location.name,
  });
  assert.equal(meal.status, 201, meal.text);
  // Depletion: one dish sold through the server funnel.
  await withTx(pool, (client) =>
    recordMovementTx(client, {
      businessId: k.bid,
      product: k.dish,
      location: k.location,
      type: 'sale',
      quantity: 1,
      userName: 'Owner',
      planKey: 'business',
      caller: { id: k.owner.user.id },
    }),
  );

  const { EXPORTS } = await import('../../server/exportData.js');
  const built = await EXPORTS.restaurantLedger.build(pool, k.bid);
  assert.deepEqual(
    built.columns.map((c) => c.label),
    ['Section', 'Date', 'Item', 'Quantity', 'Unit cost', 'Total cost', 'Reference'],
  );
  const rows = built.rows.map((r) => Object.fromEntries(built.columns.map((c) => [c.label, c.value(r)])));
  const bySection = (section) => rows.filter((r) => r.Section === section);
  assert.deepEqual(
    [...new Set(rows.map((r) => r.Section))].sort(),
    ['Depletion', 'Purchases', 'Staff meals', 'Waste'],
  );
  const purchase = bySection('Purchases').find((r) => r.Item === 'Tomato');
  assert.ok(purchase, 'the received PO line is a Purchases row');
  assert.equal(purchase.Quantity, 4);
  assert.equal(purchase['Unit cost'], 0.5);
  assert.equal(purchase['Total cost'], 2);
  assert.equal(purchase.Reference, 'PO-361-LEDGER');

  const wasteRow = bySection('Waste').find((r) => r.Item === 'Tomato');
  assert.ok(wasteRow);
  assert.equal(wasteRow.Quantity, 3);
  assert.equal(wasteRow['Total cost'], 1.5);
  assert.equal(wasteRow.Reference, waste.json.id);

  const mealRow = bySection('Staff meals').find((r) => r.Item === 'Staff Sandwich');
  assert.ok(mealRow);
  assert.equal(mealRow.Quantity, 2);
  assert.equal(mealRow['Unit cost'], 2);
  assert.equal(mealRow['Total cost'], 4);
  assert.equal(mealRow.Reference, meal.json.id);

  const depletion = bySection('Depletion');
  assert.ok(depletion.length >= 2, 'the sale\u2019s consume rows are Depletion rows');
  const pastaRow = depletion.find((r) => r.Item === 'Pasta');
  assert.ok(pastaRow);
  assert.equal(pastaRow.Quantity, 3);
  assert.equal(pastaRow['Unit cost'], 1);
  assert.equal(pastaRow['Total cost'], 3);
  const flourRow = depletion.find((r) => r.Item === 'Flour');
  assert.ok(flourRow);
  assert.equal(flourRow.Quantity, 0.5, 'the converted line depletes in stock units here too');
});

// ---------------------------------------------------------------------------
// Harness finds (integration, Nov 23, 2026): two genuine bugs
// the real-browser probe caught after the unit suite passed.
// ---------------------------------------------------------------------------

test('harness find A: recipe money shaping converts line units (no ×1000 pricing)', async () => {
  const k = await kitchen('money-conversion');
  // The dish recipe: Pasta 3 × $1 + Flour 500 g at $10/kg
  // (0.5 stock units × $10 = $5) → cost per make $8 exactly.
  const list = await queryEntity(k.owner.cookie, 'Recipe', { business_id: k.bid });
  const dish = list.json.items.find((r) => r.id === k.dishRecipe.id);
  assert.ok(dish, 'the dish recipe reads back');
  assert.equal(dish.cost_per_make, 8, 'the converted flour line prices in stock units');
  assert.equal(dish.true_cost, 8, 'yield 1: true cost equals cost per make');
});

test('harness find B: a transfer’s out row names its destination', async () => {
  const k = await kitchen('transfer-destination');
  const second = await createEntity(k.owner.cookie, 'Location', {
    business_id: k.bid,
    name: 'Line',
    kind: 'store',
  });
  assert.equal(second.status, 201, second.text);
  const moved = await req(`/api/businesses/${k.bid}/movements`, {
    method: 'POST',
    cookie: k.owner.cookie,
    body: {
      product_id: k.tomato.id,
      location_id: k.location.id,
      type: 'transfer',
      quantity: 5,
      to_location_id: second.json.id,
      reference: 'transfer-test-b',
    },
  });
  assert.equal(moved.status, 201, moved.text);
  const { rows } = await pool.query(
    `SELECT type, to_location_id, to_location_name FROM stock_movements
      WHERE business_id = $1 AND reference = 'transfer-test-b' ORDER BY type`,
    [k.bid],
  );
  const out = rows.find((r) => r.type === 'transfer');
  assert.ok(out, 'the out row exists');
  assert.equal(out.to_location_id, second.json.id);
  assert.equal(out.to_location_name, 'Line', 'the document’s TO line has its place');
});
