/**
 * T54 — release 357, TIME TRAILS (Nov 23, 2026).
 *
 * The owner's spec: every record that moves through stages
 * carries a visible trail of stamps — DATE + TIME on every
 * stamp; orders also record WHO performed each stage (a display
 * name, never an email). Counts: Created · Saved · Sent for
 * review · Approved/Applied · Cancelled. Orders: Created ·
 * Packed · Shipped · Delivered · Cancelled. Returns: Logged ·
 * Approved · Completed · Rejected, printed on the Return
 * document. Business exports carry an "Exported at" stamp
 * INSIDE the file.
 *
 * What this group pins:
 *  - migration 045's columns exist;
 *  - the SERVER stamps at the transition (its own clock, the
 *    caller's session) — a stamp the client sends is stripped,
 *    never trusted, and re-saving a stage never re-stamps it;
 *  - a count's lines-save stamps Saved, including a floor save
 *    by a member without counts.run (the shared board);
 *  - a return born approved/completed is stamped at creation;
 *  - actor names resolve at READ time from the stored user id:
 *    a renamed owner reads renamed; an actor whose staff row is
 *    gone resolves to the empty marker (the client's neutral
 *    "Former team member" fallback), never a stale name, never
 *    an email;
 *  - legacy rows keep honest history (a pre-357 shipped stamp
 *    with no actor id reads back untouched, actor null);
 *  - exports: the CSV ends with the trailing stamp line and
 *    the header still leads; the XLSX carries the footer row;
 *    parseCsv and the XLSX reader drop the stamp again on
 *    re-import, so an exported file re-imports clean;
 *  - the six trail.* keys exist ×52 with the keyset at 5136 (5308 since the restaurant batch; 5333 since cross-store messages; 5723 since restaurant operations).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { req, pool, base, close } from './helpers.js';
import { trailOwner, trailActor } from './helpers.js';
import { parseCsv } from '../../src/lib/csvImport.js';
import { buildWorkbook, readWorkbookFile } from '../../src/lib/xlsx.js';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { esMX } from '../../src/lib/locales/es-MX.js';

after(close);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FORGED = '2001-01-01T00:00:00.000Z';
const nearNow = (value) => {
  assert.ok(value, 'stamp exists');
  const delta = Math.abs(Date.now() - new Date(value).getTime());
  assert.ok(delta < 120000, `stamp ${value} is the server's now (delta ${delta}ms), not a client claim`);
};

// ---- migration 045 -----------------------------------------------------------

test('migration 045: the trail columns exist on orders, returns and count_sessions', async () => {
  // Selecting the exact columns is the proof: a missing column
  // fails the query outright.
  await pool.query('SELECT packed_at, packed_by, packed_by_id, delivered_at, delivered_by, delivered_by_id, cancelled_by, cancelled_by_id, shipped_by_id FROM orders LIMIT 0');
  await pool.query('SELECT rejected_at, rejected_by, rejected_by_id, approved_by_id, completed_by_id FROM returns LIMIT 0');
  await pool.query('SELECT saved_at, saved_by, saved_by_id, review_at, review_by, review_by_id, cancelled_at, cancelled_by, cancelled_by_id, applied_by_id FROM count_sessions LIMIT 0');
});

// ---- orders ------------------------------------------------------------------

async function createOrder(cookie, businessId, number) {
  const res = await req('/api/entities/Order', {
    method: 'POST',
    cookie,
    body: { business_id: businessId, number, status: 'new', lines: [] },
  });
  assert.equal(res.status, 201, res.text);
  return res.json;
}

async function patch(cookie, entity, id, body) {
  const res = await req(`/api/entities/${entity}/${id}`, { method: 'PATCH', cookie, body });
  assert.equal(res.status, 200, res.text);
  return res.json;
}

test('order trail: the server stamps each stage at the transition, with WHO', async () => {
  const owner = await trailOwner('trail-order-owner@example.com');
  const clerk = await trailActor(owner, {
    email: 'trail-order-clerk@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
    fullName: 'Maria Ruiz',
  });
  const bid = owner.business.id;

  const order = await createOrder(owner.cookie, bid, 'ORD-TRAIL-1');
  assert.equal(order.trail_actors.created, 'Olivia Owner', 'the creator resolves to the owner display name');
  assert.equal(order.packed_at ?? null, null, 'no packed stamp before the stage happens');

  // The client claims a forged packed stamp; the server strips
  // the claim and stamps its own clock + the caller's session.
  const packed = await patch(owner.cookie, 'Order', order.id, {
    status: 'packed',
    packed_at: FORGED,
    packed_by: 'Forged Name',
    packed_by_id: 'forged-id',
  });
  nearNow(packed.packed_at);
  assert.equal(packed.packed_by, 'Olivia Owner');
  assert.equal(packed.packed_by_id, owner.user.id);
  assert.equal(packed.trail_actors.packed, 'Olivia Owner');

  // A second actor ships: WHO follows the actor, per stage.
  const shipped = await patch(clerk.cookie, 'Order', order.id, { status: 'shipped' });
  nearNow(shipped.shipped_at);
  assert.equal(shipped.shipped_by, 'Maria Ruiz');
  assert.equal(shipped.shipped_by_id, clerk.user.id);
  assert.equal(shipped.trail_actors.shipped, 'Maria Ruiz');
  assert.equal(shipped.trail_actors.packed, 'Olivia Owner', 'the earlier stage keeps its own actor');

  const delivered = await patch(owner.cookie, 'Order', order.id, { status: 'delivered' });
  nearNow(delivered.delivered_at);
  assert.equal(delivered.delivered_by_id, owner.user.id);

  // List reads carry the same resolved trail.
  const list = await req('/api/entities/Order/query', {
    method: 'POST',
    cookie: owner.cookie,
    body: { filter: { business_id: bid } },
  });
  const listed = list.json.items.find((o) => o.id === order.id);
  assert.equal(listed.trail_actors.shipped, 'Maria Ruiz');
  assert.equal(listed.trail_actors.delivered, 'Olivia Owner');

  // Re-saving without entering a new stage never re-stamps.
  const before = delivered.packed_at;
  const edited = await patch(owner.cookie, 'Order', order.id, { notes: 'a note' });
  assert.equal(edited.packed_at, before, 'a plain edit leaves the packed stamp untouched');
  const restamped = await patch(owner.cookie, 'Order', order.id, { status: 'delivered' });
  assert.equal(restamped.delivered_at, delivered.delivered_at, 'staying in a stage is not entering it');
});

test('order trail: cancel stamps its actor; a forged stamp in the patch is ignored', async () => {
  const owner = await trailOwner('trail-cancel-owner@example.com');
  const order = await createOrder(owner.cookie, owner.business.id, 'ORD-TRAIL-2');
  const cancelled = await patch(owner.cookie, 'Order', order.id, {
    status: 'cancelled',
    cancelled_at: FORGED,
    cancelled_by: 'Forged Name',
  });
  nearNow(cancelled.cancelled_at);
  assert.equal(cancelled.cancelled_by, 'Olivia Owner');
  assert.equal(cancelled.cancelled_by_id, owner.user.id);
  assert.equal(cancelled.trail_actors.cancelled, 'Olivia Owner');
});

test('actor resolution is live: a renamed owner reads renamed; a gone actor reads as the empty marker', async () => {
  const owner = await trailOwner('trail-live-owner@example.com');
  const clerk = await trailActor(owner, {
    email: 'trail-live-clerk@example.com',
    roleId: 'preset-sales',
    roleName: 'Sales clerk',
    fullName: 'Pedro Paz',
  });
  const order = await createOrder(clerk.cookie, owner.business.id, 'ORD-TRAIL-3');
  assert.equal(order.trail_actors.created, 'Pedro Paz');

  await patch(owner.cookie, 'Order', order.id, { status: 'packed' });
  await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', ['Olivia Renamed', owner.user.id]);
  let read = await req(`/api/entities/Order/${order.id}`, { cookie: owner.cookie });
  assert.equal(read.json.trail_actors.packed, 'Olivia Renamed', 'the name is resolved at read time, not frozen at the stamp');

  // The clerk's staff row goes (their account is gone from the
  // business): the recorded actor resolves to nobody — the
  // empty marker the client renders as "Former team member".
  await pool.query('DELETE FROM staff_members WHERE id = $1', [clerk.memberId]);
  read = await req(`/api/entities/Order/${order.id}`, { cookie: owner.cookie });
  assert.equal(read.json.trail_actors.created, '', 'a gone actor resolves to the empty marker, never a stale name');
  assert.ok(!JSON.stringify(read.json.trail_actors).includes('@'), 'no email ever rides the trail');
});

test('legacy rows keep honest history: pre-357 stamps read back untouched, no invented actors', async () => {
  const owner = await trailOwner('trail-legacy-owner@example.com');
  const id = '11111111-1111-4111-8111-111111111111';
  await pool.query(
    `INSERT INTO orders (id, business_id, number, status, shipped_at, shipped_by, created_by_id, created_by, created_at)
     VALUES ($1, $2, 'ORD-LEGACY', 'shipped', '2026-11-01T10:00:00Z', 'Legacy Shipper', $3, 'gone@example.com', '2026-11-01T09:00:00Z')`,
    [id, owner.business.id, '99999999-9999-4999-8999-999999999999'],
  );
  const read = await req(`/api/entities/Order/${id}`, { cookie: owner.cookie });
  assert.equal(read.status, 200, read.text);
  assert.equal(read.json.shipped_by, 'Legacy Shipper', 'the stored name from before the trail stands');
  assert.equal(read.json.trail_actors.shipped, null, 'no actor id was recorded, so none is claimed');
  assert.equal(read.json.trail_actors.created, '', 'a creator id that resolves to nobody reads as gone');
  assert.equal(read.json.packed_at ?? null, null, 'no packed stamp is invented for a stage that predates the build');
});

// ---- returns -----------------------------------------------------------------

test('return trail: logged, approved, completed, rejected — all stamped by the server', async () => {
  const owner = await trailOwner('trail-return-owner@example.com');
  const bid = owner.business.id;
  const create = async (number, values = {}) => {
    const res = await req('/api/entities/Return', {
      method: 'POST',
      cookie: owner.cookie,
      body: { business_id: bid, number, kind: 'return', status: 'new', lines: [], ...values },
    });
    assert.equal(res.status, 201, res.text);
    return res.json;
  };

  // A forged stamp in the CREATE body is stripped, not stored.
  const ret = await create('RET-TRAIL-1', { approved_at: FORGED, approved_by: 'Forged Name' });
  assert.equal(ret.approved_at ?? null, null);
  assert.equal(ret.trail_actors.created, 'Olivia Owner', 'Logged carries the logger');

  const approved = await patch(owner.cookie, 'Return', ret.id, { status: 'approved', approved_at: FORGED });
  nearNow(approved.approved_at);
  assert.equal(approved.approved_by, 'Olivia Owner');
  assert.equal(approved.approved_by_id, owner.user.id);

  const completed = await patch(owner.cookie, 'Return', ret.id, { status: 'completed' });
  nearNow(completed.completed_at);
  assert.equal(completed.completed_by_id, owner.user.id);
  assert.equal(completed.trail_actors.completed, 'Olivia Owner');

  const ret2 = await create('RET-TRAIL-2');
  const rejected = await patch(owner.cookie, 'Return', ret2.id, { status: 'rejected' });
  nearNow(rejected.rejected_at);
  assert.equal(rejected.rejected_by, 'Olivia Owner');
  assert.equal(rejected.rejected_by_id, owner.user.id);
});

test('return trail: a return born approved is stamped at creation with its creator', async () => {
  const owner = await trailOwner('trail-born-owner@example.com');
  const res = await req('/api/entities/Return', {
    method: 'POST',
    cookie: owner.cookie,
    body: { business_id: owner.business.id, number: 'RET-TRAIL-3', kind: 'return', status: 'approved', lines: [] },
  });
  assert.equal(res.status, 201, res.text);
  nearNow(res.json.approved_at);
  assert.equal(res.json.approved_by_id, owner.user.id);
  assert.equal(res.json.trail_actors.approved, 'Olivia Owner');
});

// ---- counts ------------------------------------------------------------------

test('count trail: save, send for review, apply, cancel — and a floor save stamps its own actor', async () => {
  const owner = await trailOwner('trail-count-owner@example.com');
  const viewer = await trailActor(owner, {
    email: 'trail-count-viewer@example.com',
    roleId: 'preset-viewer',
    roleName: 'Viewer',
    fullName: 'Vera Viewer',
  });
  const bid = owner.business.id;
  const created = await req('/api/entities/CountSession', {
    method: 'POST',
    cookie: owner.cookie,
    body: { business_id: bid, number: 'CNT-TRAIL-1', status: 'open', lines: [] },
  });
  assert.equal(created.status, 201, created.text);
  const session = created.json;
  assert.equal(session.trail_actors.created, 'Olivia Owner');
  assert.equal(session.saved_at ?? null, null, 'no save stamp before a save happens');

  // A floor save by a member WITHOUT counts.run (the shared
  // board, release 333) stamps Saved with THAT member as actor.
  const lines = [{ product_id: 'p1', product_name: 'Widget', counted: 3, expected: 2 }];
  const saved = await patch(viewer.cookie, 'CountSession', session.id, { lines });
  nearNow(saved.saved_at);
  assert.equal(saved.saved_by, 'Vera Viewer');
  assert.equal(saved.saved_by_id, viewer.user.id);
  assert.equal(saved.trail_actors.saved, 'Vera Viewer');

  const sent = await patch(owner.cookie, 'CountSession', session.id, { lines, status: 'review' });
  nearNow(sent.review_at);
  assert.equal(sent.review_by_id, owner.user.id);
  assert.equal(sent.trail_actors.review, 'Olivia Owner');

  const applied = await patch(owner.cookie, 'CountSession', session.id, { status: 'applied' });
  nearNow(applied.applied_at);
  assert.equal(applied.applied_by, 'Olivia Owner');
  assert.equal(applied.applied_by_id, owner.user.id);

  const second = await req('/api/entities/CountSession', {
    method: 'POST',
    cookie: owner.cookie,
    body: { business_id: bid, number: 'CNT-TRAIL-2', status: 'open', lines: [] },
  });
  const cancelled = await patch(owner.cookie, 'CountSession', second.json.id, { status: 'cancelled' });
  nearNow(cancelled.cancelled_at);
  assert.equal(cancelled.cancelled_by_id, owner.user.id);
});

// ---- exports -----------------------------------------------------------------

test('exports: the CSV carries the trailing Exported-at line and the header still leads', async () => {
  const owner = await trailOwner('trail-export-owner@example.com', { plan: 'business' });
  const res = await fetch(`${base}/api/businesses/${owner.business.id}/export/products?format=csv`, {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  assert.ok(body.startsWith('Product ID,'), 'the header row still leads the file');
  assert.match(body, /\r\nExported at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the stamp trails the data, inside the file');
});

test('exports: the XLSX carries the Exported-at footer row on its sheet', async () => {
  const owner = await trailOwner('trail-export2-owner@example.com', { plan: 'business' });
  const res = await fetch(`${base}/api/businesses/${owner.business.id}/export/products?format=xlsx`, {
    headers: { Cookie: owner.cookie },
  });
  assert.equal(res.status, 200);
  const buffer = Buffer.from(await res.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const ws = workbook.worksheets[0];
  const last = ws.getRow(ws.rowCount);
  assert.equal(last.getCell(1).value, 'Exported at');
  assert.match(String(last.getCell(2).value), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  assert.equal(ws.getRow(1).getCell(1).value, 'Product ID', 'the header row is untouched');
});

// ---- re-import stays clean ----------------------------------------------------

test('re-import: parseCsv drops the trailing Exported-at line and nothing else', () => {
  const csv = 'Name,SKU\r\nWidget,W-1\r\nGadget,G-2\r\nExported at: 2026-11-23T12:00:00.000Z';
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed.headers, ['Name', 'SKU']);
  assert.equal(parsed.rows.length, 2, 'both data rows survive; the stamp is not a row');
  const plain = parseCsv('Name,SKU\r\nWidget,W-1\r\nSolo');
  assert.equal(plain.rows.length, 2, 'an ordinary one-cell last row is kept — only the stamp is dropped');
});

test('re-import: the XLSX reader drops the Exported-at footer row', async () => {
  const workbook = buildWorkbook(
    [{ name: 'Products', columns: [{ label: 'Name', key: 'Name' }, { label: 'SKU', key: 'SKU' }], rows: [{ Name: 'Widget', SKU: 'W-1' }] }],
    { exportedAt: '2026-11-23T12:00:00.000Z' },
  );
  const buffer = await workbook.xlsx.writeBuffer();
  const file = new File([buffer], 'products.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const { sheets } = await readWorkbookFile(file);
  assert.equal(sheets[0].rows.length, 1, 'the data row survives and the footer never becomes a row');
  assert.deepEqual(sheets[0].rows[0], ['Widget', 'W-1']);
});

// ---- strings + source pins ------------------------------------------------------

test('i18n: the six trail keys exist in English and are truly translated in es-MX; keyset 6506', () => {
  const keys = ['trail.title', 'trail.created', 'trail.saved', 'trail.logged', 'trail.sentForReview', 'trail.actorGone'];
  for (const key of keys) {
    assert.equal(typeof en[key], 'string', `en missing ${key}`);
    assert.ok(en[key].length > 0, `en empty ${key}`);
    assert.equal(typeof esMX[key], 'string', `es-MX missing ${key}`);
    assert.notEqual(esMX[key], en[key], `es-MX carries the English line for ${key} (translation debt)`);
  }
  assert.equal(Object.keys(en).length, 6636);
  for (const [code, strings] of Object.entries(LOCALES)) {
    assert.equal(Object.keys(strings).length, 6636, code);
  }
});

test('source pins: the client no longer sends stamp fields; the trail renders on the cards and the Return document', () => {
  const ordersLib = read('src/lib/orders.js');
  const returnsLib = read('src/lib/returns.js');
  const countsLib = read('src/lib/counts.js');
  assert.ok(!/shipped_at:/.test(ordersLib), 'orders lib sends no shipped_at');
  assert.ok(!/cancelled_at:/.test(ordersLib), 'orders lib sends no cancelled_at');
  assert.ok(!/approved_at:/.test(returnsLib), 'returns lib sends no approved_at');
  assert.ok(!/completed_at:/.test(returnsLib), 'returns lib sends no completed_at');
  assert.ok(!/applied_at:/.test(countsLib), 'counts lib sends no applied_at');
  assert.match(read('src/components/orders/OrderCard.jsx'), /orderTrail\(order\)/);
  assert.match(read('src/components/returns/ReturnCard.jsx'), /returnTrail\(record\)/);
  assert.match(read('src/components/counts/CountCard.jsx'), /countTrail\(session\)/);
  assert.match(read('src/components/print/ReturnDoc.jsx'), /returnTrail\(ret\)/, 'the trail prints on the Return document');
});
