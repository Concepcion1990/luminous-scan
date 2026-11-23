// Release 349 (Nov 22, 2026): THE RETURNS BUILD (owner-approved
// Nov 18, 2026).
//  - The returns form COMPUTES AND SHOWS the tax on the returned
//    items from the ORIGINAL order: the order's stored tax
//    against its goods gives its effective rate, and the
//    returned goods carry their proportional share. Her example:
//    a $2.50 item on an order taxed $0.14 refunds $2.64.
//  - "Amount refunded" PRE-FILLS with goods + tax (editable; a
//    hand edit wins and is never overwritten).
//  - SCAN-TO-PICK on the Returned items: a scan adds the product
//    (+1 when it is already on the return).
//  - THE EDGE (flagged for her ruling in the record): no
//    original order, or no tax recorded on it → the business's
//    CURRENT tax setting prices the tax — the state base rate
//    in Automatic mode when the order's state resolves (347),
//    otherwise the fixed rate — labeled on the form, and the
//    figure stays hand-editable. No source at all → no tax.
//  - The returns.complete gate (release 317) is untouched.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import {
  pool,
  req,
  close,
  resetRateLimits,
  registerVerifiedUser,
  ownerWithBusiness,
} from './helpers.js';
import { orderGoodsValue, returnTaxInfo } from '../../src/lib/taxRate.js';

const goodsOf = (lines) =>
  lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
import { en } from '../../src/lib/locales/en.js';
import { esMX } from '../../src/lib/locales/es-MX.js';

after(close);
beforeEach(() => resetRateLimits());

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const line = (quantity, unit_price, extra = {}) => ({
  product_id: 'p1',
  product_name: 'Widget',
  sku: 'W-1',
  quantity,
  unit_price,
  ...extra,
});

// ---- (a) Tax from the original order -----------------------------------------

test("her example: a $2.50 item on an order taxed $0.14 carries $0.14 of tax — refund $2.64, not $2.50", () => {
  const order = { lines: [line(1, 2.5)], tax: 0.14 };
  const lines = [line(1, 2.5)];
  const info = returnTaxInfo({ lines, order, taxRate: '5.789', taxMode: 'fixed' });
  assert.equal(info.source, 'order');
  assert.equal(info.tax, 0.14);
  const goods = goodsOf(lines);
  assert.equal(goods, 2.5);
  assert.equal(Math.round((goods + info.tax) * 100) / 100, 2.64, 'the refund pre-fill: goods + tax');
});

test('proportional share: a part-return carries its part of the order tax', () => {
  // Her real shape: 23 × $2.50 = $57.50 of goods, $3.33 of tax.
  const order = { lines: [line(23, 2.5)], tax: 3.33 };
  assert.equal(orderGoodsValue(order), 57.5);
  assert.equal(returnTaxInfo({ lines: [line(1, 2.5)], order }).tax, 0.14);
  assert.equal(returnTaxInfo({ lines: [line(10, 2.5)], order }).tax, 1.45);
  assert.equal(returnTaxInfo({ lines: [line(23, 2.5)], order }).tax, 3.33, 'the whole order back carries the whole tax');
});

test('multi-line orders and returns sum their goods before the share is taken', () => {
  const order = { lines: [line(2, 10), line(1, 5)], tax: 1.25 }; // goods 25, tax 1.25
  const info = returnTaxInfo({ lines: [line(1, 10), line(1, 5)], order }); // goods 15
  assert.equal(info.source, 'order');
  assert.equal(info.tax, 0.75);
});

test('an order taxed an honest 0 yields 0 from the order — the fallback never leaks in', () => {
  const order = { lines: [line(1, 2.5)], tax: 0 };
  const info = returnTaxInfo({ lines: [line(1, 2.5)], order, taxRate: '5.789', taxMode: 'fixed' });
  assert.equal(info.source, 'order');
  assert.equal(info.tax, 0);
});

// ---- The edge: no order tax to derive from -----------------------------------

test('edge — no original order: the fixed set-once rate prices the tax (source: setting)', () => {
  const info = returnTaxInfo({ lines: [line(4, 25)], order: null, taxRate: '5.789', taxMode: 'fixed' });
  assert.equal(info.source, 'setting');
  assert.equal(info.rate, 5.789);
  assert.equal(info.tax, 5.79); // 100 × 5.789%
});

test("edge — order with no tax recorded, Automatic mode: the order's state base rate prices it (source: state)", () => {
  const order = { lines: [line(1, 100)], tax: null, ship_region: 'New Mexico', ship_country: 'US' };
  const info = returnTaxInfo({ lines: [line(1, 100)], order, taxRate: '5.789', taxMode: 'automatic' });
  assert.equal(info.source, 'state');
  assert.equal(info.rate, 4.875);
  assert.equal(info.tax, 4.88);
});

