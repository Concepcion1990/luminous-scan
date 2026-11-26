/**
 * T70 — Release 378: the paper-trail smalls (the restaurant
 * build-all program, plan release 368; Nov 25, 2026).
 *
 * Three features:
 *   1. SUPPLIER CREDIT MEMOS (Business, the corner's money
 *      shelf): a credit against ONE invoice. The server
 *      derives the supplier snapshot from the invoice, holds
 *      the cap (applied memos never exceed the invoice), and
 *      shapes every invoice read with credit_total +
 *      balance_due. Writes ride restaurant.build.
 *   2. COUNT SHEETS IN SHELF ORDER + the count-sanity
 *      warning (general, both plans): buildSheet walks the
 *      counted place and everything nested in it, in the
 *      location tree's order, each line stamped with its
 *      area; applying a count corrects each line's own area.
 *      The warning (countLooksWrong) ASKS before saving —
 *      proven here to never block: a wildly-off count saves
 *      and submits through the real API unchanged.
 *   3. THE MANAGER LOG BOOK (general, BOTH plans — the
 *      owner's Q2 ruling): entries named by the server with
 *      their writer (never an email, never anonymous, never
 *      rewritable), readable and writable by any trusted
 *      member; the corner's Team & Place shelf cross-links
 *      to it and the Today summary carries its latest three.
 *
 * Proven BY EXECUTION: the credit cap and its guard paths
 * over HTTP (over-cap, exact cap, void frees room, zero and
 * negative amounts, another business's invoice, staff with
 * and without the tick, Essentials refusal); the log book's
 * author stamping over HTTP (owner name, staff name, client
 * forgery overridden, edit cannot rewrite the author,
 * non-member refused); the counts library by executing the
 * shipped src/lib/counts.js source (its Vite alias imports
 * stripped, the real locations helpers injected); the shelf
 * model by import; the translation hard gate for the 63 new
 * keys (all 52 locales, regional Englishes byte-identical,
 * keyset 5908); the training catalogs (116 lessons, the
 * invoices lesson at 5 steps, the log book lesson present
 * in both catalogs at the same position).
 */
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
  createProducts,
} from './helpers.js';
import {
  SHELVES,
  shelfById,
  featureDoors,
  summarizeToday,
  todayHasContent,
} from '../../src/lib/restaurantShelves.js';
import { orderedLocations, descendantIds } from '../../src/lib/locations.js';
import { creditStanding } from '../../server/restaurantOps.js';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as clientCatalog } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as serverCatalog } from '../../server/trainingCatalog.js';

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

