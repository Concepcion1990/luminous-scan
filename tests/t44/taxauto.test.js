// Release 347 (Nov 22, 2026): tax AUTOMATIC-BY-STATE.
//  - Storage: businesses.tax_mode (migration 043), default
//    'fixed' — nothing changes for anyone until they opt in.
//  - The mode switch rides the SAME door as the rate: owner,
//    or a member holding the settings.taxRate enrollment tick
//    (SETTINGS_GRANT_BY_FIELD maps tax_mode to it). An unticked
//    manager's switch is refused 403; a bad value is refused
//    400 whole.
//  - The table: src/lib/stateTaxRates.js — US state BASE
//    sales-tax rates, 50 states + DC, Tax Foundation midyear
//    2026 (rates in effect July 1, 2026), spot-verified
//    against NM TRD (4.875) and SD DOR (4.2).
//  - The fill: in Automatic, a NEW order's tax comes from the
//    customer's state the moment the state is on the order and
//    re-fills on state change — but only while the Tax box is
//    untouched; the first hand-typed value wins for that order
//    and is never fought (the taxTouched discipline, pinned by
//    source below and proven in the browser harness). No state
//    / non-US falls back to the workspace's fixed rate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { ownerWithBusiness, registerVerifiedUser, req, pool, close } from './helpers.js';
import { US_STATE_TAX_RATES, resolveStateTaxRate } from '../../src/lib/stateTaxRates.js';
import { parseTaxRate, computeOrderTax } from '../../src/lib/taxRate.js';

after(close);

// ---- The table ---------------------------------------------------------------

test('the state table: all 50 states + DC, every rate numeric', () => {
  assert.equal(US_STATE_TAX_RATES.length, 51);
  const codes = new Set(US_STATE_TAX_RATES.map((s) => s.code));
  assert.equal(codes.size, 51, 'codes are unique');
  for (const s of US_STATE_TAX_RATES) {
    assert.match(s.code, /^[A-Z]{2}$/);
    assert.ok(typeof s.name === 'string' && s.name.length > 0);
    assert.ok(Number.isFinite(s.rate) && s.rate >= 0 && s.rate < 20, `${s.code} rate sane`);
  }
  const by = Object.fromEntries(US_STATE_TAX_RATES.map((s) => [s.code, s.rate]));
  assert.equal(by.CA, 7.25);
  assert.equal(by.TX, 6.25);
  assert.equal(by.NM, 4.875, 'NM official (TRD / NMSA 7-9-4)');
  assert.equal(by.SD, 4.2, 'SD official (DOR guide, July 2026 — the temporary cut)');
  assert.equal(by.LA, 5);
  assert.equal(by.DC, 6);
  assert.equal(by.DE, 0, 'Delaware has no state sales tax — 0 is a real rate');
  assert.equal(by.OR, 0);
  assert.equal(by.MT, 0);
  assert.equal(by.NH, 0);
  assert.equal(by.AK, 0);
});

test('the resolver: code or full name, case-insensitive; non-US never resolves', () => {
  assert.equal(resolveStateTaxRate('CA', 'US')?.rate, 7.25);
  assert.equal(resolveStateTaxRate('ca', '')?.rate, 7.25, 'blank country still resolves (the form default)');
  assert.equal(resolveStateTaxRate('California', 'United States')?.rate, 7.25);
  assert.equal(resolveStateTaxRate('new mexico', 'U.S.A.')?.rate, 4.875);
  assert.equal(resolveStateTaxRate(' District of Columbia ', 'us')?.rate, 6);
  assert.equal(resolveStateTaxRate('TX', 'Canada'), null, 'a named non-US country never resolves');
  assert.equal(resolveStateTaxRate('Texas', 'Mexico'), null);
  assert.equal(resolveStateTaxRate('', 'US'), null, 'no state, no rate — the fixed fallback rules');
  assert.equal(resolveStateTaxRate('XX', 'US'), null, 'an unknown region never resolves');
  assert.equal(resolveStateTaxRate(null, null), null);
});

// ---- The fill math (the same composition the order form performs) -------------