test('edge — order with no tax recorded, fixed mode: the fixed rate prices it (source: setting)', () => {
  const order = { lines: [line(1, 100)], tax: null, ship_region: 'New Mexico', ship_country: 'US' };
  const info = returnTaxInfo({ lines: [line(1, 100)], order, taxRate: '5.789', taxMode: 'fixed' });
  assert.equal(info.source, 'setting');
  assert.equal(info.tax, 5.79);
});

test('edge — an order with no goods cannot give a rate: the fallback prices it', () => {
  const order = { lines: [], tax: 5 };
  const info = returnTaxInfo({ lines: [line(1, 100)], order, taxRate: '5.789', taxMode: 'fixed' });
  assert.equal(info.source, 'setting');
  assert.equal(info.tax, 5.79);
});

test('edge — no order and no rate anywhere: no tax is invented (source: none)', () => {
  const info = returnTaxInfo({ lines: [line(1, 100)], order: null, taxRate: '', taxMode: 'fixed' });
  assert.equal(info.source, 'none');
  assert.equal(info.tax, 0);
  assert.equal(info.rate, null);
});

// ---- (b) + (c) Form wiring (source pins; the rendered flow is the harness's) --

const dialog = read('src/components/returns/ReturnFormDialog.jsx');

test('form: the tax derives live through returnTaxInfo from the picked order + the business tax setting', () => {
  assert.match(dialog, /returnTaxInfo\(\{\s*lines: form\?\.lines \|\| \[\],\s*order: linkedOrder,\s*taxRate,\s*taxMode,/);
  assert.match(dialog, /orders\.find\(\(o\) => o\.id === form\.order_id\)/);
});

test('form: tax pre-fill runs only on a NEW return and stops at the first hand-typed value', () => {
  assert.match(dialog, /if \(!open \|\| record \|\| !form \|\| taxTouched\) return;/);
  assert.match(dialog, /setTaxTouched\(true\);\s*setForm\(\{ \.\.\.form, tax_amount: e\.target\.value \}\)/);
});

test('form: refund pre-fills goods + tax on plain returns only, and a hand edit wins forever', () => {
  assert.match(dialog, /if \(!open \|\| record \|\| !form \|\| refundTouched \|\| form\.kind !== 'return'\) return;/);
  assert.match(dialog, /returnTotals\(form\)\.returnedValue \+ \(Number\(form\.tax_amount\) \|\| 0\)/);
  assert.match(dialog, /setRefundTouched\(true\);\s*setForm\(\{ \.\.\.form, refund_amount: e\.target\.value \}\)/);
});

test('form: the tax is its own visible line — a labeled box and a summary row', () => {
  const occurrences = dialog.split("t('returns.taxOnReturn')").length - 1;
  assert.ok(occurrences >= 2, `tax label appears ${occurrences}× (box + summary)`);
  assert.match(dialog, /taxInfo\.source === 'order' && t\('returns\.taxFromOrder'\)/);
  assert.match(dialog, /taxInfo\.source === 'state' && t\('returns\.taxFromState'\)/);
  assert.match(dialog, /taxInfo\.source === 'setting' && t\('returns\.taxFromSetting'\)/);
  assert.match(dialog, /taxInfo\.source === 'none' && t\('returns\.taxNone'\)/);
});

test('form: the save carries the tax beside the refund', () => {
  assert.match(dialog, /refund_amount: Number\(form\.refund_amount\) \|\| 0,\s*tax_amount: Number\(form\.tax_amount\) \|\| 0,/);
});

test('scan-to-pick: the Returned items ride the shared scanner + code lookup, serialized like the count sheet', () => {
  assert.match(dialog, /import BarcodeScanner from '@\/components\/scan\/BarcodeScanner';/);
  assert.match(dialog, /findProductsByCode\(code, activeId\)/);
  assert.match(dialog, /scanQueueRef\.current\.then\(\(\) => processScan\(code\)\)/);
  assert.match(dialog, /<BarcodeScanner onDetect=\{handleScanDetect\} \/>/);
  assert.match(dialog, /t\('returns\.scanTitle'\)/);
});

test('scan-to-pick: a scan adds the product — +1 when already on the return, the blank line or an append when new', () => {
  assert.match(dialog, /lines\.findIndex\(\(l\) => l\.product_id === product\.id\)/);
  assert.match(dialog, /count = \(Number\(lines\[existing\]\.quantity\) \|\| 0\) \+ 1;/);
  assert.match(dialog, /lines\.findIndex\(\(l\) => !l\.product_id\)/);
  assert.match(dialog, /unit_price: product\.price \?\? '',/);
  assert.match(dialog, /t\('returns\.scanAdded', \{ name:/);
});

test('page: Returns passes the business tax setting into the form', () => {
  const page = read('src/pages/Returns.jsx');
  assert.match(page, /taxRate=\{business\?\.tax_rate \|\| ''\}/);
  assert.match(page, /taxMode=\{business\?\.tax_mode \|\| 'fixed'\}/);
});

// ---- Storage: migration 044 + the entity field --------------------------------

test('storage: migration 044 adds returns.tax_amount and the entity carries it as a number', () => {
  assert.ok(existsSync(new URL('../../migrations/044_return_tax_amount.sql', import.meta.url)));
  const migration = read('migrations/044_return_tax_amount.sql');
  assert.match(migration, /ALTER TABLE returns ADD COLUMN tax_amount NUMERIC NOT NULL DEFAULT 0;/);
  const entities = read('server/entities.js');
  assert.match(entities, /Return: \{\s*table: 'returns',\s*json: \['lines', 'exchange_lines'\],\s*numeric: \['refund_amount', 'tax_amount'\],/);
});

// ---- i18n ---------------------------------------------------------------------

const NEW_KEYS = [
  'returns.scanAdded',
  'returns.scanHint',
  'returns.scanItem',
  'returns.scanTitle',
  'returns.taxFromOrder',
  'returns.taxFromSetting',
  'returns.taxFromState',
  'returns.taxNone',
  'returns.taxOnReturn',
];

test('i18n: all nine new keys exist in the English source and are truly translated in es-MX', () => {
  for (const key of NEW_KEYS) {
    assert.equal(typeof en[key], 'string', `en missing ${key}`);
    assert.ok(en[key].length > 0, `en empty ${key}`);
    assert.equal(typeof esMX[key], 'string', `es-MX missing ${key}`);
    assert.notEqual(esMX[key], en[key], `es-MX carries the English line for ${key} (translation debt)`);
  }
});

// ---- API: the tax figure round-trips, and the 317 gate stands ------------------

async function actor(owner, { email, roleId, roleName }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      business_id: owner.business.id,
      full_name: roleName,
      email,
      role_id: roleId,
      role_name: roleName,
    },
  });
  assert.equal(invite.status, 201, invite.text);
  const account = await registerVerifiedUser(email);
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [
    owner.business.id,
    account.user.id,
  ]);
  const row = (
    await pool.query('SELECT id FROM staff_members WHERE business_id = $1 AND email = $2', [
      owner.business.id,
      email,
    ])
  ).rows[0];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')`,
      [crypto.randomUUID(), owner.business.id, row.id, weekday],
    );
  }
  return { ...account, memberId: row.id };
}