async function member(owner, label, roleName = 'Manager') {
  const memberEmail = email(label);
  const invite = await createEntity(owner.cookie, 'StaffMember', {
    business_id: owner.business.id,
    full_name: roleName,
    email: memberEmail,
    role_id: 'preset-manager',
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

async function setOwnerName(owner, name) {
  const res = await req(`/api/businesses/${owner.business.id}/profile-photos/owner-name`, {
    method: 'PUT',
    cookie: owner.cookie,
    body: { name },
  });
  assert.equal(res.status, 200, res.text);
}

/** A Business kitchen: owner, one supplier, one product, one invoice of 100. */
async function kitchen(label) {
  const owner = await ownerWithBusiness(email(label), 'Paper Trail Bistro', { plan: 'business' });
  const bid = owner.business.id;
  const supplier = await createEntity(owner.cookie, 'Supplier', { business_id: bid, name: 'Farm Co' });
  assert.equal(supplier.status, 201, supplier.text);
  const [product] = await createProducts(owner.cookie, bid, [{ name: 'Tomatoes', sku: 'TOM-1', price: 3 }]);
  const invoice = await createEntity(owner.cookie, 'SupplierInvoice', {
    business_id: bid,
    supplier_id: supplier.json.id,
    supplier_name: 'Farm Co',
    invoice_number: 'INV-100',
    lines: [{ product_id: product.id, product_name: 'Tomatoes', quantity: 10, unit_cost: 10 }],
    total: 100,
  });
  assert.equal(invoice.status, 201, invoice.text);
  return { owner, bid, supplier: supplier.json, product, invoice: invoice.json };
}

// ---------------------------------------------------------------------------
// Migration 054.
// ---------------------------------------------------------------------------

test('migration 054 landed: credit_memos and log_book_entries exist', async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT table_name FROM information_schema.tables
      WHERE table_name IN ('credit_memos', 'log_book_entries') ORDER BY table_name`,
  );
  assert.deepEqual(rows.map((r) => r.table_name), ['credit_memos', 'log_book_entries']);
});

// ---------------------------------------------------------------------------
// Credit memos by HTTP.
// ---------------------------------------------------------------------------

test('credit memos: the cap holds, the snapshot is the server\u2019s, voiding frees room', async () => {
  const k = await kitchen('cap');

  // A memo naming a DIFFERENT supplier: the server derives
  // the snapshot from the invoice, never from the client.
  const memo30 = await createEntity(k.owner.cookie, 'CreditMemo', {
    business_id: k.bid,
    invoice_id: k.invoice.id,
    supplier_name: 'Forged Supplier',
    amount: 30,
    reason: 'Damaged case',
  });
  assert.equal(memo30.status, 201, memo30.text);
  assert.equal(memo30.json.supplier_name, 'Farm Co', 'the supplier snapshot comes from the invoice');
  assert.equal(memo30.json.supplier_id, k.supplier.id);
  assert.equal(memo30.json.invoice_number, 'INV-100');
  assert.equal(memo30.json.status, 'applied');

  // The invoice read carries the standing.
  let read = await req(`/api/entities/SupplierInvoice/${k.invoice.id}`, { cookie: k.owner.cookie });
  assert.equal(read.json.credit_total, 30);
  assert.equal(read.json.balance_due, 70);

  // Over the cap: refused with the cap wording.
  const over = await createEntity(k.owner.cookie, 'CreditMemo', {
    business_id: k.bid,
    invoice_id: k.invoice.id,
    amount: 80,
  });
  assert.equal(over.status, 400, over.text);
  assert.equal(over.json.error, 'credit_exceeds_invoice');

  // To the exact cap: allowed.
  const memo70 = await createEntity(k.owner.cookie, 'CreditMemo', {
    business_id: k.bid,
    invoice_id: k.invoice.id,
    amount: 70,
  });
  assert.equal(memo70.status, 201, memo70.text);
  read = await req(`/api/entities/SupplierInvoice/${k.invoice.id}`, { cookie: k.owner.cookie });
  assert.equal(read.json.credit_total, 100);
  assert.equal(read.json.balance_due, 0);

  // One cent past a full invoice: refused.
  const past = await createEntity(k.owner.cookie, 'CreditMemo', {
    business_id: k.bid,
    invoice_id: k.invoice.id,
    amount: 0.01,
  });
  assert.equal(past.status, 400, past.text);

  // Voiding the 70 frees its room again.
  const voided = await req(`/api/entities/CreditMemo/${memo70.json.id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: { status: 'void' },
  });
  assert.equal(voided.status, 200, voided.text);
  read = await req(`/api/entities/SupplierInvoice/${k.invoice.id}`, { cookie: k.owner.cookie });
  assert.equal(read.json.credit_total, 30, 'a void memo counts nothing');
  assert.equal(read.json.balance_due, 70);
  const again = await createEntity(k.owner.cookie, 'CreditMemo', {
    business_id: k.bid,
    invoice_id: k.invoice.id,
    amount: 70,
  });
  assert.equal(again.status, 201, again.text);

  // Editing a memo past the cap is refused too (the 30 -> 31
  // edit would take applied credits to 101).
  const edit = await req(`/api/entities/CreditMemo/${memo30.json.id}`, {
    method: 'PATCH',
    cookie: k.owner.cookie,
    body: { amount: 31 },
  });
  assert.equal(edit.status, 400, edit.text);
  assert.equal(edit.json.error, 'credit_exceeds_invoice');
});

test('credit memos: bad amounts and foreign invoices are refused', async () => {
  const k = await kitchen('guards');
  const other = await kitchen('guards-other');

  for (const amount of [0, -5]) {
    const res = await createEntity(k.owner.cookie, 'CreditMemo', {
      business_id: k.bid,
      invoice_id: k.invoice.id,
      amount,
    });
    assert.equal(res.status, 400, `amount ${amount}: ${res.text}`);
    assert.equal(res.json.error, 'invalid_amount');
  }

  const foreign = await createEntity(k.owner.cookie, 'CreditMemo', {
    business_id: k.bid,
    invoice_id: other.invoice.id,
    amount: 10,
  });
  assert.equal(foreign.status, 400, foreign.text);
  assert.equal(foreign.json.error, 'invalid_reference');
});

test('credit memos: staff need the restaurant.build tick; Essentials never sees them', async () => {
  const k = await kitchen('ticks');
  const staff = await member(k.owner, 'memo-clerk', 'Clerk');

  const refused = await createEntity(staff.cookie, 'CreditMemo', {
    business_id: k.bid,
    invoice_id: k.invoice.id,
    amount: 10,
  });
  assert.equal(refused.status, 403, refused.text);

  await grantTicks(k.owner, staff.memberId, ['restaurant.build']);
  const allowed = await createEntity(staff.cookie, 'CreditMemo', {
    business_id: k.bid,
    invoice_id: k.invoice.id,
    amount: 10,
  });
  assert.equal(allowed.status, 201, allowed.text);

  const ess = await ownerWithBusiness(email('memo-ess'), 'Corner Store', { plan: 'essentials' });
  const gated = await createEntity(ess.cookie, 'CreditMemo', {
    business_id: ess.business.id,
    invoice_id: k.invoice.id,
    amount: 10,
  });
  assert.equal(gated.status, 403, gated.text);
  const list = await queryEntity(ess.cookie, 'CreditMemo', { business_id: ess.business.id });
  assert.deepEqual(list.json.items, [], 'Essentials lists no credit memos');
});

test('credit standing math: stored total, summed lines, void and self-exclusion', () => {
  const invoice = { total: 100, lines: [] };
  const memos = [
    { id: 'a', amount: 30, status: 'applied' },
    { id: 'b', amount: 70, status: 'void' },
    { id: 'c', amount: '10.005', status: 'applied' },
  ];
  assert.deepEqual(creditStanding(invoice, memos), { total: 100, credited: 40.01, owed: 59.99 });
  assert.deepEqual(creditStanding(invoice, memos, 'a'), { total: 100, credited: 10.01, owed: 89.99 });
  const noTotal = { lines: [{ quantity: 2, unit_cost: 25 }, { quantity: 1, unit_cost: 10 }] };
  assert.deepEqual(creditStanding(noTotal, []), { total: 60, credited: 0, owed: 60 });
  assert.deepEqual(creditStanding(null, memos), { total: 0, credited: 0, owed: 0 });
});

// ---------------------------------------------------------------------------
// The manager log book by HTTP.
// ---------------------------------------------------------------------------

test('log book: entries are named by the server — owner, staff, forgery-proof', async () => {
  const owner = await ownerWithBusiness(email('log-owner'), 'Log Book Store', { plan: 'essentials' });
  const bid = owner.business.id;
  await setOwnerName(owner, 'Concepcion');

  // Essentials in full: the log book is a general feature.
  const mine = await createEntity(owner.cookie, 'LogBookEntry', {
    business_id: bid,
    body: 'Freezer ran warm overnight; moved the milk to the front cooler.',
    shift_label: 'Tuesday close',
    author_name: 'Forged Name',
  });
  assert.equal(mine.status, 201, mine.text);
  assert.equal(mine.json.author_name, 'Concepcion', 'the server stamps the writer, never the client\u2019s claim');
  assert.ok(!mine.json.author_name.includes('@'), 'the displayed author is a name, never an email');

  // An edit can change the words, never the name on them.
  const edited = await req(`/api/entities/LogBookEntry/${mine.json.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { body: 'Freezer ran warm; milk moved, repair called.', author_name: 'Someone Else' },
  });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.json.body, 'Freezer ran warm; milk moved, repair called.');
  assert.equal(edited.json.author_name, 'Concepcion', 'the author never changes');

  // A staff member writes under their own staff name.
  const staff = await member(owner, 'log-clerk', 'Stock Clerk');
  const theirs = await createEntity(staff.cookie, 'LogBookEntry', {
    business_id: bid,
    body: 'Delivery came at noon, two cases short.',
  });
  assert.equal(theirs.status, 201, theirs.text);
  assert.equal(theirs.json.author_name, 'Stock Clerk');

  // Empty body is refused; a non-member is refused.
  const empty = await createEntity(owner.cookie, 'LogBookEntry', { business_id: bid, body: '  ' });
  assert.equal(empty.status, 400, empty.text);
  const stranger = await ownerWithBusiness(email('log-stranger'), 'Other Store', { plan: 'essentials' });
  const foreign = await createEntity(stranger.cookie, 'LogBookEntry', {
    business_id: bid,
    body: 'I do not work here.',
  });
  assert.equal(foreign.status, 403, foreign.text);

  // Before the owner sets a name, entries are stamped "Owner".
  const fresh = await ownerWithBusiness(email('log-fresh'), 'Fresh Store', { plan: 'business' });
  const anon = await createEntity(fresh.cookie, 'LogBookEntry', {
    business_id: fresh.business.id,
    body: 'First night open.',
  });
  assert.equal(anon.status, 201, anon.text);
  assert.equal(anon.json.author_name, 'Owner');
});

// ---------------------------------------------------------------------------
// Counts: the library, executed from the shipped source.
// ---------------------------------------------------------------------------

function loadCountsLib() {
  const source = fs.readFileSync(new URL('../../src/lib/counts.js', import.meta.url), 'utf8');
  const stripped = source
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '');
  const exports = {};
  const run = new Function(
    'exports', 'base44', 'recordMovement', 'todayIso', 'descendantIds', 'orderedLocations', 't',
    `${stripped}
     exports.buildSheet = buildSheet; exports.countWalkAreas = countWalkAreas;
     exports.countLooksWrong = countLooksWrong; exports.wildCountLines = wildCountLines;
     exports.shelfOrderProducts = shelfOrderProducts; exports.tallyCountedLine = tallyCountedLine;`,
  );
  run(exports, { entities: {} }, async () => {}, () => '2026-11-25', descendantIds, orderedLocations, (key) => key);
  return exports;
}

const WALK_LOCATIONS = [
  { id: 'store', name: 'Store', parent_id: '' },
  { id: 'shelf-b', name: 'Shelf B', parent_id: 'store' },
  { id: 'shelf-a', name: 'Shelf A', parent_id: 'store' },
];
const WALK_PRODUCTS = [
  { id: 'p1', name: 'Beans', sku: 'B-1', category: 'Food' },
  { id: 'p2', name: 'Rice', sku: 'R-1', category: 'Food' },
  { id: 'p3', name: 'Tea', sku: 'T-1', category: 'Drinks' },
];
const WALK_LEVELS = [
  { product_id: 'p2', location_id: 'store', quantity: 3 },
  { product_id: 'p2', location_id: 'shelf-a', quantity: 2 },
  { product_id: 'p1', location_id: 'shelf-b', quantity: 5 },
];

test('counts lib: the sheet walks the counted place and its shelves, in walk order', () => {
  const lib = loadCountsLib();
  const lines = lib.buildSheet({
    products: WALK_PRODUCTS,
    levels: WALK_LEVELS,
    locations: WALK_LOCATIONS,
    locationId: 'store',
  });
  assert.deepEqual(
    lines.map((l) => `${l.product_id}@${l.location_id}:${l.expected}`),
    ['p2@store:3', 'p2@shelf-a:2', 'p1@shelf-b:5'],
    'area walk order (store, Shelf A, Shelf B), each line stamped with its area',
  );
  assert.equal(lines[1].location_name, 'Shelf A');

  // Single-place parity: no locations passed, the sheet is
  // exactly what counts have always built.
  const legacy = lib.buildSheet({ products: WALK_PRODUCTS, levels: WALK_LEVELS, locationId: 'store' });
  assert.deepEqual(
    legacy.map((l) => `${l.product_id}:${l.expected}`),
    ['p2:3'],
    'only what is on hand at the counted place itself',
  );

  // A category count keeps the whole category: a product
  // stocked nowhere in the walk joins the counted place at 0.
  const category = lib.buildSheet({
    products: WALK_PRODUCTS,
    levels: WALK_LEVELS,
    locations: WALK_LOCATIONS,
    locationId: 'store',
    category: 'Drinks',
  });
  assert.deepEqual(
    category.map((l) => `${l.product_id}@${l.location_id}:${l.expected}`),
    ['p3@store:0'],
  );
  const food = lib.buildSheet({
    products: WALK_PRODUCTS,
    levels: WALK_LEVELS,
    locations: WALK_LOCATIONS,
    locationId: 'store',
    category: 'Food',
  });
  assert.deepEqual(
    food.map((l) => `${l.product_id}@${l.location_id}:${l.expected}`),
    ['p2@store:3', 'p2@shelf-a:2', 'p1@shelf-b:5'],
  );
});

test('counts lib: the sanity warning asks at wild numbers and only there', () => {
  const lib = loadCountsLib();
  const line = (expected, counted) => ({ product_id: 'x', product_name: 'X', expected, counted });
  assert.equal(lib.countLooksWrong(line(5, 6)), false, 'an ordinary difference never trips it');
  assert.equal(lib.countLooksWrong(line(5, 15)), true, 'ten away and triple');
  assert.equal(lib.countLooksWrong(line(100, 40)), true, 'sixty away and under half');
  assert.equal(lib.countLooksWrong(line(100, 60)), false, 'forty away but within half-to-double');
  assert.equal(lib.countLooksWrong(line(0, 9)), false);
  assert.equal(lib.countLooksWrong(line(0, 10)), true, 'stock from nowhere');
  assert.equal(lib.countLooksWrong(line(3, null)), false, 'uncounted lines never trip it');
  assert.deepEqual(lib.wildCountLines([line(5, 6), line(5, 15), line(0, 12)]).length, 2);

  // Scan tally lands on the FIRST line in walk order.
  const sheet = [
    { product_id: 'p2', location_id: 'store', counted: 1 },
    { product_id: 'p2', location_id: 'shelf-a', counted: 4 },
  ];
  const tallied = lib.tallyCountedLine(sheet, { id: 'p2', name: 'Rice', sku: 'R-1' }, 3);
  assert.equal(tallied[0].counted, 2);
  assert.equal(tallied[1].counted, 4, 'the second area\u2019s line is untouched by the tally');
});

test('counts lib: the printed sheet groups by primary storage area in walk order', () => {
  const lib = loadCountsLib();
  const groups = lib.shelfOrderProducts(WALK_PRODUCTS, WALK_LEVELS, WALK_LOCATIONS);
  assert.deepEqual(
    groups.map((g) => `${g.area ? g.area.id : 'none'}:${g.products.map((p) => p.id).join(',')}`),
    ['store:p2', 'shelf-b:p1', 'none:p3'],
    'primary area first in walk order, unstocked last and ungrouped',
  );
});

test('counts by HTTP: a wild count saves and submits — the warning never blocks', async () => {
  const owner = await ownerWithBusiness(email('wild'), 'Wild Count Store', { plan: 'essentials' });
  const bid = owner.business.id;
  const [product] = await createProducts(owner.cookie, bid, [{ name: 'Bookmark', sku: 'BM-W', price: 9 }]);
  const session = await createEntity(owner.cookie, 'CountSession', {
    business_id: bid,
    number: 'CNT-WILD-1',
    status: 'open',
    lines: [{ product_id: product.id, product_name: 'Bookmark', sku: 'BM-W', expected: 1, counted: 50 }],
  });
  assert.equal(session.status, 201, session.text);
  const saved = await req(`/api/entities/CountSession/${session.json.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { lines: session.json.lines },
  });
  assert.equal(saved.status, 200, saved.text);
  const submitted = await req(`/api/entities/CountSession/${session.json.id}`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { status: 'review' },
  });
  assert.equal(submitted.status, 200, submitted.text);
  assert.equal(submitted.json.status, 'review', 'the server accepts the wild count exactly as counted');
});

