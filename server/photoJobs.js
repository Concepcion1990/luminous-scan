/**
 * Photo jobs — release 366 (Nov 24, 2026): the import photo
 * door, rebuilt after the owner's real 137-product import lost
 * more than half its photos.
 *
 * THE DEFECT THIS REPLACES — release 365 fetched each sheet
 * photo link synchronously inside the import request: strictly
 * sequential, a 10-second budget for the WHOLE download, and
 * zero retries. The picture CDN throttled the server's rapid
 * back-to-back stream (a datacenter address asking like a
 * robot), slow answers died against the 10-second budget, and
 * one refused try cost a product its photo permanently. The
 * source link was stored nowhere, so nothing could ever retry.
 * (Full diagnosis: ~/workspace/diagnosis-photo-door/report.md.)
 *
 * THE NEW SHAPE —
 *   - The importer records the link on the product itself
 *     (products.photo_source_url, migration 051) and enqueues a
 *     durable photo_jobs row. The import answers at once:
 *     products landed, photos on their way.
 *   - A worker drains the queue politely: a few fetches at a
 *     time, a browser-like user-agent, a 30-second budget, and
 *     retries with backoff (+30 s, +5 min, +30 min) before a
 *     link is declared a problem. Jobs are rows, not memory —
 *     a restart loses nothing, and a job stranded mid-fetch by
 *     a crash is re-queued by the next drain.
 *   - Success stores the bytes in product_photos (the same
 *     storage every product photo uses) and points the
 *     product's photo_urls at the internal /api/photos/<id>
 *     URL — ONLY when the product still has no photo. A photo
 *     already there (from an earlier fetch, or uploaded by
 *     hand) is never overwritten.
 *   - A job that exhausts its retries names the failure on the
 *     product itself (products.photo_problem), where the owner
 *     works — not only on a result screen that can be missed.
 *   - The recovery door (enqueueMissingPhotoJobs) enqueues
 *     exactly the products that have a link on file and no
 *     photo yet. It never creates a product and never touches
 *     one that has its photo, so running it twice changes
 *     nothing the second time.
 *
 * The scheduler follows the codebase's sweep pattern (boot run
 * + interval, failure-isolated, overlap-guarded, unref'd
 * timers), like server/clockAdmin.js's missed-clock-out watch.
 */
import crypto from 'node:crypto';

export const PHOTO_FETCH_TIMEOUT_MS = 30 * 1000;
export const PHOTO_FETCH_CONCURRENCY = 4;
export const PHOTO_MAX_ATTEMPTS = 4; // the first try + three retries
export const PHOTO_RETRY_BACKOFF_MS = [30 * 1000, 5 * 60 * 1000, 30 * 60 * 1000];
export const PHOTO_JOB_BATCH = 200;
// A job claimed (status 'fetching') whose claim is older than
// this was stranded by a dead process and is re-queued.
export const PHOTO_CLAIM_STALE_MS = 10 * 60 * 1000;

// The import door's photo carriage follows the universal upload
// ceiling (25 MB — owner ruling, Nov 23, 2026): a seller's linked
// photo is refused only past the same line as every upload.
const PHOTO_MAX_BYTES = 25 * 1024 * 1024;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const isPhotoLink = (rawUrl) => /^https?:\/\//i.test(String(rawUrl || '').trim());

const photoMime = (buffer, contentType) => {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (['image/png', 'image/jpeg', 'image/webp'].includes(type)) return type;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return 'image/png';
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  return null;
};

/** Does this stored photo_urls value mean "no photo yet"? */
export const photoUrlsEmpty = (value) => {
  if (!value) return true;
  if (Array.isArray(value)) return value.length === 0;
  const text = String(value).trim();
  if (!text || text === '[]') return true;
  try {
    const parsed = JSON.parse(text);
    return !Array.isArray(parsed) || parsed.length === 0;
  } catch {
    return false; // an unparseable value is a photo value we do not understand — never overwrite it
  }
};

const NO_PHOTO_SQL = "(photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]')";

