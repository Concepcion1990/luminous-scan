// Release 359 (Nov 23, 2026): RESTAURANT CORNER, FOUNDATION.
//
// The owner's rulings pinned here:
//  - Business-only, invisible on Essentials (327 doctrine):
//    the Recipe/Par entities refuse and skip on Essentials.
//  - Automatic depletion, server-side at the stock-movement
//    layer: a sale of a dish product — through the POS funnel
//    (recordMovementTx, sold here via the CSV till door) or
//    through the client funnel (entity StockMovement writes) —
//    depletes the active recipe's ingredients proportionally,
//    sub-recipes rolled up; drafts never deplete; a reversed
//    sale restores; depletion is idempotent with its cause and
//    clamps at zero rather than blocking the sale or driving
//    stock negative; archived ingredients are skipped.
//  - True cost: yield divides cost (EP), never the shelf
//    quantity; sub-recipes roll up; the Q factor touches cost
//    only. Money is owner-only: unticked payloads carry no
//    cost figures at all.
//  - Three ticks (restaurant.build / .pars / .money) gate the
//    writes and the money; viewing is free.
//  - Validation: no self-ingredient, no circles, one active
//    recipe per dish, one par per product per place.
//  - The order guide math (client lib): par − on hand − on
//    order, rounded UP to pack size; the recipe upload parser
//    matches by SKU then name and names what it cannot match.
//  - Presentation: the corner's lines join the Business plan
//    (includes + comparison), the nav group exists behind the
//    restaurant feature, and the training catalog carries
//    five scoped restaurant lessons (102 → 107; 110 since cross-store messages;
//    114 since restaurant operations, whose four lessons t59 pins).
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
import { recordMovementTx, reverseMovementTx } from '../../server/movements.js';
import { recipeCostPerMake } from '../../server/recipes.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS, lessonVisibleOnPlan } from '../../server/trainingCatalog.js';
import { LESSON_REQUIREMENTS } from '../../server/trainingScope.js';
import { PLANS, COMPARISON_ROWS, FEATURES, WELCOME_OPTIONS } from '../../src/lib/plans.js';
import { NAV_GROUPS } from '../../src/components/layout/navGroups.js';
import { guideRows, parseRecipeUpload } from '../../src/lib/recipes.js';

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

/**
 * A Business kitchen: a location, three ingredients and a
 * sellable dish, all stocked. Sauce (sub-recipe, yield 2 per
 * make: 4 tomato + 1 basil) rolls into the pasta dish (3
 * pasta + 2 sauce per make, yield 1, sells at $12).
 */
async function kitchen(label) {
  const owner = await ownerWithBusiness(email(label), 'Kitchen', { plan: 'business' });
  const bid = owner.business.id;
  const location = await seededLocation(owner.cookie, bid);
  const [tomato, basil, pasta, dish] = await createProducts(owner.cookie, bid, [
    { name: 'Tomato', sku: 'SKU-TOM', price: 2, cost: 0.5 },
    { name: 'Basil', sku: 'SKU-BAS', price: 1, cost: 0.2 },
    { name: 'Pasta', sku: 'SKU-PAS', price: 3, cost: 1 },
    { name: 'Pasta Dish', sku: 'SKU-DISH', price: 12, cost: 0 },
  ]);
  await receive(owner.cookie, bid, tomato.id, location.id, 100);
  await receive(owner.cookie, bid, basil.id, location.id, 50);
  await receive(owner.cookie, bid, pasta.id, location.id, 40);
  await receive(owner.cookie, bid, dish.id, location.id, 10);

  const sauce = await createEntity(owner.cookie, 'Recipe', {
    business_id: bid,
    name: 'House Sauce',
    status: 'active',
    yield_qty: 2,
    lines: [
      { kind: 'product', product_id: tomato.id, product_name: 'Tomato', sku: 'SKU-TOM', unit: 'each', quantity: 4, yield_pct: 100 },
      { kind: 'product', product_id: basil.id, product_name: 'Basil', sku: 'SKU-BAS', unit: 'each', quantity: 1, yield_pct: 100 },
    ],
  });
  assert.equal(sauce.status, 201, sauce.text);
  const dishRecipe = await createEntity(owner.cookie, 'Recipe', {
    business_id: bid,
    name: 'Pasta al Pomodoro',
    status: 'active',
    product_id: dish.id,
    product_name: 'Pasta Dish',
    yield_qty: 1,
    lines: [
      { kind: 'product', product_id: pasta.id, product_name: 'Pasta', sku: 'SKU-PAS', unit: 'each', quantity: 3, yield_pct: 100 },
      { kind: 'recipe', recipe_id: sauce.json.id, recipe_name: 'House Sauce', quantity: 2 },
    ],
  });
  assert.equal(dishRecipe.status, 201, dishRecipe.text);
  return { owner, bid, location, tomato, basil, pasta, dish, sauce: sauce.json, dishRecipe: dishRecipe.json };
}