test('fill math: state rate in Automatic, fixed fallback without a state, re-fill on change', () => {
  const fixed = parseTaxRate('5.789');
  // Automatic + a state on the order: the state rate drives the tax.
  const ca = resolveStateTaxRate('CA', 'US');
  assert.equal(computeOrderTax(100, ca.rate), 7.25);
  // State changes: the rate re-fills from the new state.
  const tx = resolveStateTaxRate('TX', 'US');
  assert.equal(computeOrderTax(100, tx.rate), 6.25);
  // Automatic + no state (or non-US): the workspace fixed rate rules.
  assert.equal(resolveStateTaxRate('', 'US'), null);
  assert.equal(computeOrderTax(100, fixed), 5.79);
  // A no-tax state is a real fill, not a fallback: Delaware fills 0.
  const de = resolveStateTaxRate('DE', 'US');
  assert.ok(de && de.rate === 0);
  assert.equal(computeOrderTax(100, de.rate), 0);
});

// ---- The mode door --------------------------------------------------------------

let owner;
before(async () => {
  owner = await ownerWithBusiness('taxauto-owner@example.com', 'Tax Auto Owner', { plan: 'essentials' });
});

test('mode default is Fixed — a fresh business changes nothing for anyone', async () => {
  const listed = await req('/api/businesses', { cookie: owner.cookie });
  assert.equal(listed.json.items[0].tax_mode, 'fixed');
  const { rows } = await pool.query('SELECT tax_mode FROM businesses WHERE id = $1', [owner.business.id]);
  assert.equal(rows[0].tax_mode, 'fixed', 'migration 043 default');
});

test('the owner switches the mode; a bad value is refused whole', async () => {
  const patch = (body) => req(`/api/businesses/${owner.business.id}`, { method: 'PATCH', body, cookie: owner.cookie });
  const on = await patch({ tax_mode: 'automatic' });
  assert.equal(on.status, 200);
  assert.equal(on.json.tax_mode, 'automatic');
  const bad = await patch({ tax_mode: 'weekly' });
  assert.equal(bad.status, 400);
  const listed = await req('/api/businesses', { cookie: owner.cookie });
  assert.equal(listed.json.items[0].tax_mode, 'automatic', 'the refused value never landed');
  const off = await patch({ tax_mode: 'fixed' });
  assert.equal(off.status, 200);
  assert.equal(off.json.tax_mode, 'fixed');
});