/**
 * Fetch one photo link into the app's own photo storage.
 * Returns { url } (the internal /api/photos/<id> URL) or
 * { problem } with the plain-words reason — the same wordings
 * the 365 door named its failures with.
 */
export async function fetchPhotoToStorage(
  pool,
  businessId,
  rawUrl,
  origin,
  { fetchImpl = fetch, timeoutMs = PHOTO_FETCH_TIMEOUT_MS } = {},
) {
  const url = String(rawUrl || '').trim();
  if (!isPhotoLink(url)) return { problem: 'The photo link is not a web address.' };
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { problem: 'The photo link could not be reached.' };
  }
  if (!response.ok) return { problem: 'The photo link could not be reached.' };
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) return { problem: 'The photo link returned an empty file.' };
  if (buffer.length > PHOTO_MAX_BYTES) {
    return { problem: 'The photo at that link is over 25 MB — too large to bring in.' };
  }
  const mime = photoMime(buffer, response.headers.get('content-type'));
  if (!mime) return { problem: 'The link did not return a PNG, JPG or WebP photo.' };
  const id = crypto.randomUUID();
  await pool.query(
    'INSERT INTO product_photos (id, business_id, content_type, size_bytes, data_base64) VALUES ($1, $2, $3, $4, $5)',
    [id, businessId, mime, buffer.length, buffer.toString('base64')],
  );
  return { url: `${origin || ''}/api/photos/${id}` };
}

/**
 * Enqueue a photo job for a product, unless one is already
 * active for it (queued or fetching). Returns the job row, or
 * null when an active job already exists (a duplicate enqueue
 * is a no-op — the door is idempotent by construction).
 */
export async function enqueuePhotoJob(pool, { businessId, productId, sourceUrl, origin = '' }) {
  const url = String(sourceUrl || '').trim();
  if (!businessId || !productId || !isPhotoLink(url)) return null;
  const active = (
    await pool.query(
      "SELECT id FROM photo_jobs WHERE product_id = $1 AND status IN ('queued', 'fetching') LIMIT 1",
      [productId],
    )
  ).rows[0];
  if (active) return null;
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO photo_jobs (id, business_id, product_id, source_url, origin)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, businessId, productId, url, origin || ''],
  );
  return { id, business_id: businessId, product_id: productId, source_url: url };
}

/**
 * The recovery door's enqueue pass: every product of the
 * business that has a photo link on file and no photo yet gets
 * a job. Never creates a product, never touches one that has
 * its photo. Returns { missing, enqueued } — missing counts
 * the eligible products found, enqueued the jobs actually
 * added (a product already waiting on an active job counts as
 * missing but adds nothing new).
 */
export async function enqueueMissingPhotoJobs(pool, { businessId, origin = '' }) {
  const rows = (
    await pool.query(
      `SELECT id, photo_source_url FROM products
        WHERE business_id = $1 AND photo_source_url <> '' AND ${NO_PHOTO_SQL}`,
      [businessId],
    )
  ).rows;
  let enqueued = 0;
  for (const row of rows) {
    const job = await enqueuePhotoJob(pool, {
      businessId,
      productId: row.id,
      sourceUrl: row.photo_source_url,
      origin,
    });
    if (job) enqueued += 1;
  }
  return { missing: rows.length, enqueued };
}

/**
 * The visible truth for one business: of the products that
 * carry a photo link, how many have their photo in, how many
 * are still on their way (an active job), and how many carry a
 * named photo problem.
 */
export async function photoProgress(pool, businessId) {
  const counts = (
    await pool.query(
      `SELECT
         COUNT(*)::int AS with_link,
         COALESCE(SUM(CASE WHEN NOT ${NO_PHOTO_SQL} THEN 1 ELSE 0 END), 0)::int AS with_photo,
         COALESCE(SUM(CASE WHEN photo_problem <> '' THEN 1 ELSE 0 END), 0)::int AS with_problem
       FROM products WHERE business_id = $1 AND photo_source_url <> ''`,
      [businessId],
    )
  ).rows[0];
  const active = (
    await pool.query(
      "SELECT COUNT(*)::int AS n FROM photo_jobs WHERE business_id = $1 AND status IN ('queued', 'fetching')",
      [businessId],
    )
  ).rows[0].n;
  const withLink = counts?.with_link ?? 0;
  const withPhoto = counts?.with_photo ?? 0;
  return {
    withLink,
    withPhoto,
    missing: Math.max(0, withLink - withPhoto),
    pending: active,
    withProblem: counts?.with_problem ?? 0,
  };
}