async function consumeRows(bid, productId) {
  const { rows } = await pool.query(
    `SELECT * FROM stock_movements WHERE business_id = $1 AND product_id = $2 AND type = 'consume' ORDER BY created_at`,
    [bid, productId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Depletion — the POS/server funnel (CSV till door → posCore →
// recordMovementTx), with the sub-recipe rolled up.
// ---------------------------------------------------------------------------

test('a till sale of the dish depletes its ingredients, sub-recipe rolled up', async () => {
  const k = await kitchen('posdeplete');
  const csv = [
    'sale_id,sold_at,sku_or_barcode,quantity,item_name,location',
    `EOD-1,2026-11-23 09:00,SKU-DISH,2,Pasta Dish,${k.location.name}`,
  ].join('\n');
  const res = await req(`/api/businesses/${k.bid}/pos/csv-import`, {
    method: 'POST',
    cookie: k.owner.cookie,
    body: { csv },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.imported, 1);

  assert.equal(await onHand(k.bid, k.dish.id, k.location.id), 8);
  // Per dish: 3 pasta; sauce 2 units = 1 make = 4 tomato + 1 basil. ×2 dishes:
  assert.equal(await onHand(k.bid, k.pasta.id, k.location.id), 34);
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 92);
  assert.equal(await onHand(k.bid, k.basil.id, k.location.id), 48);

  const tomatoConsume = await consumeRows(k.bid, k.tomato.id);
  assert.equal(tomatoConsume.length, 1, 'one consume row for the one sale line');
  assert.equal(Number(tomatoConsume[0].quantity), 8, 'both dishes’ tomatoes in the one row');
  assert.ok(tomatoConsume.every((row) => row.cause_movement_id), 'each consume names its cause');
  assert.ok(tomatoConsume.every((row) => row.note === 'Recipe: Pasta al Pomodoro'));

  // The same file again: the sale is a duplicate, and depletion
  // follows the sale — nothing moves twice.
  const again = await req(`/api/businesses/${k.bid}/pos/csv-import`, {
    method: 'POST',
    cookie: k.owner.cookie,
    body: { csv },
  });
  assert.equal(again.json.duplicates, 1);
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 92);
  assert.equal((await consumeRows(k.bid, k.tomato.id)).length, 1);
});

test('recordMovementTx depletes once per cause, and its reversal restores', async () => {
  const k = await kitchen('directfunnel');
  const sale = await withTx(pool, (client) =>
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
  assert.equal(await onHand(k.bid, k.pasta.id, k.location.id), 37);
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 96);

  // A retry carrying the same movement (a re-delivered webhook's
  // second pass through the funnel) must not deplete again: the
  // depletion is keyed to the cause movement.
  const { depleteForSaleTx } = await import('../../server/recipes.js');
  await withTx(pool, (client) =>
    depleteForSaleTx(client, {
      businessId: k.bid,
      saleMovement: sale.movement,
      product: k.dish,
      location: k.location,
      quantity: 1,
      userName: 'Owner',
      planKey: 'business',
      caller: { id: k.owner.user.id },
    }),
  );
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 96, 'no double depletion');

  await withTx(pool, (client) =>
    reverseMovementTx(client, {
      businessId: k.bid,
      movement: sale.movement,
      userName: 'Owner',
      caller: { id: k.owner.user.id },
    }),
  );
  assert.equal(await onHand(k.bid, k.dish.id, k.location.id), 10);
  assert.equal(await onHand(k.bid, k.pasta.id, k.location.id), 40);
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 100);
  assert.equal(await onHand(k.bid, k.basil.id, k.location.id), 50);
});

// ---------------------------------------------------------------------------
// Depletion — the client funnel (entity StockMovement writes:
// the in-app order ship door and the Movements page).
// ---------------------------------------------------------------------------

async function funnelSale(k, quantity) {
  const level = await queryEntity(k.owner.cookie, 'StockLevel', {
    business_id: k.bid,
    product_id: k.dish.id,
    location_id: k.location.id,
  });
  const row = level.json.items[0];
  await req(`/api/entities/StockLevel/${row.id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: { quantity: row.quantity - quantity },
  });
  const sale = await createEntity(k.owner.cookie, 'StockMovement', {
    business_id: k.bid,
    product_id: k.dish.id,
    product_name: 'Pasta Dish',
    sku: 'SKU-DISH',
    location_id: k.location.id,
    location_name: k.location.name,
    type: 'sale',
    quantity,
    previous_qty: row.quantity,
    new_qty: row.quantity - quantity,
    reference: 'ORD-TEST-1',
    user_name: 'Owner',
  });
  assert.equal(sale.status, 201, sale.text);
  return sale.json;
}

test('an in-app (entity funnel) sale depletes, and its reversal restores', async () => {
  const k = await kitchen('entityfunnel');
  const sale = await funnelSale(k, 1);
  assert.equal(await onHand(k.bid, k.pasta.id, k.location.id), 37);
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 96);
  assert.equal(await onHand(k.bid, k.basil.id, k.location.id), 49);

  // The client funnel's reversal shape (inventory.js
  // reverseMovement): a correction naming the sale.
  const level = await queryEntity(k.owner.cookie, 'StockLevel', {
    business_id: k.bid,
    product_id: k.dish.id,
    location_id: k.location.id,
  });
  const row = level.json.items[0];
  await req(`/api/entities/StockLevel/${row.id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: { quantity: row.quantity + 1 },
  });
  const reversal = await createEntity(k.owner.cookie, 'StockMovement', {
    business_id: k.bid,
    product_id: k.dish.id,
    product_name: 'Pasta Dish',
    sku: 'SKU-DISH',
    location_id: k.location.id,
    location_name: k.location.name,
    type: 'correction',
    quantity: 1,
    previous_qty: row.quantity,
    new_qty: row.quantity + 1,
    reference: 'ORD-TEST-1',
    user_name: 'Owner',
    reversal_of_id: sale.id,
    reversal_of_label: 'Sale',
  });
  assert.equal(reversal.status, 201, reversal.text);
  assert.equal(await onHand(k.bid, k.pasta.id, k.location.id), 40, 'ingredients restored');
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 100);
  assert.equal(await onHand(k.bid, k.basil.id, k.location.id), 50);
});

