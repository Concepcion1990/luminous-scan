/**
 * T69 — Release 377: the Restaurant Corner's information
 * architecture (the owner's restaurant build-all ruling,
 * Nov 24–25, 2026; plan-367 in the build plan).
 *
 * The corner's fourteen features (359 recipes/pars + the 361
 * operations set) were a flat fourteen-door hub. This release
 * reorganizes them — zero behavior change — into:
 *   - a TODAY page as the section home (/restaurant): what is
 *     86'd, which temperature units are still due today, what
 *     is expiring (FEFO), and today's batch runs — only real
 *     data, no placeholder cards;
 *   - SIX SHELVES (Kitchen & Recipes · Stock & Ordering ·
 *     Invoices & Money · Food Safety · Floor & Guests ·
 *     Team & Place), each a page of door cards;
 *   - a LOCATIONS shelf that exists ONLY for owners with 2+
 *     businesses.
 *
 * Anti-clutter rules pinned here: the main nav's Restaurant
 * group is the ONE '/restaurant' door; every feature is at
 * most two taps from home (home shelf grid -> shelf page ->
 * door, and the home also carries each shelf's doors as
 * quick links); every restaurant route stays behind the
 * Business-only PlanRedirect; Essentials sees nothing.
 *
 * Proven: the shelf model by import + execution (membership,
 * exactly-one primary home per feature, cross-links named as
 * cross-links), the Locations gate by execution, the Today
 * summary by execution over fixtures AND over rows seeded
 * through the real entity API on Business (the same reads
 * the Today page makes), Essentials refusal for the Today
 * data sources, and the translation hard gate for the 27 new
 * keys (present and non-empty in all 52 locales; the four
 * regional Englishes byte-identical to en).
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  pool,
  req,
  close,
  resetRateLimits,
  ownerWithBusiness,
  createProducts,
} from './helpers.js';
import {
  SHELVES,
  LOCATIONS_SHELF,
  RESTAURANT_HOME,
  shelvesFor,
  shelfById,
  homeShelfForRoute,
  featureDoors,
  summarizeToday,
  todayHasContent,
} from '../../src/lib/restaurantShelves.js';
import { LOCALES } from '../../src/lib/i18n.js';
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

// The fourteen feature routes the corner had before this
// release (359 + 361), each with exactly one primary shelf.
const FEATURE_HOME = {
  '/restaurant/recipes': 'kitchen',
  '/restaurant/prep': 'kitchen',
  '/restaurant/menu': 'kitchen',
  '/restaurant/order-guide': 'stock',
  '/restaurant/transfers': 'stock',
  '/restaurant/invoices': 'money',
  '/restaurant/variance': 'money',
  '/restaurant/ledger': 'money',
  '/restaurant/temp-logs': 'safety',
  '/restaurant/expiry': 'safety',
  '/restaurant/allergens': 'safety',
  '/restaurant/86': 'floor',
  '/restaurant/waste': 'floor',
  '/restaurant/staff-meals': 'team',
};

const NEW_KEYS = [
  'nav.restaurant',
  'restaurant.shelf.kitchen', 'restaurant.shelf.stock', 'restaurant.shelf.money',
  'restaurant.shelf.safety', 'restaurant.shelf.floor', 'restaurant.shelf.team',
  'restaurant.shelf.locations',
  'restaurant.doorRecipes',
  'restaurant.today.title', 'restaurant.today.subtitle', 'restaurant.today.tempsDue',
  'restaurant.today.tempsDone', 'restaurant.today.outOfRange', 'restaurant.today.runsToday',
  'restaurant.today.allClear',
  'restaurant.shelvesTitle', 'restaurant.shelf.back',
  'restaurant.locations.intro', 'restaurant.locations.open', 'restaurant.locations.current',
  'plansLib.businessIncludes.restaurantKitchen', 'plansLib.businessIncludes.restaurantStock',
  'plansLib.businessIncludes.restaurantMoney', 'plansLib.businessIncludes.restaurantSafety',
  'plansLib.businessIncludes.restaurantFloor', 'plansLib.businessIncludes.restaurantTeam',
];

// ---------------------------------------------------------------------------
// The shelf model.
// ---------------------------------------------------------------------------

test('shelf model: six shelves in plan order, every feature with exactly one primary home', () => {
  assert.deepEqual(SHELVES.map((s) => s.id), ['kitchen', 'stock', 'money', 'safety', 'floor', 'team']);
  const primaries = featureDoors();
  assert.equal(new Set(primaries.map((d) => d.to)).size, primaries.length, 'no route has two primary listings');
  const mapping = {};
  for (const door of primaries) mapping[door.to] = homeShelfForRoute(door.to)?.id;
  assert.deepEqual(mapping, FEATURE_HOME, 'the implemented mapping is the pinned mapping');
  for (const [route, shelfId] of Object.entries(FEATURE_HOME)) {
    assert.equal(homeShelfForRoute(route)?.id, shelfId, `${route} resolves to its home shelf`);
  }
  assert.equal(homeShelfForRoute('/restaurant/menu')?.id, 'kitchen', 'menu engineering lives in Kitchen');
  assert.equal(homeShelfForRoute('/restaurant/waste')?.id, 'floor', 'the waste log lives on Floor');
  assert.equal(homeShelfForRoute('/restaurant/variance')?.id, 'money', 'variance lives with the money');
  assert.equal(homeShelfForRoute('/restaurant/nope'), null);
  assert.equal(homeShelfForRoute(RESTAURANT_HOME), null, 'the home itself has no shelf');
});

test('shelf model: cross-links are named cross-links and point at real primary doors', () => {
  const money = shelfById('money');
  const menuLink = money.doors.find((d) => d.to === '/restaurant/menu');
  assert.ok(menuLink && menuLink.crossLink === true, 'menu engineering cross-links from Money, as the plan table states');
  for (const shelf of SHELVES) {
    for (const door of shelf.doors) {
      if (!door.crossLink) continue;
      if (!door.to.startsWith('/restaurant/')) {
        // Release 378 (Nov 25, 2026): a cross-link may also
        // point at a GENERAL feature's home outside the corner
        // — the pattern the 377 record flagged for the Q1–Q4
        // general features as they land. The two that exist
        // are pinned by name in t70: Stock & Ordering -> the
        // general Counts page, Team & Place -> the manager
        // log book. A general cross-link has no shelf home by
        // design; what it must never do is pose as a primary.
        assert.equal(homeShelfForRoute(door.to), null, `${door.to} is a general route with no shelf home`);
        continue;
      }
      const home = homeShelfForRoute(door.to);
      assert.ok(home && home.id !== shelf.id, `${door.to} cross-linked from ${shelf.id} has its primary home elsewhere`);
    }
  }
});

test('shelf model: every door and shelf carries real words in English', () => {
  for (const shelf of [...SHELVES, LOCATIONS_SHELF]) {
    assert.ok(en[shelf.labelKey], `shelf ${shelf.id} has a title`);
    for (const door of shelf.doors) {
      assert.ok(en[door.titleKey], `door ${door.to} has a title key (${door.titleKey})`);
      assert.ok(en[door.bodyKey], `door ${door.to} has a body key (${door.bodyKey})`);
    }
  }
  assert.equal(en['restaurant.shelf.kitchen'], 'Kitchen & Recipes');
  assert.equal(en['restaurant.shelf.stock'], 'Stock & Ordering');
  assert.equal(en['restaurant.shelf.money'], 'Invoices & Money');
  assert.equal(en['restaurant.shelf.safety'], 'Food Safety');
  assert.equal(en['restaurant.shelf.floor'], 'Floor & Guests');
  assert.equal(en['restaurant.shelf.team'], 'Team & Place');
  assert.equal(en['restaurant.shelf.locations'], 'Locations');
});

test('locations gate: the shelf exists only for owners with 2+ businesses', () => {
  assert.equal(LOCATIONS_SHELF.id, 'locations');
  assert.deepEqual(shelvesFor(0).map((s) => s.id), SHELVES.map((s) => s.id));
  assert.deepEqual(shelvesFor(1).map((s) => s.id), SHELVES.map((s) => s.id), 'one business: no Locations shelf');
  assert.deepEqual(
    shelvesFor(2).map((s) => s.id),
    [...SHELVES.map((s) => s.id), 'locations'],
    'two businesses: the Locations shelf joins, last',
  );
  assert.deepEqual(shelvesFor(5).map((s) => s.id), shelvesFor(2).map((s) => s.id));
});

// ---------------------------------------------------------------------------
// Routes: everything gated, everything within two taps.
// ---------------------------------------------------------------------------

test('routes: every restaurant route stays behind the Business-only gate; doors are real routes', () => {
  const app = fs.readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
  const gated = new Set();
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{\s*<PlanRedirect feature="restaurant"/g)) {
    gated.add(m[1]);
  }
  const expected = new Set([
    '/restaurant', '/restaurant/recipes', '/restaurant/recipes/:id',
    ...SHELVES.map((s) => s.route),
    LOCATIONS_SHELF.route,
    ...Object.keys(FEATURE_HOME),
  ]);
  for (const path of expected) {
    assert.ok(gated.has(path), `${path} is a restaurant-gated route`);
  }
  // No restaurant route exists outside the gate.
  for (const m of app.matchAll(/<Route\s+path="(\/restaurant[^"]*)"/g)) {
    assert.ok(gated.has(m[1]), `${m[1]} must sit behind the restaurant gate`);
  }
  // Two taps: home -> shelf (tap 1) -> door (tap 2); and the
  // home also renders each shelf's doors as quick links.
  const home = fs.readFileSync(new URL('../../src/pages/Restaurant.jsx', import.meta.url), 'utf8');
  assert.match(home, /shelf\.doors\.map/, 'the home renders each shelf’s doors as quick links');
  assert.match(home, /TodayCards/, 'the home renders the Today cards');
  assert.match(home, /summarizeToday/, 'the home summarizes from real rows');
});

// ---------------------------------------------------------------------------
// The Today summary, by execution over fixtures.
// ---------------------------------------------------------------------------

function dayOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
function isoDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test('today summary: 86 board, due temps, out-of-range, expiring stock, batch runs', () => {
  const now = new Date();
  const yesterday = dayOffset(-1);
  const summary = summarizeToday({
    eightySixItems: [
      { id: 'a', product_name: 'Soup', active: true },
      { id: 'b', product_name: 'Salad', active: false },
    ],
    tempLogs: [
      { unit_name: 'Walk-in', created_date: yesterday.toISOString() },
      { unit_name: 'Fryer', created_date: now.toISOString(), in_range: true },
      { unit_name: 'Freezer', created_date: now.toISOString(), in_range: false },
    ],
    batches: [
      { id: 'x', product_name: 'Milk', quantity: 4, expires_on: isoDay(dayOffset(3)) },
      { id: 'y', product_name: 'Rice', quantity: 4, expires_on: isoDay(dayOffset(30)) },
      { id: 'z', product_name: 'Cream', quantity: 0, expires_on: isoDay(dayOffset(2)) },
      { id: 'w', product_name: 'Old cheese', quantity: 2, expires_on: isoDay(dayOffset(-1)) },
    ],
    batchRuns: [
      { id: 'r1', created_date: now.toISOString() },
      { id: 'r2', created_date: yesterday.toISOString() },
    ],
    now,
  });
  assert.equal(summary.outNow.length, 1, 'only the active 86 item shows');
  assert.equal(summary.outNow[0].product_name, 'Soup');
  assert.deepEqual(summary.temps.dueUnits, ['Walk-in'], 'a unit read yesterday but not today is due');
  assert.equal(summary.temps.readingsToday, 2, 'two units have readings today');
  assert.equal(summary.temps.outOfRangeToday.length, 1, 'the out-of-range reading is listed');
  assert.equal(summary.temps.outOfRangeToday[0].unit_name, 'Freezer');
  // FEFO: past-due first, then the in-window batch; the
  // far-out batch and the empty batch stay off the list.
  assert.deepEqual(summary.expiring.map((b) => b.product_name), ['Old cheese', 'Milk']);
  assert.equal(summary.runsToday.length, 1, "only today's batch run counts");
  assert.equal(todayHasContent(summary), true);
});

test('today summary: an empty corner is an honest all-clear', () => {
  const summary = summarizeToday({
    eightySixItems: [], tempLogs: [], batches: [], batchRuns: [], now: new Date(),
  });
  assert.equal(todayHasContent(summary), false);
  assert.equal(summary.temps.known, false);
  assert.deepEqual(summary.temps.dueUnits, []);
  assert.equal(summary.runsToday.length, 0);
});

// ---------------------------------------------------------------------------
// The Today page's data, by execution through the real API.
// ---------------------------------------------------------------------------

test('today data: seeded through the entity API on Business, the summary sees it', async () => {
  const owner = await ownerWithBusiness(email('todaybiz'), 'Today Bistro', { plan: 'business' });
  const bid = owner.business.id;
  const [dish, tomatoes] = await createProducts(owner.cookie, bid, [
    { name: 'Tomato Soup', sku: 'SKU-SOUP', price: 9, cost: 2 },
    { name: 'Tomatoes', sku: 'SKU-TOM', price: 3, cost: 1 },
  ]);

  const item = await createEntity(owner.cookie, 'EightySixItem', {
    business_id: bid, product_id: dish.id, product_name: 'Tomato Soup',
  });
  assert.equal(item.status, 201, item.text);

  // A unit read today, and a unit whose only reading is old
  // (backdated the way the 361 tests backdate rows).
  const fresh = await createEntity(owner.cookie, 'TempLog', {
    business_id: bid, unit_name: 'Fryer', temperature: 350, scale: 'F', in_range: true,
  });
  assert.equal(fresh.status, 201, fresh.text);
  const stale = await createEntity(owner.cookie, 'TempLog', {
    business_id: bid, unit_name: 'Walk-in fridge', temperature: 38, scale: 'F', in_range: true,
  });
  assert.equal(stale.status, 201, stale.text);
  await pool.query(
    `UPDATE temp_logs SET created_at = now() - interval '2 days' WHERE id = $1`,
    [stale.json.id],
  );

  const batch = await createEntity(owner.cookie, 'StockBatch', {
    business_id: bid, product_id: dish.id, product_name: 'Tomato Soup',
    quantity: 6, expires_on: isoDay(dayOffset(3)),
  });
  assert.equal(batch.status, 201, batch.text);

  const recipe = await createEntity(owner.cookie, 'Recipe', {
    business_id: bid, name: 'Soup base', status: 'active',
    product_id: dish.id, product_name: 'Tomato Soup', yield_qty: 1,
    lines: [{ kind: 'product', product_id: tomatoes.id, product_name: 'Tomatoes', unit: 'each', quantity: 2, yield_pct: 100 }],
  });
  assert.equal(recipe.status, 201, recipe.text);
  const run = await createEntity(owner.cookie, 'BatchRun', {
    business_id: bid, recipe_id: recipe.json.id, recipe_name: 'Soup base', makes: 2,
  });
  assert.equal(run.status, 201, run.text);

  // The Today page's own reads, then its own summary.
  const [items, logs, batches, runs] = await Promise.all([
    queryEntity(owner.cookie, 'EightySixItem', { business_id: bid }),
    queryEntity(owner.cookie, 'TempLog', { business_id: bid }),
    queryEntity(owner.cookie, 'StockBatch', { business_id: bid }),
    queryEntity(owner.cookie, 'BatchRun', { business_id: bid }),
  ]);
  const summary = summarizeToday({
    eightySixItems: items.json.items,
    tempLogs: logs.json.items,
    batches: batches.json.items,
    batchRuns: runs.json.items,
    now: new Date(),
  });
  assert.equal(summary.outNow.length, 1);
  assert.deepEqual(summary.temps.dueUnits, ['Walk-in fridge']);
  assert.equal(summary.temps.readingsToday, 1);
  assert.equal(summary.expiring.length, 1);
  assert.equal(summary.expiring[0].product_name, 'Tomato Soup');
  assert.equal(summary.runsToday.length, 1);
  assert.equal(todayHasContent(summary), true);
});

test('today data: Essentials cannot write or see any of the four sources', async () => {
  const owner = await ownerWithBusiness(email('todayess'), 'Today Corner Store', { plan: 'essentials' });
  const bid = owner.business.id;
  const [prod] = await createProducts(owner.cookie, bid, [
    { name: 'Notebook', sku: 'SKU-NB', price: 5, cost: 1 },
  ]);
  const bodies = {
    EightySixItem: { product_id: prod.id, product_name: 'Notebook' },
    TempLog: { unit_name: 'Fridge', temperature: 4, scale: 'C', in_range: true },
    StockBatch: { product_id: prod.id, product_name: 'Notebook', quantity: 3 },
    BatchRun: { recipe_name: 'Nope', makes: 1 },
    Recipe: { name: 'Nope', status: 'active', lines: [] },
  };
  for (const [name, body] of Object.entries(bodies)) {
    const write = await createEntity(owner.cookie, name, { business_id: bid, ...body });
    assert.notEqual(write.status, 201, `${name} write on Essentials: ${write.text}`);
    const list = await queryEntity(owner.cookie, name, { business_id: bid });
    assert.equal(list.status, 200, `${name} list`);
    assert.equal((list.json.items || []).length, 0, `${name} shows nothing on Essentials`);
  }
});

// ---------------------------------------------------------------------------
// The translation hard gate for this release's strings.
// ---------------------------------------------------------------------------

test('i18n: the 27 new keys exist, non-empty, in all 52 locales; regional Englishes match en', () => {
  assert.equal(NEW_KEYS.length, 27);
  const codes = Object.keys(LOCALES);
  assert.equal(codes.length, 52);
  for (const code of codes) {
    for (const key of NEW_KEYS) {
      const value = LOCALES[code][key];
      assert.ok(typeof value === 'string' && value.trim().length > 0, `${code} carries ${key}`);
    }
  }
  for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) {
    for (const key of NEW_KEYS) {
      assert.equal(LOCALES[code][key], en[key], `${code} matches en for ${key}`);
    }
  }
  // No locale falls back to the English shelf names (except the
  // Englishes themselves and pcm, whose written form shares
  // English words by design — checked loosely there).
  for (const code of codes) {
    if (code.startsWith('en') || code === 'pcm') continue;
    assert.notEqual(
      LOCALES[code]['restaurant.shelf.safety'],
      en['restaurant.shelf.safety'],
      `${code} shelf names are translated, not English fallback`,
    );
  }
});
