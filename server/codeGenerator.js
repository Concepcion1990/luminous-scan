/**
 * The code generator (owner feature, Nov 15, 2026): handmade and
 * own-brand products arrive with no code on the box, so the product
 * form grows a "Generate a code" box — pick a kind, the app invents
 * a code, and it lands in the matching field like a typed one.
 *
 * Six kinds, her list: UPC, SKU, Code 128, Barcode, EAN, QR.
 *   upc     → the UPC/EAN field. A TRUE UPC-A: 12 digits, correct
 *             check digit, drawn from the reserved in-store ranges
 *             (prefix 04 or 20–29 — restricted circulation), so the
 *             label engine draws it as real UPC-A. An in-store
 *             code, NOT a GS1-registered retail barcode; the form
 *             says so beside the button.
 *   ean     → the UPC/EAN field. A TRUE EAN-13: 13 digits, correct
 *             check digit, from the internal-use range (200–299),
 *             drawn as real EAN-13 by the same engine.
 *   sku     → the SKU field, in the catalog's own auto-SKU style
 *             (the name slug, ITEM-<n> when the name slugs to
 *             nothing, -2/-3… until free) — the same scheme
 *             generateProductSku uses for a blank SKU at save.
 *   code128 → the Barcode field. An alphanumeric house code
 *             (SH-XXXXXXXX) built for Code 128 subset B, the
 *             symbology the label engine draws it in.
 *   barcode → the Barcode field. The app's standard numeric
 *             barcode value: 12 digits.
 *   qr      → the QR code field. A unique house string
 *             (SH-XXXXXXXXXX, unambiguous characters).
 *
 * Uniqueness is a SERVER guarantee over the whole code identity
 * space: a minted code must not equal ANY existing code of ANY
 * kind in the business (sku, upc, barcode, qr_code — isbn too,
 * since the scanner resolves ISBNs as codes). Comparison uses the
 * scanner's own matching discipline (case-insensitive, separators
 * ignored), so a minted code cannot shadow another product under
 * a looser reading either. Mint-and-check retries until the code
 * is free; nothing is written by this module — the code is only
 * real once the product itself saves, and the form runs the same
 * code-belongs-to-another-product courtesy check a scan does.
 */
import crypto from 'node:crypto';

export const CODE_TYPES = ['upc', 'sku', 'code128', 'barcode', 'ean', 'qr'];
export const CODE_FIELDS = {
  upc: 'upc',
  ean: 'upc',
  sku: 'sku',
  code128: 'barcode',
  barcode: 'barcode',
  qr: 'qr_code',
};

/** Check digits mirror src/lib/barcodeSym.js exactly — the label
 *  engine accepts a minted UPC/EAN as its true symbology only if
 *  these agree with its copy. */
