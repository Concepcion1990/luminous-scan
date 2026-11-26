/**
 * The barcode pool — pure core (Nov 25, 2026).
 *
 * The owner's spec (print-code-pool/spec.md): the Print section
 * mints barcodes with NO product attached. The codes wait in a
 * per-business pool; printed labels carry them onto goods that
 * have no barcode of their own; a later scan of an unclaimed
 * pool code offers the add-product road with the code carried
 * into the form.
 *
 * THE FORMAT: `SHP-XXXXXXXX` — eight characters from the Code
 * 128 alphabet (the same alphabet the per-product generator's
 * code128 kind draws from), at least one letter and one digit.
 *   - Distinguishable as the app's own: the SHP- prefix is the
 *     pool's mark. It differs from the product generator's SH-
 *     house codes, and no real retail code (UPC, EAN, ISBN —
 *     all digits) can ever look like it.
 *   - Scannable: the label engine draws it as Code 128 subset
 *     B, exactly like the SH- codes it already prints.
 *   - Roomy: 36^8 candidates, and uniqueness is enforced
 *     against the business's products, its GTIN ledger, its
 *     existing pool, and a table-wide unique index on the code
 *     itself — a minted code is never handed out twice and
 *     never belongs to another business.
 *
 * A pool code is CLAIMED when a product in the SAME business
 * holds it in any code field (sku, upc, barcode, qr_code,
 * isbn) under the scanner's own matching discipline (the
 * codeForms of server/codeGenerator.js). The claim is derived
 * at read time, never written: the moment the add-product form
 * saves the product carrying the code, the code is a normal
 * product code and the scanner finds the product first, as it
 * does for every code.
 */
import crypto from 'node:crypto';
import { codeForms, isTaken, loadTakenCodes } from './codeGenerator.js';

export const POOL_PREFIX = 'SHP-';
export const POOL_CODE_RE = /^SHP-[A-Z0-9]{8}$/;

const POOL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const defaultRng = (maxExclusive) => crypto.randomInt(maxExclusive);

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/** True when a value is shaped like a pool code (any case, the
 *  scanner's loose separators tolerated). Shape only — whether
 *  the code is IN a business's pool is a database question. */
export function isPoolCodeShape(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (POOL_CODE_RE.test(raw)) return true;
  const stripped = raw.replace(/[\s-]/g, '');
  return POOL_CODE_RE.test(stripped.replace(/^SHP/, 'SHP-'));
}

/** One pool candidate, before the uniqueness check. */
export function mintPoolCandidate({ rng = defaultRng } = {}) {
  let tail = '';
  do {
    tail = '';
    for (let i = 0; i < 8; i += 1) tail += POOL_ALPHABET[rng(POOL_ALPHABET.length)];
  } while (!/[A-Z]/.test(tail) || !/\d/.test(tail));
  return `${POOL_PREFIX}${tail}`;
}

/** How many codes the owner asked for. Her ruling: NO LIMIT —
 *  any whole number of one or more is accepted as asked. */
export function cleanPoolCount(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    throw err(400, 'pool_count', 'Say how many barcodes you need — a whole number of one or more.');
  }
  return n;
}

/** `count` candidates, unique against the taken set AND within
 *  the batch itself (the taken set grows as candidates land). */
export function mintPoolBatch(taken, count, { rng = defaultRng } = {}) {
  const codes = [];
  let guard = count * 60 + 60;
  while (codes.length < count) {
    guard -= 1;
    if (guard < 0) {
      throw err(500, 'code_mint_exhausted', 'Could not mint a unique code — please try again.');
    }
    const candidate = mintPoolCandidate({ rng });
    if (isTaken(taken, candidate)) continue;
    for (const form of codeForms(candidate)) taken.add(form);
    codes.push(candidate);
  }
  return codes;
}

/** Every code form a business's PRODUCTS hold — the claim test.
 *  (loadTakenCodes also folds in the GTIN ledger and the pool
 *  itself; a claim is about products only, so this is its own
 *  read.) */
export async function loadProductCodeForms(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT sku, upc, barcode, qr_code, isbn FROM products WHERE business_id = $1',
    [businessId],
  );
  const forms = new Set();
  for (const row of rows) {
    for (const value of [row.sku, row.upc, row.barcode, row.qr_code, row.isbn]) {
      for (const form of codeForms(value)) forms.add(form);
    }
  }
  return forms;
}

/** Is this pool code claimed by a product of the business? */
export function poolCodeClaimed(code, productForms) {
  return isTaken(productForms, code);
}

async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Mint `count` new codes into the business's pool and return
 * them. The taken set covers the business's products, its spent
 * GTINs and its existing pool (loadTakenCodes), so a pool code
 * can never shadow a product under any reading; the table-wide
 * unique index on code is the last guard — a violation retries
 * the whole batch with fresh candidates.
 */
export async function mintPoolCodes(pool, businessId, count, { userId = null, rng } = {}) {
  const taken = await loadTakenCodes(pool, businessId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const codes = mintPoolBatch(new Set(taken), count, { rng });
    try {
      await withTx(pool, async (client) => {
        const CHUNK = 500;
        for (let i = 0; i < codes.length; i += CHUNK) {
          const slice = codes.slice(i, i + CHUNK);
          const values = [];
          const params = [];
          slice.forEach((code, j) => {
            const base = j * 4;
            values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
            params.push(crypto.randomUUID(), businessId, code, userId);
          });
          await client.query(
            `INSERT INTO barcode_pool_codes (id, business_id, code, created_by_id) VALUES ${values.join(', ')}`,
            params,
          );
        }
      });
      return codes;
    } catch (error) {
      if (error?.code === '23505' && attempt < 2) continue;
      throw error;
    }
  }
  throw err(500, 'code_mint_exhausted', 'Could not mint a unique code — please try again.');
}

/** The business's pool at a glance: how many codes it holds and
 *  how many still wait unclaimed. */
export async function poolSummary(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT code FROM barcode_pool_codes WHERE business_id = $1 ORDER BY created_at ASC',
    [businessId],
  );
  const productForms = await loadProductCodeForms(pool, businessId);
  const waiting = rows.filter((row) => !poolCodeClaimed(row.code, productForms)).length;
  return { total: rows.length, waiting };
}

/**
 * The scan question: is this code one of THIS business's pool
 * codes, and has a product claimed it yet? A code from another
 * business's pool answers { pool: false } — it is not this
 * business's to claim, and the scan keeps the honest no-match.
 */
export async function checkPoolCode(pool, businessId, rawCode) {
  const forms = codeForms(rawCode);
  if (!forms.length) return { pool: false, claimed: false };
  const { rows } = await pool.query(
    'SELECT code FROM barcode_pool_codes WHERE business_id = $1',
    [businessId],
  );
  const mine = rows.find((row) => forms.some((form) => codeForms(row.code).includes(form)));
  if (!mine) return { pool: false, claimed: false };
  const productForms = await loadProductCodeForms(pool, businessId);
  return { pool: true, claimed: poolCodeClaimed(mine.code, productForms), code: mine.code };
}
