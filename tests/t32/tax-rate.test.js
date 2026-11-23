// Extension 2 (Nov 15, 2026): the set-once sales tax rate.
//  - Server: businesses.tax_rate (migration 027) rides the
//    owner-only PATCH with strict validation — blank unsets,
//    a decimal percent 0–100 with at most 4 decimal places is
//    stored as typed; anything else is refused whole.
//  - Client math: $4.99 at 8.25% pre-fills $0.41, totals agree.
//  - Wiring pins: Settings field, save payload, the order
//    form's untouched-until-typed pre-fill and its Settings
//    door, Plans/Welcome parity, the owner training lesson in
//    BOTH catalogs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ownerWithBusiness, req, close } from './helpers.js';

// Teardown (added Nov 15, 2026, code-generator run): every sibling
// suite registers after(close); without it this file's tests all
// pass but the process never exits (the booted server pends).
after(close);
import { parseTaxRate, formatTaxRate, computeOrderTax } from '../../src/lib/taxRate.js';

let owner;
before(async () => {
  owner = await ownerWithBusiness('tax-owner@example.com', 'Tax Owner', { plan: 'essentials' });
});

const patch = (body) =>
  req(`/api/businesses/${owner.business.id}`, { method: 'PATCH', body, cookie: owner.cookie });

test('the rate saves, reads back, and clears', async () => {
  const saved = await patch({ tax_rate: '8.25' });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.tax_rate, '8.25');
  const listed = await req('/api/businesses', { cookie: owner.cookie });
  assert.equal(listed.json.items[0].tax_rate, '8.25');
  const combined = await patch({ tax_rate: '8.2500' });
  assert.equal(combined.status, 200);
  assert.equal(combined.json.tax_rate, '8.2500', 'a combined rate is stored exactly as typed');
  const cleared = await patch({ tax_rate: '' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.tax_rate, '', 'blank unsets the rate');
});

test('invalid rates are refused whole and the old rate stands', async () => {
  await patch({ tax_rate: '8.25' });
  for (const bad of ['101', '100.0001', '-1', 'abc', '8.25000', '8,25', '1e2']) {
    const refused = await patch({ tax_rate: bad });
    assert.equal(refused.status, 400, `${bad} refused`);
  }
  const listed = await req('/api/businesses', { cookie: owner.cookie });
  assert.equal(listed.json.items[0].tax_rate, '8.25');
  await patch({ tax_rate: '' });
});

test('the tax math: subtotal times rate, rounded to the cent', () => {
  assert.equal(parseTaxRate('8.25'), 8.25);
  assert.equal(parseTaxRate(''), null);
  assert.equal(parseTaxRate('abc'), null);
  assert.equal(formatTaxRate('8.2500'), '8.25');
  assert.equal(formatTaxRate('8'), '8');
  assert.equal(computeOrderTax(4.99, 8.25), 0.41, 'the acceptance case: $4.99 at 8.25% is $0.41');
  assert.equal(computeOrderTax(4.99, '8.25'), 0.41);
  assert.equal(computeOrderTax(0, 8.25), 0);
  assert.equal(computeOrderTax(100, null), 0, 'no rate set = no auto tax');
  // The order total agrees: subtotal − discount + shipping + tax.
  assert.equal((4.99 + computeOrderTax(4.99, 8.25)).toFixed(2), '5.40');
});

test('wiring: Settings field, save payload, order-form pre-fill discipline', () => {
  const details = readFileSync('src/components/business/DetailsCard.jsx', 'utf8');
  assert.match(details, /id="business-tax-rate"/);
  assert.match(details, /settings\.details\.taxRate/);
  assert.match(details, /settings\.details\.taxRateHint/);
  const business = readFileSync('src/lib/business.js', 'utf8');
  assert.match(business, /tax_rate: values\.tax_rate\?\.trim\(\) \|\| ''/);
  const dialog = readFileSync('src/components/orders/OrderFormDialog.jsx', 'utf8');
  assert.match(dialog, /const \[taxTouched, setTaxTouched\] = useState\(false\)/);
  assert.match(dialog, /computeOrderTax\(orderTotals\(form\)\.subtotal, effectiveTaxRate\)/);
  assert.match(dialog, /if \(!open \|\| order \|\| !form \|\| taxTouched \|\| effectiveTaxRate == null\) return;/);
  assert.match(dialog, /orders\.taxRateSet/);
  assert.match(dialog, /orders\.taxRateUnset/);
  assert.match(dialog, /to="\/settings"/);
});

test('plans parity and the training lesson, both catalogs', () => {
  const plans = readFileSync('src/lib/plans.js', 'utf8');
  // 3 since the dedupe ruling (Nov 19, 2026): the Essentials
  // lists of both families + the comparison row. Business has
  // the feature under its "Everything in Essentials" line
  // instead of a repeated tax-rate line.
  assert.equal(plans.split("t('plansLib.includes.taxRate')").length - 1, 3, 'Essentials lists x2 + the comparison row');
  for (const catalog of ['src/lib/trainingCatalog.js', 'server/trainingCatalog.js']) {
    const src = readFileSync(catalog, 'utf8');
    assert.match(src, /\{ id: 'owner-tax-rate', track: 'owner', module: 'orders', steps: 4[ ,]/);
  }
});