export function upcCheckDigit(first11) {
  let sum = 0;
  for (let i = 0; i < 11; i += 1) sum += Number(first11[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

export function eanCheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

const defaultRng = (maxExclusive) => crypto.randomInt(maxExclusive);

function randomDigits(rng, count) {
  let out = '';
  for (let i = 0; i < count; i += 1) out += String(rng(10));
  return out;
}

const CODE128_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const QR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L look-alikes

function randomChars(rng, alphabet, count) {
  let out = '';
  for (let i = 0; i < count; i += 1) out += alphabet[rng(alphabet.length)];
  return out;
}

/** The name slug, identical to server/entities.js slugSku — the
 *  generated SKU must read like every other auto-SKU in the app. */
export function slugSku(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

/** One candidate of a kind, before the uniqueness check. SKU is
 *  the exception: its candidate is the base the disambiguation
 *  loop walks from. */
export function mintCandidate(type, { name = '', rng = defaultRng } = {}) {
  switch (type) {
    case 'upc': {
      // Reserved in-store ranges: prefix 04, or 20–29.
      const prefixes = ['04', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29'];
      const body = prefixes[rng(prefixes.length)] + randomDigits(rng, 9);
      return body + String(upcCheckDigit(body));
    }
    case 'ean': {
      // Internal-use range 200–299: '2' + one digit + ten digits.
      const body = `2${randomDigits(rng, 11)}`;
      return body + String(eanCheckDigit(body));
    }
    case 'sku':
      return slugSku(name) || 'ITEM';
    case 'code128': {
      let tail = '';
      do {
        tail = randomChars(rng, CODE128_ALPHABET, 8);
      } while (!/[A-Z]/.test(tail) || !/\d/.test(tail));
      return `SH-${tail}`;
    }
    case 'barcode':
      return randomDigits(rng, 12);
    case 'qr': {
      let tail = '';
      do {
        tail = randomChars(rng, QR_ALPHABET, 10);
      } while (!/\d/.test(tail));
      return `SH-${tail}`;
    }
    default:
      throw Object.assign(new Error(`Unknown code type: ${type}`), {
        status: 400,
        code: 'invalid_code_type',
      });
  }
}

/** The forms under which the scanner can meet a code: as stored,
 *  upper-cased, and with separators stripped (its loose pass).
 *  A minted code must be free under every form. */
export function codeForms(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const upper = raw.toUpperCase();
  return [...new Set([upper, upper.replace(/[\s-]/g, '')])];
}

export function isTaken(taken, candidate) {
  return codeForms(candidate).some((form) => taken.has(form));
}

/** Every code form already held by the business, across all five
 *  code-bearing columns — plus every GTIN ever minted in GS1 mode
 *  (a spent retail number is taken forever, even after the product
 *  that carried it is deleted). */
export async function loadTakenCodes(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT sku, upc, barcode, qr_code, isbn FROM products WHERE business_id = $1',
    [businessId],
  );
  const taken = new Set();
  for (const row of rows) {
    for (const value of [row.sku, row.upc, row.barcode, row.qr_code, row.isbn]) {
      for (const form of codeForms(value)) taken.add(form);
    }
  }
  const minted = await pool.query(
    'SELECT gtin FROM minted_gtins WHERE business_id = $1',
    [businessId],
  );
  for (const row of minted.rows) {
    for (const form of codeForms(row.gtin)) taken.add(form);
  }
  return taken;
}

const MAX_ATTEMPTS = 60;

/** Mint against a prepared taken-set (the testable core). SKU
 *  walks the catalog's own -2/-3 ladder; the random kinds redraw
 *  until free. */
export function mintAgainstTaken(type, taken, { name = '', rng = defaultRng, productCount = 0 } = {}) {
  if (type === 'sku') {
    let base = mintCandidate('sku', { name, rng });
    if (base === 'ITEM') base = `ITEM-${productCount + 1}`;
    let candidate = base;
    let attempt = 2;
    // The ladder always terminates: every rung is a new string and
    // the taken set is finite. The cap exists only so a pathological
    // set fails loudly instead of returning a code that is taken.
    while (isTaken(taken, candidate)) {
      candidate = `${base}-${attempt}`;
      attempt += 1;
      if (attempt > taken.size + 100) {
        throw Object.assign(new Error('Could not mint a unique code — please try again.'), {
          status: 500,
          code: 'code_mint_exhausted',
        });
      }
    }
    return candidate;
  }
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const candidate = mintCandidate(type, { name, rng });
    if (!isTaken(taken, candidate)) return candidate;
  }
  throw Object.assign(new Error('Could not mint a unique code — please try again.'), {
    status: 500,
    code: 'code_mint_exhausted',
  });
}

/** The route's door: load the business's codes, mint a free one. */
export async function mintUniqueCode(pool, businessId, type, { name = '', rng } = {}) {
  const taken = await loadTakenCodes(pool, businessId);
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1',
    [businessId],
  );
  return mintAgainstTaken(type, taken, { name, rng, productCount: rows[0]?.n || 0 });
}

/* ------------------------------------------------------------------ */
/* GS1 mode (owner ruling, Nov 15, 2026): owners who license their   */
/* own GS1 company prefix enter it once in Settings, and the         */
/* generator mints TRUE retail GTINs from their numbers.             */
/*                                                                   */
/* - The prefix is the owner's, from her own GS1 license. The app    */
/*   never invents or suggests one. Validation: digits, 6–11 — GS1   */
/*   issues prefixes at varying lengths, and longer ones are         */
/*   welcome (owner ruling, Nov 20, 2026). A 10-digit prefix still    */
/*   leaves one GTIN-12 item-reference digit; an 11-digit prefix     */
/*   leaves one for GTIN-13 and none for GTIN-12, whose capacity     */
/*   then reads zero and refuses honestly below. A 12-digit prefix   */
/*   could mint neither kind, so it is refused at the field.         */
/* - Item references run sequentially per (business, prefix, kind)   */
/*   from the minted_gtins ledger (migration 028) and are NEVER      */
/*   reused: the ledger row is written at mint time and survives     */
/*   product deletes. A reference whose GTIN already sits in the     */
/*   catalog as a typed code is spent anyway — burned, never         */
/*   handed out — and the walk moves to the next reference.          */
/* - Capacity is arithmetic, not a promise: 10^(reference digits).   */
/*   At the wall the mint refuses with gs1_exhausted, and the form   */
/*   names the door (a larger prefix from GS1).                      */
/* ------------------------------------------------------------------ */

export const GS1_KINDS = { 'gs1-upc': 'gtin12', 'gs1-ean': 'gtin13' };

export function validateGs1Prefix(text) {
  return text === '' || /^\d{6,11}$/.test(text);
}

export function gs1RefDigits(prefix, kind) {
  return (kind === 'gtin12' ? 11 : 12) - String(prefix).length;
}

export function gs1Capacity(prefix, kind) {
  const digits = gs1RefDigits(prefix, kind);
  return digits > 0 ? 10 ** digits : 0;
}

/** prefix + zero-padded sequential reference + the GS1 check
 *  digit (the same algorithms barcodeSym verifies with). */
export function buildGtin(prefix, kind, reference) {
  const ref = String(reference).padStart(gs1RefDigits(prefix, kind), '0');
  const body = String(prefix) + ref;
  return body + String(kind === 'gtin12' ? upcCheckDigit(body) : eanCheckDigit(body));
}

async function loadGs1Prefix(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT gs1_prefix FROM businesses WHERE id = $1',
    [businessId],
  );
  return String(rows[0]?.gs1_prefix || '').trim();
}

/** What the form needs to know before offering a GS1 mint: is a
 *  prefix set, and how many codes of each kind remain under it. */
export async function gs1State(pool, businessId) {
  const prefix = await loadGs1Prefix(pool, businessId);
  if (!prefix) return { prefixSet: false, remaining: { gtin12: 0, gtin13: 0 } };
  const { rows } = await pool.query(
    'SELECT kind, COUNT(*)::int AS n FROM minted_gtins WHERE business_id = $1 AND prefix = $2 GROUP BY kind',
    [businessId, prefix],
  );
  const used = { gtin12: 0, gtin13: 0 };
  for (const row of rows) used[row.kind] = row.n;
  return {
    prefixSet: true,
    remaining: {
      gtin12: Math.max(0, gs1Capacity(prefix, 'gtin12') - used.gtin12),
      gtin13: Math.max(0, gs1Capacity(prefix, 'gtin13') - used.gtin13),
    },
  };
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

/** Mint the next GTIN from the business's own prefix. Writes the
 *  ledger row inside the mint transaction; unique violations (a
 *  race for the same reference) retry the whole walk. */
export async function mintGs1Code(pool, businessId, type, userId = null) {
  const kind = GS1_KINDS[type];
  if (!kind) {
    throw Object.assign(new Error(`Unknown GS1 code type: ${type}`), {
      status: 400,
      code: 'invalid_code_type',
    });
  }
  const prefix = await loadGs1Prefix(pool, businessId);
  if (!prefix) {
    throw Object.assign(
      new Error('Add your GS1 company prefix in Settings first — retail codes are minted only from your own licensed prefix.'),
      { status: 400, code: 'gs1_prefix_missing' },
    );
  }
  const capacity = gs1Capacity(prefix, kind);
  const taken = await loadTakenCodes(pool, businessId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await withTx(pool, async (client) => {
        const { rows } = await client.query(
          'SELECT COALESCE(MAX(item_reference), -1) AS max_ref FROM minted_gtins WHERE business_id = $1 AND prefix = $2 AND kind = $3',
          [businessId, prefix, kind],
        );
        let next = (rows[0]?.max_ref ?? -1) + 1;
        while (next < capacity) {
          const gtin = buildGtin(prefix, kind, next);
          await client.query(
            `INSERT INTO minted_gtins (id, business_id, prefix, kind, item_reference, gtin, created_by_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [crypto.randomUUID(), businessId, prefix, kind, next, gtin, userId],
          );
          if (!isTaken(taken, gtin)) return { code: gtin, kind, reference: next };
          next += 1; // already in the catalog as a typed code: spent, walk on
        }
        throw Object.assign(
          new Error(`Your GS1 prefix has no ${kind === 'gtin12' ? 'UPC' : 'EAN'} codes left. A larger prefix from GS1 gives you more.`),
          { status: 409, code: 'gs1_exhausted' },
        );
      });
    } catch (error) {
      if (error?.code === '23505' && attempt < 2) continue;
      throw error;
    }
  }
  throw Object.assign(new Error('Could not mint a GS1 code — please try again.'), {
    status: 500,
    code: 'code_mint_exhausted',
  });
}