const markProductPhoto = async (pool, job, url) => {
  await pool.query('UPDATE products SET photo_urls = $2, photo_problem = \'\' WHERE id = $1', [
    job.product_id,
    JSON.stringify([url]),
  ]);
};

const finishJob = async (pool, job, status, problem = '') => {
  await pool.query(
    'UPDATE photo_jobs SET status = $2, last_problem = $3, updated_at = NOW() WHERE id = $1',
    [job.id, status, problem],
  );
};

/** One job's fetch attempt. Never throws. */
async function runPhotoJob(pool, job, { fetchImpl, timeoutMs, backoffMs, now }) {
  const attempts = (job.attempts || 0) + 1;
  await pool.query('UPDATE photo_jobs SET attempts = $2, updated_at = NOW() WHERE id = $1', [job.id, attempts]);
  // A photo that arrived by another road while this job waited
  // (an earlier job, a hand upload) ends the job quietly — the
  // door never overwrites a photo that is already there.
  const product = (
    await pool.query('SELECT photo_urls FROM products WHERE id = $1 AND business_id = $2', [job.product_id, job.business_id])
  ).rows[0];
  if (!product) {
    await finishJob(pool, job, 'failed', 'The product is no longer in the catalog.');
    return 'failed';
  }
  if (!photoUrlsEmpty(product.photo_urls)) {
    await pool.query("UPDATE products SET photo_problem = '' WHERE id = $1", [job.product_id]);
    await finishJob(pool, job, 'done');
    return 'done';
  }
  const fetched = await fetchPhotoToStorage(pool, job.business_id, job.source_url, job.origin, { fetchImpl, timeoutMs });
  if (fetched.url) {
    // Re-check before writing: the photo may have landed while
    // this fetch was in flight.
    const fresh = (
      await pool.query('SELECT photo_urls FROM products WHERE id = $1', [job.product_id])
    ).rows[0];
    if (fresh && !photoUrlsEmpty(fresh.photo_urls)) {
      await pool.query("UPDATE products SET photo_problem = '' WHERE id = $1", [job.product_id]);
    } else {
      await markProductPhoto(pool, job, fetched.url);
    }
    await finishJob(pool, job, 'done');
    return 'done';
  }
  if (attempts >= PHOTO_MAX_ATTEMPTS) {
    // The failure is named on the product itself, where the
    // owner works — not only on a screen that can be missed.
    await pool.query('UPDATE products SET photo_problem = $2 WHERE id = $1', [job.product_id, fetched.problem]);
    await finishJob(pool, job, 'failed', fetched.problem);
    return 'failed';
  }
  const backoff = backoffMs[Math.min(attempts - 1, backoffMs.length - 1)] ?? 30 * 1000;
  await pool.query(
    "UPDATE photo_jobs SET status = 'queued', next_attempt_at = $2, last_problem = $3, updated_at = NOW() WHERE id = $1",
    [job.id, new Date(now.getTime() + backoff).toISOString(), fetched.problem],
  );
  return 'retried';
}

let draining = false;

/**
 * One drain of the photo queue: re-queue claims stranded by a
 * dead process, claim the due jobs, and fetch them a few at a
 * time. Durable by construction — all state lives in
 * photo_jobs rows, so a restart mid-drain loses nothing.
 * Overlap-guarded in-process. Never throws.
 */
