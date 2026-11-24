/**
 * Release 366 — the import photo door fix (Nov 24, 2026).
 *
 * Release 365 fetched photo links inside the import request:
 * strictly sequential, a 10-second budget for the whole
 * download, zero retries. On the owner's real 137-product
 * import the picture CDN throttled the server's rapid stream
 * and more than half the photos died on their only attempt —
 * and the links were stored nowhere, so nothing could retry.
 * The 365 suite never caught it: it exercised the photo door
 * with exactly ONE live link per import, from a local server,
 * and its 250-row scale test carried no photos at all.
 *
 * These tests close that exact gap:
 *   (a) SCALE + FAST ANSWER — a 137-photo import against a
 *       local server with realistic per-photo latency. The old
 *       road's floor for this import was 137 × latency inside
 *       one request; the new road answers in a fraction of it,
 *       with every photo queued — and the worker then lands
 *       every single photo.
 *   (b) THROTTLE — the server answers 429 for each link's
 *       first two tries and slow-drips the body on the third:
 *       the worker's retries still land every photo.
 *   (c) RECOVERY — the Bring in missing photos door queues
 *       only link-present / photo-absent products, is
 *       idempotent, never overwrites a photo already there,
 *       and answers "nothing to do" truthfully when nothing
 *       is missing. Essentials parity included.
 *   (d) RESTART — a job stranded mid-fetch by a dead process
 *       (a stale claim) is re-queued and finished by a later
 *       drain; a fresh claim is NOT stolen. The queue is rows,
 *       not memory: a drain with no in-memory state completes
 *       work another "process" left behind.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { pool, req, close, ownerWithBusiness } from '../t3/helpers.js';
import { drainPhotoJobs } from '../../server/photoJobs.js';

after(close);

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const hits = new Map();
let latencyMs = 0;
const photoServer = http.createServer((request, response) => {
  const path = request.url;
  hits.set(path, (hits.get(path) || 0) + 1);
  if (path.startsWith('/img/')) {
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(PNG_1PX);
    }, latencyMs);
    return;
  }
  if (path.startsWith('/flaky/')) {
    // A throttling CDN: refuse the first two tries outright,
    // then slow-drip the body in three chunks over ~800 ms —
    // a stream the old door's manners would lose repeatedly.
    if (hits.get(path) <= 2) {
      response.writeHead(429, { 'Content-Type': 'text/plain' });
      response.end('slow down');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'image/png' });
    const third = Math.ceil(PNG_1PX.length / 3);
    response.write(PNG_1PX.subarray(0, third));
    setTimeout(() => {
      response.write(PNG_1PX.subarray(third, third * 2));
      setTimeout(() => response.end(PNG_1PX.subarray(third * 2)), 400);
    }, 400);
    return;
  }
  response.writeHead(404);
  response.end();
});
await new Promise((resolve) => photoServer.listen(0, '127.0.0.1', resolve));
const photoBase = `http://127.0.0.1:${photoServer.address().port}`;
after(() => {
  photoServer.closeAllConnections();
  photoServer.close();
});

const silentLogger = { log() {}, error() {} };

const importRows = (cookie, businessId, body) =>
  req(`/api/businesses/${businessId}/import`, { method: 'POST', body, cookie });

const photoCount = async (businessId) =>
  (
    await pool.query(
      "SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1 AND NOT (photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]')",
      [businessId],
    )
  ).rows[0].n;

const storedPhotos = async (businessId) =>
  (await pool.query('SELECT COUNT(*)::int AS n FROM product_photos WHERE business_id = $1', [businessId])).rows[0].n;

/** Drain until no job for the business is active. The clock
 * runs forward so retries fall due; the wait is wall-clock
 * (a full 137-photo drain takes several seconds on its own). */
async function drainUntilSettled(businessId, timeoutMs = 60000) {
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('photo jobs never settled');
}