test('a draft recipe depletes nothing', async () => {
  const k = await kitchen('draft');
  const [special] = await createProducts(k.owner.cookie, k.bid, [
    { name: 'Special Dish', sku: 'SKU-SPC', price: 9, cost: 0 },
  ]);
  await receive(k.owner.cookie, k.bid, special.id, k.location.id, 5);
  const draft = await createEntity(k.owner.cookie, 'Recipe', {
    business_id: k.bid,
    name: 'Special (draft)',
    status: 'draft',
    product_id: special.id,
    product_name: 'Special Dish',
    yield_qty: 1,
    lines: [
      { kind: 'product', product_id: k.tomato.id, product_name: 'Tomato', sku: 'SKU-TOM', unit: 'each', quantity: 2, yield_pct: 100 },
    ],
  });
  assert.equal(draft.status, 201, draft.text);

  await withTx(pool, (client) =>
    recordMovementTx(client, {
      businessId: k.bid,
      product: special,
      location: k.location,
      type: 'sale',
      quantity: 2,
      userName: 'Owner',
      planKey: 'business',
      caller: { id: k.owner.user.id },
    }),
  );
  assert.equal(await onHand(k.bid, special.id, k.location.id), 3);
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 100, 'the draft took nothing');
  assert.equal((await consumeRows(k.bid, k.tomato.id)).length, 0);
});