// ---------------------------------------------------------------------------
// The shelf model: the two new cross-links + the Today log book.
// ---------------------------------------------------------------------------

test('shelf model: counts and the log book cross-link from their shelves; primaries unchanged', () => {
  const stock = shelfById('stock');
  const counts = stock.doors.find((d) => d.to === '/counts');
  assert.ok(counts && counts.crossLink === true, 'Stock & Ordering cross-links to the general Counts page');
  assert.equal(counts.titleKey, 'nav.counts');
  const team = shelfById('team');
  const log = team.doors.find((d) => d.to === '/log-book');
  assert.ok(log && log.crossLink === true, 'Team & Place cross-links to the manager log book');
  assert.equal(log.titleKey, 'nav.logBook');
  assert.equal(featureDoors().length, 14, 'the corner still has exactly fourteen primary feature doors');
  assert.deepEqual(SHELVES.map((s) => s.id), ['kitchen', 'stock', 'money', 'safety', 'floor', 'team']);
});

test('today summary: the log book\u2019s latest three ride along', () => {
  const entries = [
    { body: 'oldest', author_name: 'A', created_date: '2026-11-24T08:00:00.000Z' },
    { body: 'newest', author_name: 'B', created_date: '2026-11-25T09:00:00.000Z' },
    { body: 'middle', author_name: 'C', created_date: '2026-11-25T07:00:00.000Z' },
    { body: 'fourth', author_name: 'D', created_date: '2026-11-23T07:00:00.000Z' },
  ];
  const summary = summarizeToday({ logEntries: entries });
  assert.deepEqual(summary.logBook.map((e) => e.body), ['newest', 'middle', 'oldest']);
  assert.equal(todayHasContent(summary), true, 'a log entry alone gives Today something to say');
  const bare = summarizeToday({});
  assert.deepEqual(bare.logBook, [], 'no entries, no card — the default keeps older calls valid');
  assert.equal(todayHasContent(bare), false);
});