test('366 (a): a 137-photo import answers fast with every photo queued — then the worker lands every one', async () => {
  latencyMs = 150;
  const { cookie, business } = await ownerWithBusiness('t62-scale@example.com', 'Scale Shop', { plan: 'business' });
  const rows = Array.from({ length: 137 }, (_, i) => ({
    name: `Scale Book ${i + 1}`,
    sku: `SCALE-${i + 1}`,
    price: 5,
    stock_qty: 0,
    photo: `${photoBase}/img/${i + 1}.png`,
  }));
  const started = Date.now();
  const res = await importRows(cookie, business.id, { rows, location_id: '', batchRef: 't62-scale-1', fileName: 'scale.csv' });
  const elapsed = Date.now() - started;
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.created, 137);
  assert.equal(res.json.photosQueued, 137);
  // The old synchronous road's floor was 137 × 150 ms ≈ 20.5 s
  // of pure fetch waiting INSIDE the request. The decoupled
  // door answers in a fraction of that.
  assert.ok(elapsed < 8000, `import answered in ${elapsed} ms — the photos are not fetched inside the send`);
  // At the moment the import answered, the photos were still
  // on their way (the queue, not the request, carries them).
  const firstLook = await req(`/api/businesses/${business.id}/photo-jobs`, { cookie });
  assert.equal(firstLook.status, 200, firstLook.text);
  assert.equal(firstLook.json.withLink, 137);
  assert.ok(
    firstLook.json.pending > 0 || firstLook.json.withPhoto < 137,
    'photos still draining when the import answered',
  );
  await drainUntilSettled(business.id);
  assert.equal(await photoCount(business.id), 137, 'every product carries its photo');
  assert.equal(await storedPhotos(business.id), 137, 'every photo is in the app\u2019s own storage');
  const settled = await req(`/api/businesses/${business.id}/photo-jobs`, { cookie });
  assert.deepEqual(
    { withLink: settled.json.withLink, withPhoto: settled.json.withPhoto, missing: settled.json.missing, pending: settled.json.pending },
    { withLink: 137, withPhoto: 137, missing: 0, pending: 0 },
  );
  latencyMs = 0;
});

test('366 (b): a throttling server — 429s, then a slow drip — still loses no photo: the retries land them all', async () => {
  const { cookie, business } = await ownerWithBusiness('t62-throttle@example.com', 'Throttle Shop', { plan: 'business' });
  const rows = Array.from({ length: 12 }, (_, i) => ({
    name: `Flaky Book ${i + 1}`,
    sku: `FLAKY-${i + 1}`,
    price: 5,
    stock_qty: 0,
    photo: `${photoBase}/flaky/${i + 1}.png`,
  }));
  const res = await importRows(cookie, business.id, { rows, location_id: '', batchRef: 't62-flaky-1', fileName: 'flaky.csv' });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.photosQueued, 12);
  await drainUntilSettled(business.id);
  assert.equal(await photoCount(business.id), 12, 'every throttled photo still landed');
  assert.equal(await storedPhotos(business.id), 12);
  for (let i = 1; i <= 12; i += 1) {
    assert.ok(
      (hits.get(`/flaky/${i}.png`) || 0) >= 3,
      `link ${i} was retried until it landed (hits: ${hits.get(`/flaky/${i}.png`)})`,
    );
  }
  const problems = (
    await pool.query("SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1 AND photo_problem <> ''", [business.id])
  ).rows[0].n;
  assert.equal(problems, 0, 'no product carries a photo problem after a successful retry road');
});

