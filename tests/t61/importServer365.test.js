/**
 * Release 365 — import robustness, the commit half (owner rulings,
 * Nov 23, 2026). The Create import commits through ONE server send
 * (POST /businesses/:bid/import) at any size:
 *
 *   (2) a 250-row file imports in one send — every row lands (the
 *       old road refused past 100 rows and stranded the rest);
 *   (3) a send the server refuses lands ZERO rows;
 *   (4) importing the same file twice creates no twins — the
 *       second send names every row already in the catalog;
 *   (7) a photo link in the sheet lands as the product's photo in
 *       the app's own photo storage; a dead link is a named
 *       problem and the product is still created — as rebuilt by
 *       release 366 (Nov 24, 2026): the link is KEPT on the
 *       product and queued, the photo arrives on its own through
 *       the background worker, and a link that cannot be fetched
 *       ends named on the product itself (the full 366 proofs —
 *       scale, throttling, restart, the recovery door — live in
 *       tests/t62);
 *   (9) Essentials parity: the same road, the same behavior, on
 *       the Essentials plan.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pool, req, close, ownerWithBusiness, seededLocation } from '../t3/helpers.js';
import { drainPhotoJobs } from '../../server/photoJobs.js';

const silentLogger = { log() {}, error() {} };

/**
 * Drain the photo queue the way the worker does, running the
 * clock forward so retries fall due, until no job for the
 * business is still active (or the rounds run out).
 */
async function drainUntilSettled(businessId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await drainPhotoJobs(pool, {
      now: new Date(Date.now() + 60 * 60 * 1000),
      backoffMs: [0, 0, 0],
      logger: silentLogger,
    });
    const active = (
      await pool.query(
        "SELECT COUNT(*)::int AS n FROM photo_jobs WHERE business_id = $1 AND status IN ('queued', 'fetching')",
        [businessId],
      )
    ).rows[0].n;
    if (active === 0) return;
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('photo jobs never settled');
}

after(close);

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const photoServer = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'image/png' });
  response.end(PNG_1PX);
});
await new Promise((resolve) => photoServer.listen(0, '127.0.0.1', resolve));
const photoUrl = `http://127.0.0.1:${photoServer.address().port}/img.png`;
after(() => {
  // The import door's fetches keep their sockets warm; destroy them
  // so the fixture server can actually close and the run can exit.
  photoServer.closeAllConnections();
  photoServer.close();
});

const importRows = (cookie, businessId, body) =>
  req(`/api/businesses/${businessId}/import`, { method: 'POST', body, cookie });

const productCount = async (businessId) =>
  (await pool.query('SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1', [businessId])).rows[0].n;

