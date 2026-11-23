// Release 348 (Nov 22, 2026): PRODUCT PRICES ON LISTS.
//  - Each product's own price prints BESIDE ITS COUNT on the
//    Products list and on the Inventory page, both plans
//    (owner-approved Nov 18, 2026).
//  - The beside-count figure comes from the one priceInfo
//    derivation (listPrice in src/lib/pricing.js), so it can
//    never disagree with the Products price column: for a
//    regular product — and for every Essentials product, whose
//    pricing fields arrive pre-stripped — it is exactly the
//    stored price, verbatim, cents and all.
//  - A product with NO price set shows nothing beside the
//    count — never an invented $0.00 (price-honesty rule).
//  - The Overview total inventory value stays BUSINESS-ONLY:
//    the Stock value card rides the plan's valuation feature
//    (featureAllowed is Business-only for every gated module),
//    so Essentials carries no trace of it. The rendered proof
//    for both plans lives in the Chrome harness; here the gate
//    composition is pinned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listPrice, priceInfo } from '../../src/lib/pricing.js';
import { PLANS, WELCOME_OPTIONS, featureAllowed } from '../../src/lib/plans.js';
import { en } from '../../src/lib/locales/en.js';
import { esMX } from '../../src/lib/locales/es-MX.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// ---- listPrice: the beside-count figure --------------------------------------

test('listPrice: the stored price, verbatim, cents and all', () => {
  assert.equal(listPrice({ price: 2.64 }), 2.64);
  assert.equal(listPrice({ price: 2.5 }), 2.5);
  assert.equal(listPrice({ price: '2.50' }), 2.5, 'a numeric string from the row still reads');
  assert.equal(listPrice({ price: 100 }), 100);
  assert.equal(listPrice({ price: 0 }), 0, 'a stored zero is a real price, not an absence');
});

test('listPrice: no price set → null (the lists show nothing, never $0.00)', () => {
  assert.equal(listPrice({ price: null }), null);
  assert.equal(listPrice({ price: undefined }), null);
  assert.equal(listPrice({ price: '' }), null);
  assert.equal(listPrice({}), null);
  assert.equal(listPrice(null), null);
  assert.equal(listPrice(undefined), null);
});

test('listPrice: markdown shapes agree with the price column derivation', () => {
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  // Clearance: the effective (clearance) price — the same figure
  // ProductPrice renders in the xl column, so the row never
  // carries two different prices at two widths.
  assert.equal(listPrice({ price: 10, pricing_mode: 'clearance', clearance_price: 7.5 }), 7.5);
  // A markdown mode carries its price even with no regular price stored.
  assert.equal(listPrice({ price: null, pricing_mode: 'clearance', clearance_price: 7.5 }), 7.5);
  // Rollback inside its window: the sale price; before it starts,
  // the regular price rules (the owner's rollback design).
  assert.equal(
    listPrice({ price: 10, pricing_mode: 'rollback', sale_price: 8, sale_start: day(-1), sale_end: day(1) }),
    8,
  );
  assert.equal(
    listPrice({ price: 10, pricing_mode: 'rollback', sale_price: 8, sale_start: day(2), sale_end: day(3) }),
    10,
  );
  // priceInfo itself is untouched by this release.
  assert.equal(priceInfo({ price: 3 }).effective, 3);
});

// ---- Currency formatting follows the business setting -------------------------

test('currency: the beside-count figure formats in the business currency, exact to the cent', () => {
  // ListPrice composes formatMoney(value, currency, 2), whose whole
  // body is this one Intl call (pinned by source below); the
  // rendered EUR proof in a real browser is the harness's job.
  const fmt = (value, currency) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  assert.equal(fmt(listPrice({ price: 2.64 }), 'USD'), '$2.64');
  assert.equal(fmt(listPrice({ price: 2.64 }), 'EUR'), '€2.64');
  assert.equal(fmt(listPrice({ price: 2.64 }), 'MXN'), 'MX$2.64');
  const listPriceSrc = read('src/components/products/ListPrice.jsx');
  assert.match(listPriceSrc, /formatMoney\(value, currency, 2\)/, 'ListPrice formats through formatMoney with the passed currency');
  assert.match(listPriceSrc, /if \(value === null\) return null;/, 'ListPrice renders nothing when no price is set');
});

// ---- The two surfaces render it beside the count ------------------------------