// ---------------------------------------------------------------------------
// The translation hard gate + plan presentation + training.
// ---------------------------------------------------------------------------

const NEW_KEYS = [
  'nav.logBook',
  'logBook.title', 'logBook.subtitle', 'logBook.addButton', 'logBook.saveButton',
  'logBook.bodyLabel', 'logBook.bodyPlaceholder', 'logBook.shiftLabel', 'logBook.shiftPlaceholder',
  'logBook.searchPlaceholder', 'logBook.emptyTitle', 'logBook.emptyBody', 'logBook.noResults',
  'logBook.saved', 'logBook.deleted', 'logBook.deleteConfirm', 'logBook.saveFailed',
  'logBook.needBody', 'logBook.editTitle',
  'ops.invoices.creditApplied', 'ops.invoices.stillOwed',
  'ops.credits.title', 'ops.credits.subtitle', 'ops.credits.newButton', 'ops.credits.emptyTitle',
  'ops.credits.emptyBody', 'ops.credits.colInvoice', 'ops.credits.colAmount',
  'ops.credits.statusApplied', 'ops.credits.statusVoid', 'ops.credits.voidButton',
  'ops.credits.voidConfirm', 'ops.credits.saved', 'ops.credits.voided', 'ops.credits.newTitle',
  'ops.credits.editTitle', 'ops.credits.dialogIntro', 'ops.credits.invoiceLabel',
  'ops.credits.invoicePick', 'ops.credits.amountLabel', 'ops.credits.creditNumberLabel',
  'ops.credits.dateLabel', 'ops.credits.reasonLabel', 'ops.credits.remainingLine',
  'ops.credits.exceedsError', 'ops.credits.needInvoice', 'ops.credits.needAmount',
  'ops.credits.saveFailed', 'ops.credits.save',
  'counts.wrongConfirm', 'counts.wrongLine',
  'restaurant.doorCounts', 'restaurant.doorLogBook',
  'plansLib.includes.logBook',
  'apiErrors.creditMemo.invoiceMustBelongBusiness', 'apiErrors.creditMemo.amountGreaterThanZero',
  'apiErrors.creditMemo.cannotExceedInvoice',
  'training.lessons.staff-log-book.title', 'training.lessons.staff-log-book.step1',
  'training.lessons.staff-log-book.step2', 'training.lessons.staff-log-book.step3',
  'training.lessons.staff-log-book.step4',
  'training.lessons.mgr-restaurant-invoices.step5',
];