test('366 (c): the recovery door — only the missing, never an overwrite, nothing-to-do told truthfully', async () => {
  const { cookie, business } = await ownerWithBusiness('t62-recover@example.com', 'Recover Shop', { plan: 'business' });
  const mk = async (body) => {
    const res = await req('/api/entities/Product', { method: 'POST', body: { business_id: business.id, ...body }, cookie });
    assert.equal(res.status, 201, res.text);
    return res.json;
  };
  const missingA = await mk({ name: 'Missing A', sku: 'REC-A', photo_source_url: `${photoBase}/img/rec-a.png` });
  const missingD = await mk({
    name: 'Missing D',
    sku: 'REC-D',
    photo_source_url: `${photoBase}/img/rec-d.png`,
    photo_problem: 'The photo link could not be reached.',
  });
  const hasPhoto = await mk({
    name: 'Has Photo',
    sku: 'REC-B',
    photo_source_url: `${photoBase}/img/rec-b.png`,
    photo_urls: ['https://cdn.example.com/original-cover.jpg'],
  });
  await mk({ name: 'No Link', sku: 'REC-C' });

  const recover = () => req(`/api/businesses/${business.id}/photo-jobs/recover`, { method: 'POST', body: {}, cookie });
  const first = await recover();
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.missing, 2, 'exactly the two link-present / photo-absent products are missing');
  assert.equal(first.json.enqueued, 2);
  const second = await recover();
  assert.equal(second.json.enqueued, 0, 'a second run adds nothing new — idempotent');
  const jobCount = (
    await pool.query('SELECT COUNT(*)::int AS n FROM photo_jobs WHERE business_id = $1', [business.id])
  ).rows[0].n;
  assert.equal(jobCount, 2, 'still exactly two jobs exist for the business — no duplicates were queued');

  await drainUntilSettled(business.id);
  const rows = (
    await pool.query('SELECT id, photo_urls, photo_problem FROM products WHERE business_id = $1', [business.id])
  ).rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const urlsOf = (row) => (typeof row.photo_urls === 'string' ? JSON.parse(row.photo_urls) : row.photo_urls);
  assert.match(urlsOf(byId.get(missingA.id))[0], /\/api\/photos\//, 'Missing A got its photo');
  assert.match(urlsOf(byId.get(missingD.id))[0], /\/api\/photos\//, 'Missing D got its photo');
  assert.equal(byId.get(missingD.id).photo_problem, '', 'the landed photo clears the named problem');
  assert.deepEqual(urlsOf(byId.get(hasPhoto.id)), ['https://cdn.example.com/original-cover.jpg'], 'a photo already there is never overwritten');

  const third = await recover();
  assert.equal(third.json.missing, 0);
  assert.equal(third.json.enqueued, 0, 'nothing missing → nothing enqueued: the nothing-to-do answer');

  // Essentials parity: the same door, the same behavior.
  const ess = await ownerWithBusiness('t62-recover-ess@example.com', 'Recover Essentials');
  const essProduct = (
    await req('/api/entities/Product', {
      method: 'POST',
      body: { business_id: ess.business.id, name: 'Ess Missing', sku: 'REC-E', photo_source_url: `${photoBase}/img/rec-e.png` },
      cookie: ess.cookie,
    })
  ).json;
  const essRecover = await req(`/api/businesses/${ess.business.id}/photo-jobs/recover`, {
    method: 'POST',
    body: {},
    cookie: ess.cookie,
  });
  assert.equal(essRecover.status, 200, essRecover.text);
  assert.equal(essRecover.json.enqueued, 1);
  await drainUntilSettled(ess.business.id);
  const essRow = (await pool.query('SELECT photo_urls FROM products WHERE id = $1', [essProduct.id])).rows[0];
  const essUrls = typeof essRow.photo_urls === 'string' ? JSON.parse(essRow.photo_urls) : essRow.photo_urls;
  assert.match(essUrls[0], /\/api\/photos\//);
});

test('366 (d): a restart mid-drain loses nothing — a stale claim is re-queued and finished, a fresh claim is not stolen', async () => {
  const { cookie, business } = await ownerWithBusiness('t62-restart@example.com', 'Restart Shop', { plan: 'business' });
  const mk = async (body) => {
    const res = await req('/api/entities/Product', { method: 'POST', body: { business_id: business.id, ...body }, cookie });
    assert.equal(res.status, 201, res.text);
    return res.json;
  };
  const stranded = await mk({ name: 'Stranded', sku: 'RESTART-1', photo_source_url: `${photoBase}/img/restart-1.png` });
  const freshClaim = await mk({ name: 'Fresh Claim', sku: 'RESTART-2', photo_source_url: `${photoBase}/img/restart-2.png` });
  const queued = await mk({ name: 'Plain Queued', sku: 'RESTART-3', photo_source_url: `${photoBase}/img/restart-3.png` });
  const insertJob = async (product, status, updatedMinutesAgo) => {
    await pool.query(
      `INSERT INTO photo_jobs (id, business_id, product_id, source_url, origin, status, attempts, next_attempt_at, updated_at)
       VALUES ($1, $2, $3, $4, '', $5, 1, $6, $7)`,
      [
        crypto.randomUUID(),
        business.id,
        product.id,
        product.photo_source_url,
        status,
        new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        new Date(Date.now() - updatedMinutesAgo * 60 * 1000).toISOString(),
      ],
    );
  };
  await insertJob(stranded, 'fetching', 20); // claimed 20 minutes ago by a process that died
  await insertJob(freshClaim, 'fetching', 0); // claimed just now by a living worker
  await insertJob(queued, 'queued', 0);

  // A brand-new drain — no in-memory state, as after a restart.
  await drainPhotoJobs(pool, { logger: silentLogger });
  const jobRows = (
    await pool.query('SELECT product_id, status FROM photo_jobs WHERE business_id = $1', [business.id])
  ).rows;
  const statusOf = new Map(jobRows.map((r) => [r.product_id, r.status]));
  assert.equal(statusOf.get(stranded.id), 'done', 'the stranded job was re-queued and finished');
  assert.equal(statusOf.get(queued.id), 'done', 'the plainly queued job finished');
  assert.equal(statusOf.get(freshClaim.id), 'fetching', 'a fresh claim belongs to its living worker — not stolen');
  assert.equal(await photoCount(business.id), 2, 'exactly the two finished jobs landed their photos');
});