test('365 (2): a 250-row file imports in ONE send, all rows land', async () => {
  const { cookie, business } = await ownerWithBusiness('t61-bulk@example.com', 'Bulk Shop', { plan: 'business' });
  const location = await seededLocation(cookie, business.id);
  const rows = Array.from({ length: 250 }, (_, i) => ({
    name: `Bulk Book ${i + 1}`,
    sku: `BULK-${i + 1}`,
    price: 5,
    stock_qty: 2,
  }));
  const res = await importRows(cookie, business.id, {
    rows,
    location_id: location.id,
    batchRef: 't61-bulk-1',
    fileName: 'bulk.csv',
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.created, 250);
  assert.equal(res.json.received, 250);
  assert.equal(res.json.units, 500);
  assert.equal(res.json.skipped, 0);
  assert.equal(await productCount(business.id), 250);
});

test('365 (3): a refused send lands ZERO rows', async () => {
  const a = await ownerWithBusiness('t61-refused-a@example.com', 'Refused A', { plan: 'business' });
  const b = await ownerWithBusiness('t61-refused-b@example.com', 'Refused B', { plan: 'business' });
  const foreignLocation = await seededLocation(b.cookie, b.business.id);
  const rows = [{ name: 'Never Lands', sku: 'NEVER-1', price: 3, stock_qty: 1 }];
  // A location that belongs to another business: refused whole.
  const wrongPlace = await importRows(a.cookie, a.business.id, {
    rows,
    location_id: foreignLocation.id,
    batchRef: 't61-refused-1',
  });
  assert.equal(wrongPlace.status, 400);
  assert.equal(await productCount(a.business.id), 0);
  // No batch reference: refused whole.
  const noBatch = await importRows(a.cookie, a.business.id, { rows, location_id: '' });
  assert.equal(noBatch.status, 400);
  assert.equal(await productCount(a.business.id), 0);
});

test('365 (4): the same file twice — no twins, second send names every row', async () => {
  const { cookie, business } = await ownerWithBusiness('t61-twice@example.com', 'Twice Shop', { plan: 'business' });
  const location = await seededLocation(cookie, business.id);
  const rows = [
    { name: 'Alpha Tales', price: 4, stock_qty: 1 },
    { name: 'Beta Tales', price: 6, stock_qty: 2 },
    { name: 'Gamma Tales', price: 8, stock_qty: 3 },
  ];
  const first = await importRows(cookie, business.id, {
    rows,
    location_id: location.id,
    batchRef: 't61-twice-1',
  });
  assert.equal(first.status, 201, first.text);
  assert.equal(first.json.created, 3);
  const second = await importRows(cookie, business.id, {
    rows,
    location_id: location.id,
    batchRef: 't61-twice-2',
  });
  assert.equal(second.status, 201, second.text);
  assert.equal(second.json.created, 0);
  assert.equal(second.json.skipped, 3);
  for (const problem of second.json.problems) {
    assert.match(problem.problem, /already in the catalog/);
  }
  assert.equal(await productCount(business.id), 3);
  // The identities the importer assigned are its generated SKUs.
  const skus = (
    await pool.query('SELECT sku FROM products WHERE business_id = $1 ORDER BY sku', [business.id])
  ).rows.map((r) => r.sku);
  assert.deepEqual(skus, ['ALPHA-TALES', 'BETA-TALES', 'GAMMA-TALES']);
});

test('365 (7) as rebuilt by 366: the link is kept and queued; the photo arrives on its own; a dead link ends named on the product', async () => {
  const { cookie, business } = await ownerWithBusiness('t61-photo@example.com', 'Photo Shop', { plan: 'business' });
  const res = await importRows(cookie, business.id, {
    rows: [
      { name: 'Photo Book', price: 5, stock_qty: 0, photo: photoUrl },
      { name: 'Dead Link Book', price: 5, stock_qty: 0, photo: 'http://127.0.0.1:1/nope.png' },
    ],
    location_id: '',
    batchRef: 't61-photo-1',
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.created, 2);
  // Release 366: nothing is fetched inside the send. Both links
  // are queued, no fetch has failed yet, and the links live on
  // the products themselves — the recovery road stands on them.
  assert.equal(res.json.photosQueued, 2);
  assert.equal(res.json.photoProblems.length, 0);
  const kept = (
    await pool.query('SELECT name, photo_source_url FROM products WHERE business_id = $1 ORDER BY name', [business.id])
  ).rows;
  assert.equal(kept.find((r) => r.name === 'Photo Book').photo_source_url, photoUrl);
  assert.equal(kept.find((r) => r.name === 'Dead Link Book').photo_source_url, 'http://127.0.0.1:1/nope.png');
  await drainUntilSettled(business.id);
  const photoBook = (
    await pool.query('SELECT photo_urls FROM products WHERE business_id = $1 AND name = $2', [business.id, 'Photo Book'])
  ).rows[0];
  const urls = typeof photoBook.photo_urls === 'string' ? JSON.parse(photoBook.photo_urls) : photoBook.photo_urls;
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/api\/photos\//);
  const stored = (
    await pool.query('SELECT COUNT(*)::int AS n FROM product_photos WHERE business_id = $1', [business.id])
  ).rows[0].n;
  assert.equal(stored, 1);
  const deadBook = (
    await pool.query('SELECT photo_urls, photo_problem FROM products WHERE business_id = $1 AND name = $2', [business.id, 'Dead Link Book'])
  ).rows[0];
  const deadUrls = typeof deadBook.photo_urls === 'string' ? JSON.parse(deadBook.photo_urls) : deadBook.photo_urls;
  assert.ok(!deadUrls || deadUrls.length === 0);
  // The exhausted failure is named on the product itself.
  assert.match(deadBook.photo_problem, /could not be reached/);
});

test('365 (9): Essentials parity — same road, same behavior', async () => {
  const { cookie, business } = await ownerWithBusiness('t61-essentials@example.com', 'Essentials Shop');
  const location = await seededLocation(cookie, business.id);
  const res = await importRows(cookie, business.id, {
    rows: [
      { name: 'Essentials One', price: 3, stock_qty: 4, photo: photoUrl },
      { name: 'Essentials Two', price: 7, stock_qty: 2 },
    ],
    location_id: location.id,
    batchRef: 't61-ess-1',
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.created, 2);
  assert.equal(res.json.received, 2);
  assert.equal(res.json.units, 6);
  assert.equal(res.json.photoProblems.length, 0);
  assert.equal(res.json.photosQueued, 1); // one row carries a photo link (release 366)
  await drainUntilSettled(business.id);
  const levels = (
    await pool.query(
      'SELECT COALESCE(SUM(quantity), 0)::int AS n FROM stock_levels WHERE business_id = $1',
      [business.id],
    )
  ).rows[0].n;
  assert.equal(levels, 6);
});