// Team-member fixtures, the t7 shape: a staff_members row plus a
// verified account whose active business is the shop. The
// manager's requests ride inside a live shift window.
const TZ_CANDIDATES = [
  'Pacific/Kiritimati', 'Pacific/Auckland', 'Australia/Sydney', 'Asia/Tokyo',
  'Asia/Shanghai', 'Asia/Jakarta', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/Moscow',
  'Europe/Paris', 'UTC', 'Atlantic/Azores', 'America/Sao_Paulo', 'America/New_York',
  'America/Mexico_City', 'America/Denver', 'America/Los_Angeles', 'Pacific/Honolulu',
];
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function localNow(tz) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())) parts[p.type] = p.value;
  return { weekday: WEEKDAY_INDEX[parts.weekday], minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
function pickTimezone() {
  for (const tz of TZ_CANDIDATES) {
    const { minutes } = localNow(tz);
    if (minutes >= 480 && minutes <= 900) return tz;
  }
  return 'UTC';
}
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

async function addManager(business, ownerId, email, permissions) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO staff_members (id, business_id, full_name, email, app_role, role_id, role_name, permissions, status, created_by_id)
     VALUES ($1, $2, 'Manny Manager', $3, 'user', 'preset-manager', 'Manager', $4, 'active', $5)`,
    [id, business.id, email, JSON.stringify(permissions), ownerId],
  );
  const account = await registerVerifiedUser(email);
  await pool.query('UPDATE users SET active_business_id = $1 WHERE id = $2', [business.id, account.user.id]);
  return { staffId: id, cookie: account.cookie };
}

test('the gate: an unticked manager cannot switch the mode; the tax tick can', async () => {
  const tz = pickTimezone();
  await pool.query('UPDATE businesses SET timezone = $1 WHERE id = $2', [tz, owner.business.id]);
  const { weekday, minutes } = localNow(tz);
  const liveShift = async (staffId) => {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (business_id, staff_member_id, weekday) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
      [crypto.randomUUID(), owner.business.id, staffId, weekday, hhmm(minutes - 30), hhmm(minutes + 120)],
    );
  };

  const unticked = await addManager(owner.business, owner.user.id, 'taxauto-mgr-notick@example.com', []);
  await liveShift(unticked.staffId);
  const refused = await req(`/api/businesses/${owner.business.id}`, {
    method: 'PATCH', body: { tax_mode: 'automatic' }, cookie: unticked.cookie,
  });
  assert.equal(refused.status, 403, 'no settings.taxRate tick, no mode switch');
  const after1 = await req('/api/businesses', { cookie: owner.cookie });
  assert.equal(after1.json.items[0].tax_mode, 'fixed', 'the refused switch never landed');

  const ticked = await addManager(owner.business, owner.user.id, 'taxauto-mgr-tick@example.com', ['settings.taxRate']);
  await liveShift(ticked.staffId);
  const saved = await req(`/api/businesses/${owner.business.id}`, {
    method: 'PATCH', body: { tax_mode: 'automatic' }, cookie: ticked.cookie,
  });
  assert.equal(saved.status, 200, 'the settings.taxRate tick carries the mode switch');
  assert.equal(saved.json.tax_mode, 'automatic');
  // Leave the fixture as the owner tests left it.
  await req(`/api/businesses/${owner.business.id}`, {
    method: 'PATCH', body: { tax_mode: 'fixed' }, cookie: owner.cookie,
  });
});

// ---- Wiring pins ------------------------------------------------------------------

test('wiring: the mode switch on both Settings doors, the save payload, the order-form discipline', () => {
  const details = readFileSync('src/components/business/DetailsCard.jsx', 'utf8');
  assert.match(details, /id="business-tax-mode"/);
  assert.match(details, /settings\.details\.taxMode/);
  assert.match(details, /settings\.details\.taxModeHint/);
  const personal = readFileSync('src/components/business/PersonalSettings.jsx', 'utf8');
  assert.match(personal, /id="granted-tax-mode"/);
  assert.match(personal, /tax_mode: mode/);
  const business = readFileSync('src/lib/business.js', 'utf8');
  assert.match(business, /tax_mode: values\.tax_mode === 'automatic' \? 'automatic' : 'fixed'/);
  // The order form: the state entry drives the effective rate in
  // CREATE mode only; the untouched discipline (taxTouched) is
  // what makes a hand-typed tax win and never be fought.
  const dialog = readFileSync('src/components/orders/OrderFormDialog.jsx', 'utf8');
  assert.match(dialog, /resolveStateTaxRate\(form\.ship_region, form\.ship_country\)/);
  assert.match(dialog, /!order && taxMode === 'automatic'/);
  assert.match(dialog, /effectiveTaxRate = stateEntry \? stateEntry\.rate : taxRate/);
  assert.match(dialog, /orders\.taxStateRate/);
  assert.match(dialog, /orders\.taxAutoNoState/);
  assert.match(dialog, /orders\.taxAutoAddState/);
  const plans = readFileSync('src/lib/plans.js', 'utf8');
  assert.equal(plans.split("t('plansLib.includes.taxAuto')").length - 1, 3, 'Essentials lists x2 + the comparison row');
  for (const catalog of ['src/lib/trainingCatalog.js', 'server/trainingCatalog.js']) {
    const src = readFileSync(catalog, 'utf8');
    assert.match(src, /\{ id: 'owner-tax-rate', track: 'owner', module: 'orders', heading: 'general', steps: 4[ ,]/);
    assert.match(src, /\{ id: 'mgr-tax-rate', track: 'manager', module: 'orders', heading: 'general', steps: 5[ ,]/);
  }
});