export async function drainPhotoJobs(
  pool,
  {
    now = new Date(),
    logger = console,
    fetchImpl = fetch,
    timeoutMs = PHOTO_FETCH_TIMEOUT_MS,
    backoffMs = PHOTO_RETRY_BACKOFF_MS,
    concurrency = PHOTO_FETCH_CONCURRENCY,
    batch = PHOTO_JOB_BATCH,
  } = {},
) {
  if (!pool) return null;
  if (draining) return null;
  draining = true;
  const summary = { claimed: 0, done: 0, failed: 0, retried: 0 };
  try {
    const staleBefore = new Date(now.getTime() - PHOTO_CLAIM_STALE_MS).toISOString();
    await pool.query(
      "UPDATE photo_jobs SET status = 'queued', next_attempt_at = $1, updated_at = NOW() WHERE status = 'fetching' AND updated_at < $2",
      [now.toISOString(), staleBefore],
    );
    const due = (
      await pool.query(
        `SELECT * FROM photo_jobs
          WHERE status = 'queued' AND next_attempt_at <= $1
          ORDER BY created_at ASC LIMIT $2`,
        [now.toISOString(), batch],
      )
    ).rows;
    const claimed = [];
    for (const job of due) {
      const claim = await pool.query(
        "UPDATE photo_jobs SET status = 'fetching', updated_at = NOW() WHERE id = $1 AND status = 'queued'",
        [job.id],
      );
      if (claim.rowCount > 0) claimed.push(job);
    }
    summary.claimed = claimed.length;
    for (let i = 0; i < claimed.length; i += concurrency) {
      const slice = claimed.slice(i, i + concurrency);
      const outcomes = await Promise.all(
        slice.map((job) =>
          runPhotoJob(pool, job, { fetchImpl, timeoutMs, backoffMs, now }).catch((error) => {
            logger.error(`[twin] photo job ${job.id} failed unexpectedly: ${error.message}`);
            return 'retried';
          }),
        ),
      );
      for (const outcome of outcomes) {
        if (outcome === 'done') summary.done += 1;
        else if (outcome === 'failed') summary.failed += 1;
        else summary.retried += 1;
      }
    }
    return summary;
  } catch (error) {
    logger.error(`[twin] photo job drain failed: ${error.message}`);
    return summary;
  } finally {
    draining = false;
  }
}

/**
 * Fire-and-forget drain kick for the doors that enqueue (the
 * importer, the recovery button): photos start arriving right
 * away instead of waiting for the scheduler's next tick. The
 * scheduler remains the guarantee — a kick that finds a drain
 * already running simply lets that drain (and the next tick)
 * carry the work.
 */
export function kickPhotoDrain(pool, { logger = console } = {}) {
  void drainPhotoJobs(pool, { logger });
}

export const PHOTO_SWEEP_INTERVAL_MS = 60 * 1000;
export const PHOTO_SWEEP_BOOT_DELAY_MS = 20 * 1000;

/**
 * Start the photo worker: a boot run shortly after listen,
 * then a tick every minute — photos enqueued by an import are
 * on their way within moments, and retries fall due on their
 * backoff without any outside caller. Failure-isolated and
 * overlap-guarded, in the sweep scheduler's shape. Timers are
 * unref'd.
 */
export function startPhotoJobScheduler({
  getPoolFn,
  logger = console,
  intervalMs = PHOTO_SWEEP_INTERVAL_MS,
  bootDelayMs = PHOTO_SWEEP_BOOT_DELAY_MS,
} = {}) {
  let stopped = false;
  const runOnce = async (source = 'tick') => {
    try {
      const pool = typeof getPoolFn === 'function' ? getPoolFn() : null;
      if (!pool) return null;
      return await drainPhotoJobs(pool, { logger });
    } catch (error) {
      logger.error(`[twin] photo job scheduler (${source}) failed: ${error.message}`);
      return null;
    }
  };
  const bootTimer = setTimeout(() => { if (!stopped) void runOnce('boot'); }, bootDelayMs);
  bootTimer.unref?.();
  const intervalTimer = setInterval(() => { if (!stopped) void runOnce('interval'); }, intervalMs);
  intervalTimer.unref?.();
  logger.log(`[twin] photo job worker enabled (boot run in ${Math.round(bootDelayMs / 1000)}s, then every ${Math.round(intervalMs / 1000)}s).`);
  return {
    enabled: true,
    runOnce,
    stop() {
      stopped = true;
      clearTimeout(bootTimer);
      clearInterval(intervalTimer);
    },
  };
}