let seq = 0;
async function createReturn(cookie, businessId, values = {}) {
  seq += 1;
  return req('/api/entities/Return', {
    method: 'POST',
    cookie,
    body: {
      business_id: businessId,
      number: `RET-349-${seq}`,
      kind: 'return',
      status: 'new',
      lines: [line(1, 2.5, { condition: 'sellable', restock: true })],
      refund_amount: 2.64,
      tax_amount: 0.14,
      ...values,
    },
  });
}

test('api: a return stores its tax_amount beside the refund and reads it back whole', async () => {
  const owner = await ownerWithBusiness('ret349-owner@example.com', 'Returns Tax Owner', { plan: 'essentials' });
  const created = await createReturn(owner.cookie, owner.business.id);
  assert.equal(created.status, 201, created.text);
  assert.equal(Number(created.json.tax_amount), 0.14);
  assert.equal(Number(created.json.refund_amount), 2.64);
  const { rows } = await pool.query('SELECT tax_amount FROM returns WHERE id = $1', [created.json.id]);
  assert.equal(Number(rows[0].tax_amount), 0.14, 'migration 044 column holds the figure');
});

test('317 gate unregressed: a return is born waiting and approval refuses without returns.complete', async () => {
  const owner = await ownerWithBusiness('ret349-gate-owner@example.com', 'Returns Gate Owner', { plan: 'essentials' });
  const sales = await actor(owner, {
    email: 'ret349-sales@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
  });

  const born = await createReturn(sales.cookie, owner.business.id, { status: 'approved' });
  assert.equal(born.status, 201, born.text);
  assert.equal(born.json.status, 'new', "a non-grant create asking for 'approved' starts at 'new'");

  const approve = await req(`/api/entities/Return/${born.json.id}`, {
    method: 'PATCH',
    cookie: sales.cookie,
    body: { status: 'approved' },
  });
  assert.equal(approve.status, 403, approve.text);
  assert.equal(approve.json.error, 'returns_complete_not_granted');

  const ownerApprove = await req(`/api/entities/Return/${born.json.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { status: 'approved' },
  });
  assert.equal(ownerApprove.status, 200, ownerApprove.text);
  assert.equal(ownerApprove.json.status, 'approved');
});