test('depletion clamps at zero: a short shelf never blocks the sale or goes negative', async () => {
  const k = await kitchen('clamp');
  // Only 2 basil left, but one dish wants 1 and we sell 3 dishes.
  const level = await queryEntity(k.owner.cookie, 'StockLevel', {
    business_id: k.bid,
    product_id: k.basil.id,
    location_id: k.location.id,
  });
  await pool.query('UPDATE stock_levels SET quantity = 2 WHERE id = $1', [level.json.items[0].id]);

  await withTx(pool, (client) =>
    recordMovementTx(client, {
      businessId: k.bid,
      product: k.dish,
      location: k.location,
      type: 'sale',
      quantity: 3,
      userName: 'Owner',
      planKey: 'business',
      caller: { id: k.owner.user.id },
    }),
  );
  assert.equal(await onHand(k.bid, k.dish.id, k.location.id), 7, 'the sale itself went through');
  assert.equal(await onHand(k.bid, k.basil.id, k.location.id), 0, 'clamped at zero, never negative');
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 88, 'the rest still depleted in full');
});

test('an archived ingredient is skipped (the Nov 14 freeze), the sale still lands', async () => {
  const k = await kitchen('archived');
  await req(`/api/entities/Product/${k.basil.id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: { status: 'archived' },
  });
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
  assert.equal(await onHand(k.bid, k.dish.id, k.location.id), 9);
  assert.equal(await onHand(k.bid, k.tomato.id, k.location.id), 96);
  assert.equal((await consumeRows(k.bid, k.basil.id)).length, 0, 'the frozen ingredient was not touched');
});

// ---------------------------------------------------------------------------
// True cost: yield divides cost, sub-recipes roll up, Q is cost-only.
// ---------------------------------------------------------------------------

test('true cost: yield is EP math, sub-recipes roll up, Q factor touches cost only', () => {
  const chicken = { id: 'chicken', cost: 10 };
  const pastaProd = { id: 'pasta', cost: 1 };
  const products = new Map([[chicken.id, chicken], [pastaProd.id, pastaProd]]);
  // A whole chicken at $10, yield 55%: one make (yield 1) costs 10 / 0.55.
  const chickenDish = {
    id: 'r-chicken',
    yield_qty: 1,
    q_factor_pct: 0,
    lines: [{ kind: 'product', product_id: 'chicken', quantity: 1, yield_pct: 55 }],
  };
  const recipes = new Map([[chickenDish.id, chickenDish]]);
  assert.ok(Math.abs(recipeCostPerMake(recipes, products, chickenDish) - 10 / 0.55) < 1e-9);

  // Q at 10% lifts cost by exactly that much — and nothing else.
  const withQ = { ...chickenDish, q_factor_pct: 10 };
  assert.ok(Math.abs(recipeCostPerMake(recipes, products, withQ) - (10 / 0.55) * 1.1) < 1e-9);

  // The kitchen's own numbers: sauce 2.20 per make / 1.10 per
  // unit; the dish 3.00 pasta + 2 × 1.10 sauce = 5.20.
  const kProducts = new Map([
    ['tom', { id: 'tom', cost: 0.5 }],
    ['bas', { id: 'bas', cost: 0.2 }],
    ['pas', { id: 'pas', cost: 1 }],
  ]);
  const sauce = {
    id: 'sauce',
    yield_qty: 2,
    q_factor_pct: 0,
    lines: [
      { kind: 'product', product_id: 'tom', quantity: 4, yield_pct: 100 },
      { kind: 'product', product_id: 'bas', quantity: 1, yield_pct: 100 },
    ],
  };
  const dishRecipe = {
    id: 'dishr',
    yield_qty: 1,
    q_factor_pct: 0,
    lines: [
      { kind: 'product', product_id: 'pas', quantity: 3, yield_pct: 100 },
      { kind: 'recipe', recipe_id: 'sauce', quantity: 2 },
    ],
  };
  const kRecipes = new Map([[sauce.id, sauce], [dishRecipe.id, dishRecipe]]);
  assert.ok(Math.abs(recipeCostPerMake(kRecipes, kProducts, dishRecipe) - 5.2) < 1e-9);
});

test('the owner read carries true cost; food-cost percentage rides the price', async () => {
  const k = await kitchen('ownermoney');
  const read = await req(`/api/entities/Recipe/${k.dishRecipe.id}`, { cookie: k.owner.cookie });
  assert.equal(read.status, 200, read.text);
  assert.equal(read.json.cost_per_make, 5.2);
  assert.equal(read.json.true_cost, 5.2);
  assert.equal(read.json.food_cost_pct, 43.3);
});

// ---------------------------------------------------------------------------
// Ticks + money shaping + plan gate.
// ---------------------------------------------------------------------------

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
  // No active_business_id write: access resolves from the
  // staff row for the requested business, and pointing a
  // still-invited member's home business at the workspace
  // gets their fresh session refused (probed Nov 23, 2026).
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

test('unticked staff: the dish is visible, the money is nowhere in the payload', async () => {
  const k = await kitchen('staffnomoney');
  const staff = await member(k.owner, 'viewer');

  const list = await queryEntity(staff.cookie, 'Recipe', { business_id: k.bid });
  assert.equal(list.status, 200, list.text);
  const dishRow = list.json.items.find((r) => r.id === k.dishRecipe.id);
  assert.ok(dishRow, 'the dish itself is visible');
  assert.ok(!('true_cost' in dishRow), 'no true_cost key at all');
  assert.ok(!('cost_per_make' in dishRow), 'no cost_per_make key at all');
  assert.ok(!('food_cost_pct' in dishRow), 'no food_cost_pct key at all');

  const one = await req(`/api/entities/Recipe/${k.dishRecipe.id}`, { cookie: staff.cookie });
  assert.equal(one.status, 200);
  assert.ok(!('true_cost' in one.json));
});

test('the build and pars ticks gate the writes; money tick reveals the figures', async () => {
  const k = await kitchen('ticks');
  const staff = await member(k.owner, 'ticked');

  const recipeWrite = await createEntity(staff.cookie, 'Recipe', {
    business_id: k.bid,
    name: 'Staff Soup',
    lines: [{ kind: 'product', product_id: k.tomato.id, product_name: 'Tomato', quantity: 1, yield_pct: 100 }],
  });
  assert.equal(recipeWrite.status, 403, recipeWrite.text);

  const parWrite = await createEntity(staff.cookie, 'Par', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    par_qty: 10,
    pack_size: 1,
  });
  assert.equal(parWrite.status, 403, parWrite.text);

  await grantTicks(k.owner, staff.memberId, ['restaurant.build', 'restaurant.pars', 'restaurant.money']);

  const recipeOk = await createEntity(staff.cookie, 'Recipe', {
    business_id: k.bid,
    name: 'Staff Soup',
    lines: [{ kind: 'product', product_id: k.tomato.id, product_name: 'Tomato', quantity: 1, yield_pct: 100 }],
  });
  assert.equal(recipeOk.status, 201, recipeOk.text);

  const parOk = await createEntity(staff.cookie, 'Par', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    par_qty: 10,
    pack_size: 1,
  });
  assert.equal(parOk.status, 201, parOk.text);

  const read = await req(`/api/entities/Recipe/${k.dishRecipe.id}`, { cookie: staff.cookie });
  assert.equal(read.json.true_cost, 5.2, 'the money tick reveals the same figures the owner sees');
});

test('Essentials: the corner does not exist — writes refused, lists empty', async () => {
  const owner = await ownerWithBusiness(email('ess'), 'Essentials Shop', { plan: 'essentials' });
  const bid = owner.business.id;
  const [prod] = await createProducts(owner.cookie, bid, [{ name: 'Soup', sku: 'SKU-SOUP', price: 5, cost: 1 }]);

  const write = await createEntity(owner.cookie, 'Recipe', {
    business_id: bid,
    name: 'Soup recipe',
    lines: [{ kind: 'product', product_id: prod.id, product_name: 'Soup', quantity: 1, yield_pct: 100 }],
  });
  assert.notEqual(write.status, 201, write.text);

  const list = await queryEntity(owner.cookie, 'Recipe', { business_id: bid });
  assert.equal(list.status, 200);
  assert.equal((list.json.items || []).length, 0, 'nothing to see on Essentials');

  const parWrite = await createEntity(owner.cookie, 'Par', {
    business_id: bid,
    product_id: prod.id,
    product_name: 'Soup',
    par_qty: 5,
    pack_size: 1,
  });
  assert.notEqual(parWrite.status, 201, parWrite.text);
});

// ---------------------------------------------------------------------------
// Validation: self, circles, one active per dish, par clashes.
// ---------------------------------------------------------------------------

test('validation: self-ingredient, circles, second active recipe, par clash', async () => {
  const k = await kitchen('validate');

  const second = await createEntity(k.owner.cookie, 'Recipe', {
    business_id: k.bid,
    name: 'Second Pasta',
    status: 'active',
    product_id: k.dish.id,
    product_name: 'Pasta Dish',
    lines: [{ kind: 'product', product_id: k.pasta.id, product_name: 'Pasta', quantity: 1, yield_pct: 100 }],
  });
  assert.equal(second.status, 400, second.text);
  assert.equal(second.json.error, 'recipe_already_active');

  const selfRef = await req(`/api/entities/Recipe/${k.sauce.id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: {
      lines: [{ kind: 'recipe', recipe_id: k.sauce.id, recipe_name: 'House Sauce', quantity: 1 }],
    },
  });
  assert.equal(selfRef.status, 400, selfRef.text);
  assert.equal(selfRef.json.error, 'recipe_self_ingredient');

  // Circle: point the sauce at the dish recipe that already uses it.
  const circle = await req(`/api/entities/Recipe/${k.sauce.id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: {
      lines: [{ kind: 'recipe', recipe_id: k.dishRecipe.id, recipe_name: 'Pasta al Pomodoro', quantity: 1 }],
    },
  });
  assert.equal(circle.status, 400, circle.text);
  assert.equal(circle.json.error, 'recipe_circle');

  const par = await createEntity(k.owner.cookie, 'Par', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    par_qty: 20,
    pack_size: 6,
  });
  assert.equal(par.status, 201, par.text);
  const clash = await createEntity(k.owner.cookie, 'Par', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    par_qty: 30,
    pack_size: 6,
  });
  assert.equal(clash.status, 400, clash.text);
  assert.equal(clash.json.error, 'par_exists');

  // A par for the same product at a location is a different par.
  const atPlace = await createEntity(k.owner.cookie, 'Par', {
    business_id: k.bid,
    product_id: k.tomato.id,
    product_name: 'Tomato',
    location_id: k.location.id,
    location_name: k.location.name,
    par_qty: 8,
    pack_size: 6,
  });
  assert.equal(atPlace.status, 201, atPlace.text);
});

// ---------------------------------------------------------------------------
// Guide math + upload parser (client lib).
// ---------------------------------------------------------------------------

test('order guide send: the guide-shaped payload lands as a draft PO in the existing flow', async () => {
  // The guide sends ONE draft PurchaseOrder per supplier through
  // the ordinary entity door — the payload shape it builds
  // (notably `note`, the purchase_orders column, NOT `notes`)
  // must be one the server takes. (The 359 harness caught a
  // `notes` key becoming a phantom INSERT column and a 500.)
  const owner = await ownerWithBusiness(email('guide-send'), 'Kitchen', { plan: 'business' });
  const bid = owner.business.id;
  const supplierRes = await createEntity(owner.cookie, 'Supplier', { business_id: bid, name: 'Farm Co' });
  assert.equal(supplierRes.status, 201, supplierRes.text);
  const [tomato] = await createProducts(owner.cookie, bid, [{ name: 'Tomato', sku: 'GT-1', price: 2, cost: 0.5 }]);
  const poRes = await createEntity(owner.cookie, 'PurchaseOrder', {
    business_id: bid,
    number: 'PO-359-T',
    supplier_id: supplierRes.json.id,
    supplier_name: 'Farm Co',
    status: 'draft',
    lines: [{ product_id: tomato.id, product_name: 'Tomato', sku: 'GT-1', qty_ordered: 24, qty_received: 0, unit_cost: 0.5 }],
    total: 12,
    note: 'From the restaurant order guide.',
  });
  assert.equal(poRes.status, 201, poRes.text);
  const po = poRes.json;
  assert.equal(po.status, 'draft', 'the PO is born a draft, like every PO');
  assert.equal(po.lines[0].qty_ordered, 24);
  assert.equal(po.lines[0].qty_received, 0, 'nothing received yet');
  assert.equal(Number(po.total), 12);
});

test('order guide: par − on hand − on order, rounded UP to the pack', () => {
  const pars = [
    { id: 'p1', product_id: 'tom', product_name: 'Tomato', par_qty: 20, pack_size: 6, supplier_id: 's1', supplier_name: 'Farm Co' },
  ];
  const levels = [{ product_id: 'tom', location_id: 'loc', quantity: 5 }];
  const purchaseOrders = [
    { status: 'ordered', lines: [{ product_id: 'tom', qty_ordered: 5, qty_received: 2 }] },
    { status: 'draft', lines: [{ product_id: 'tom', qty_ordered: 50, qty_received: 0 }] },
    { status: 'received', lines: [{ product_id: 'tom', qty_ordered: 9, qty_received: 9 }] },
  ];
  const productsById = new Map([['tom', { id: 'tom', supplier_id: 's1' }]]);
  const rows = guideRows({ pars, levels, purchaseOrders, productsById, suppliersById: new Map() });
  assert.equal(rows[0].onHand, 5);
  assert.equal(rows[0].onOrder, 3, 'only the open order counts — drafts and received do not');
  assert.equal(rows[0].need, 12);
  assert.equal(rows[0].orderQty, 12, '12 is already two whole packs of 6');

  const short = guideRows({
    pars: [{ ...pars[0], par_qty: 21 }],
    levels,
    purchaseOrders,
    productsById,
    suppliersById: new Map(),
  });
  assert.equal(short[0].orderQty, 18, 'a need of 13 rounds UP to 18 (three packs)');

  const full = guideRows({
    pars: [{ ...pars[0], par_qty: 8 }],
    levels,
    purchaseOrders,
    productsById,
    suppliersById: new Map(),
  });
  assert.equal(full[0].orderQty, 0, 'at par, nothing to order');
});

test('recipe upload parser: header tolerated, SKU beats name, unmatched rows named', () => {
  const products = [
    { id: 'tom', name: 'Tomato', sku: 'SKU-TOM', unit: 'each' },
    { id: 'bas', name: 'Basil', sku: 'SKU-BAS', unit: 'each' },
  ];
  const parsed = parseRecipeUpload(
    ['ingredient,quantity', 'SKU-TOM,4', 'basil,1', 'Unobtainium,9'].join('\n'),
    products,
  );
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].product_id, 'tom');
  assert.equal(parsed.lines[1].product_id, 'bas');
  assert.deepEqual(parsed.unmatched, ['Unobtainium,9']);
});

// ---------------------------------------------------------------------------
// Presentation: plan lines, nav group, training.
// ---------------------------------------------------------------------------

test('client wiring: Recipe and Par are registered entity clients', () => {
  // The pages reach the server through base44.entities.<Name>;
  // an unregistered name throws inside the page's load and the
  // list hangs on Loading forever (found by the 359 harness).
  const client = fs.readFileSync(new URL('../../src/api/client.js', import.meta.url), 'utf8');
  const namesBlock = client.slice(client.indexOf('const ENTITY_NAMES = ['));
  const names = namesBlock.slice(0, namesBlock.indexOf('];'));
  assert.ok(names.includes("'Recipe'"), 'Recipe is a registered client entity');
  assert.ok(names.includes("'Par'"), 'Par is a registered client entity');
});

test('plan presentation: the corner joins Business includes + comparison only', () => {
  const includes = PLANS.business.includes;
  assert.ok(includes.some((line) => /restaurant/i.test(line)), 'the restaurant line is on the Business plan');
  assert.ok(includes.some((line) => /order guide/i.test(line)), 'the order guide line is on the Business plan');
  assert.ok(!PLANS.essentials.includes.some((line) => /restaurant|order guide/i.test(line)), 'Essentials gains nothing');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeBusiness.includes.some((line) => /restaurant/i.test(line)), 'the Welcome card carries the corner too');
  assert.ok(welcomeBusiness.includes.some((line) => /order guide/i.test(line)), 'the Welcome card carries the guide too');
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  assert.ok(!welcomeEssentials.includes.some((line) => /restaurant|order guide/i.test(line)), 'Welcome Essentials gains nothing');
  const rows = COMPARISON_ROWS.filter((row) => /restaurant|order guide/i.test(row.label));
  // Release 361 added the corner's second pair of lines
  // (restaurantOps + restaurantDaily, pinned by t59). Release
  // 377 regrouped all four lines into the six shelf lines
  // (Kitchen, Stock, Money, Safety, Floor, Team — each starting
  // "Restaurant,"), so the restaurant family on the comparison
  // table is now six rows, every one Business-only.
  // Release 370 (the food-safety file, Nov 26, 2026) added a
  // seventh "Restaurant," line — the Food Safety File line —
  // Business-only like the rest.
  // Plan release 371 (Nov 26, 2026) added the eighth and
  // ninth — the Kitchen Display and Guest Menu Page lines —
  // Business-only like the rest.
  assert.equal(rows.length, 9);
  for (const row of rows) {
    assert.equal(row.business, true);
    assert.equal(row.essentials, false);
  }
  assert.ok(FEATURES.restaurant, 'the restaurant feature exists');
});

test('nav: the corner hangs under its own subheading, behind the feature', () => {
  const group = NAV_GROUPS.find((g) => g.labelKey === 'nav.group.restaurant');
  assert.ok(group, 'the Restaurant group exists');
  // Release 377: the group is ONE door — the Restaurant home
  // (the Today page); the shelves and features live inside the
  // corner (anti-clutter rule, pinned in full by t69).
  assert.deepEqual(group.items.map((i) => i.to), ['/restaurant']);
  assert.equal(group.items.length, 1);
  assert.ok(group.items.every((i) => i.feature === 'restaurant'));
});

test('training: five restaurant lessons, Business-scoped, ticks bring theirs', () => {
  assert.equal(CLIENT_LESSONS.length, 128);
  assert.equal(SERVER_LESSONS.length, 128);
  const ids = ['owner-restaurant', 'staff-restaurant-view', 'mgr-restaurant-build', 'mgr-restaurant-pars', 'mgr-restaurant-money'];
  for (const id of ids) {
    const lesson = SERVER_LESSONS.find((l) => l.id === id);
    assert.ok(lesson, `${id} exists`);
    assert.equal(lesson.feature, 'restaurant');
    assert.equal(lessonVisibleOnPlan(lesson, false), false, `${id} is invisible on Essentials`);
    assert.equal(lessonVisibleOnPlan(lesson, true), true);
  }
  assert.deepEqual(LESSON_REQUIREMENTS['mgr-restaurant-build'], ['restaurant.build']);
  assert.deepEqual(LESSON_REQUIREMENTS['mgr-restaurant-pars'], ['restaurant.pars']);
  assert.deepEqual(LESSON_REQUIREMENTS['mgr-restaurant-money'], ['restaurant.money']);
});

test('migration 046 landed: recipes, pars and the cause column exist', async () => {
  // Probes, not catalog queries: a zero-row read succeeds only
  // when the table (and the column) is really there.
  await pool.query('SELECT id FROM recipes LIMIT 0');
  await pool.query('SELECT id FROM pars LIMIT 0');
  await pool.query('SELECT cause_movement_id FROM stock_movements LIMIT 0');
});