test('i18n gate: 63 new keys in all 52 locales, keyset 5913, plan lines carry the new features', () => {
  assert.equal(NEW_KEYS.length, 63);
  for (const [code, locale] of Object.entries(LOCALES)) {
    assert.equal(Object.keys(locale).length, 5913, `${code} keyset`);
    for (const key of NEW_KEYS) {
      assert.ok(typeof locale[key] === 'string' && locale[key].length > 0, `${code} carries ${key}`);
    }
    assert.ok(
      locale['plansLib.businessIncludes.restaurantMoney'].length >
        'Restaurant, Invoices & Money'.length,
      `${code} money line present`,
    );
  }
  for (const code of ['en-GB', 'en-CA', 'en-AU', 'en-IN']) {
    for (const key of NEW_KEYS) {
      assert.equal(LOCALES[code][key], en[key], `${code} is byte-identical to en for ${key}`);
    }
    assert.equal(
      LOCALES[code]['plansLib.businessIncludes.restaurantMoney'],
      en['plansLib.businessIncludes.restaurantMoney'],
      `${code} money line byte-identical`,
    );
    assert.equal(
      LOCALES[code]['plansLib.businessIncludes.restaurantStock'],
      en['plansLib.businessIncludes.restaurantStock'],
      `${code} stock line byte-identical`,
    );
  }
  assert.ok(en['plansLib.businessIncludes.restaurantMoney'].endsWith('supplier credit memos'));
  assert.ok(en['plansLib.businessIncludes.restaurantStock'].endsWith('count sheets in shelf order'));
  assert.ok(en['plansLib.includes.logBook'].startsWith('Manager log book'));
});

test('training: 116 lessons, catalogs agree, the log book lesson and the invoices step 5 ride along', () => {
  assert.equal(clientCatalog.length, 116);
  assert.deepEqual(
    serverCatalog.map((l) => l.id),
    clientCatalog.map((l) => l.id),
    'client and server catalogs agree lesson for lesson, in order',
  );
  const invoices = clientCatalog.find((l) => l.id === 'mgr-restaurant-invoices');
  assert.equal(invoices.steps, 5, 'the invoices lesson teaches credit memos as step 5');
  const logLesson = clientCatalog.find((l) => l.id === 'staff-log-book');
  assert.ok(logLesson, 'the log book lesson exists');
  assert.equal(logLesson.track, 'staff');
  assert.equal(logLesson.module, 'workforce');
  assert.equal(logLesson.steps, 4);
  assert.equal(logLesson.feature, undefined, 'a general feature: no plan gate on its lesson');
  const countsIndex = clientCatalog.findIndex((l) => l.id === 'counts-run');
  assert.equal(clientCatalog[countsIndex + 1].id, 'staff-log-book', 'the lesson sits right after counts-run in both catalogs');
  assert.equal(serverCatalog[countsIndex + 1].id, 'staff-log-book');
});