test('Products list: price beside the count below xl, and in the phone cell', () => {
  const page = read('src/pages/Products.jsx');
  assert.match(page, /import ListPrice from '@\/components\/products\/ListPrice';/);
  // The on-hand (count) cell carries the compact price, stepping
  // aside at xl where the price column takes over.
  assert.match(
    page,
    /<ListPrice\s+product=\{product\}\s+currency=\{profile\.currency\}\s+className="mt-0\.5 block text-xs font-normal text-muted-foreground xl:hidden"/,
    'count cell carries the beside-count price (xl:hidden)',
  );
  // The phone actions cell (the row's only count below md) too.
  assert.match(
    page,
    /<ListPrice\s+product=\{product\}\s+currency=\{profile\.currency\}\s+className="mr-1 text-xs text-muted-foreground md:hidden"/,
    'phone cell carries the beside-count price (md:hidden)',
  );
  // The xl price column keeps its full ProductPrice treatment.
  assert.match(page, /<ProductPrice product=\{product\} currency=\{profile\.currency\} digits=\{2\} \/>/);
});

test('Inventory page: the row prints its price under the count, in the business currency', () => {
  const page = read('src/pages/Inventory.jsx');
  assert.match(page, /currency=\{profile\.currency\}/, 'Inventory passes its own currency to the rows');
  const row = read('src/components/inventory/InventoryRow.jsx');
  assert.match(row, /const price = listPrice\(product\);/);
  assert.match(row, /\{price !== null && \(/, 'no price set → no line at all');
  assert.match(row, /formatMoney\(price, currency, 2\)/, 'the line formats through formatMoney in the passed currency');
});

// ---- Overview valuation stays Business-only -----------------------------------

test('Overview valuation: the gate is Business-only and the card reads the one summarize()', () => {
  assert.equal(featureAllowed('essentials', 'valuation'), false, 'Essentials has no valuation feature');
  assert.equal(featureAllowed('business', 'valuation'), true, 'Business carries valuation');
  const dashboard = read('src/pages/Dashboard.jsx');
  assert.match(dashboard, /const showValuation = !entitlementLoading && can\('valuation'\);/);
  assert.match(
    dashboard,
    /\{showValuation && \(\s*<StatCard\s+label=\{t\('dashboard\.stockValue'\)\}/,
    'the Stock value card renders only behind showValuation',
  );
  assert.match(dashboard, /formatMoney\(stats\.stockValue, profile\.currency, 2\)/);
  const inventory = read('src/lib/inventory.js');
  assert.match(
    inventory,
    /const stockValue = levels\.reduce\(\(sum, level\) => \{\s*const product = productById\.get\(level\.product_id\);\s*return sum \+ \(level\.quantity \|\| 0\) \* \(product\?\.cost \|\| 0\);/,
    'summarize() values stock at quantity × cost',
  );
});

// ---- The plans line ------------------------------------------------------------

test('plans line: on Plans + Welcome + the comparison table, Essentials-named, Business by inheritance', () => {
  const plans = read('src/lib/plans.js');
  assert.equal(
    plans.split("t('plansLib.includes.listPrices')").length - 1,
    3,
    'Essentials lists x2 + the comparison row (the Settings summary renders from the same PLANS data)',
  );
  assert.equal(en['plansLib.includes.listPrices'], "Each product's price beside its count");
  assert.ok(
    PLANS.essentials.includes.includes(en['plansLib.includes.listPrices']),
    'Essentials names the line (and so the Settings summary does)',
  );
  assert.ok(
    !PLANS.business.includes.includes(en['plansLib.includes.listPrices']),
    'Business does not repeat it — its list opens with Everything in Essentials (dedupe rule)',
  );
  const welcomeEssentials = WELCOME_OPTIONS.find((o) => o.key === 'essentials');
  const welcomeBusiness = WELCOME_OPTIONS.find((o) => o.key === 'business');
  assert.ok(welcomeEssentials.includes.includes(en['plansLib.includes.listPrices']), 'Welcome Essentials names it');
  assert.ok(!welcomeBusiness.includes.includes(en['plansLib.includes.listPrices']), 'Welcome Business inherits it');
  assert.notEqual(esMX['plansLib.includes.listPrices'], en['plansLib.includes.listPrices'], 'es-MX carries its own rendering');
});
