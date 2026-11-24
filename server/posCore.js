/**
 * POS shared core — the provider-agnostic heart of the POS phase.
 *
 * The owner's decision (Nov 12, 2026): when somebody purchases
 * merchandise at the till, it reflects in the app's inventory.
 * Square and Shopify POS land on this core together; Clover,
 * Toast, Lightspeed, PayPal Zettle, Stripe Terminal and Wix POS
 * arrive later as new ADAPTERS (a normalizer + a webhook route)
 * over these same functions and tables — never a rewrite.
 *
 * A provider adapter turns its payload into ONE normalized sale:
 *   { externalSaleId, soldAt, locationLabel, locationId,
 *     totalAmount, totalCurrency,
 *     lines: [{ providerItemKey, itemLabel, sku, upc, isbn, quantity }] }
 * and calls applyPosSale(). Everything after that is shared:
 *
 *   IDEMPOTENCY — (business_id, provider, external_sale_id) is
 *   UNIQUE. The event row is inserted FIRST; a redelivery (webhook
 *   retry, provider resend, CSV re-import) finds the row and
 *   returns the recorded outcome. Nothing ever double-counts.
 *
 *   MATCHING — a line finds its product two ways:
 *   1. a saved pos_item_mappings row for its provider item key;
 *   2. the THREE-KEY match (the owner's ruling, Nov 23, 2026:
 *      a storefront sale communicates "with either the SKU and
 *      the UPC as well as the ISBN — those three, either or").
 *      Each key the line carries is compared, normalized, with
 *      the product field of the same name (the UPC key also
 *      reads the product's barcode field — the printed retail
 *      code lives in either). Any ONE key matching exactly one
 *      product applies the sale — but the matcher NEVER
 *      guesses: if the present keys point at different
 *      products, or any single key matches more than one
 *      product, the line is HELD for a person to link.
 *   No match → the line is HELD as 'unmatched' (no movement is
 *   written) until a person maps the item on the mapping screen.
 *
 *   APPLICATION — an applied line writes a SALE movement through
 *   the EXISTING ledger (server/movements.js recordMovementTx) —
 *   there is no parallel stock writer. Stock never goes negative:
 *   a line asking for more than is on hand is marked
 *   'insufficient_stock', the event goes 'partially_applied',
 *   and the other lines still apply. Nothing is ever silent.
 *
 *   LOCATION — a till deducts from the connection's chosen app
 *   location; falling back to a location whose name matches the
 *   sale's reported label, then to the business's first location.
 */
import crypto from 'node:crypto';
import { getLevel, recordMovementTx, withTx } from './movements.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export const POS_PROVIDER_LABELS = {
  square: 'Square',
  shopify: 'Shopify',
  clover: 'Clover',
  toast: 'Toast',
  lightspeed: 'Lightspeed',
  zettle: 'PayPal Zettle',
  stripe_terminal: 'Stripe Terminal',
  wix: 'Wix',
  ebay: 'eBay',
  csv: 'CSV import',
};

/** The event status, derived from its lines — one rule everywhere. */
export function eventStatusForLines(lines) {
  if (!lines.length) return 'refused';
  const applied = lines.filter((l) => l.status === 'applied').length;
  const ignored = lines.filter((l) => l.status === 'ignored').length;
  const unmatched = lines.filter((l) => l.status === 'unmatched').length;
  const insufficient = lines.filter((l) => l.status === 'insufficient_stock').length;
  const heldPlan = lines.filter((l) => l.status === 'held_plan').length;
  if (applied > 0 && applied + ignored === lines.length) return 'applied';
  if (applied > 0) return 'partially_applied';
  if (heldPlan > 0) return 'held_plan';
  if (unmatched > 0) return 'held_unmatched';
  if (insufficient > 0) return 'partially_applied';
  return 'refused';
}

async function recomputeEventStatus(client, eventId) {
  const { rows } = await client.query('SELECT status FROM pos_sale_lines WHERE event_id = $1', [eventId]);
  const status = eventStatusForLines(rows);
  await client.query('UPDATE pos_sale_events SET status = $1, updated_at = NOW() WHERE id = $2', [status, eventId]);
  return status;
}

async function loadProducts(client, businessId) {
  const { rows } = await client.query(
    'SELECT * FROM products WHERE business_id = $1 ORDER BY created_at ASC LIMIT 5000',
    [businessId],
  );
  return rows;
}

const ci = (value) => String(value || '').trim().toLowerCase();

/**
 * Key normalization (release 364): identifiers are compared
 * the way people type and print them — trimmed, with spaces
 * and hyphens removed ("978-3-16-148410-0" is "9783161484100").
 * SKUs compare case-insensitively on top of that; codes
 * compare uppercased so an ISBN-10's X check letter is itself
 * however it was typed.
 */
const normSku = (value) => String(value || '').trim().replace(/[\s-]+/g, '').toLowerCase();
const normCode = (value) => String(value || '').trim().replace(/[\s-]+/g, '').toUpperCase();

function isbn13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

function isbn10CheckDigit(first9) {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += (10 - i) * Number(first9[i]);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? 'X' : String(check);
}

/**
 * The equivalent forms of one ISBN: itself, plus — for a
 * 978-prefixed ISBN-13 — its ISBN-10 twin, and for an
 * ISBN-10 its 978-prefixed ISBN-13 twin (the same book in
 * its two printed forms). A 979 ISBN-13 has no ISBN-10
 * twin and matches only itself. The twin is computed
 * mechanically from the digits, so the forms equate even
 * when one side was typed without its check digit's care.
 */
export function isbnForms(value) {
  const s = normCode(value);
  const forms = new Set();
  if (!s) return forms;
  forms.add(s);
  if (/^\d{9}[\dX]$/.test(s)) {
    const base = `978${s.slice(0, 9)}`;
    forms.add(base + isbn13CheckDigit(base));
  } else if (/^978\d{10}$/.test(s)) {
    const nine = s.slice(3, 12);
    forms.add(nine + isbn10CheckDigit(nine));
  }
  return forms;
}

/**
 * The THREE-KEY match (release 364, the owner's ruling,
 * Nov 23, 2026): a sale line carries up to three identifier
 * keys — SKU, UPC, ISBN — and any ONE of them, matching
 * exactly one product, applies the sale. The keys are
 * judged together and the matcher never guesses:
 *   - a key that matches MORE THAN ONE product makes the
 *     line ambiguous → held for a person;
 *   - keys that point at DIFFERENT products conflict → held;
 *   - keys that agree on one product, or a single key
 *     matching one product while the others match nothing,
 *     → that product.
 * Returns the product, or null (no match, ambiguous, or
 * conflicted — the caller holds the line either way).
 */
export function matchProductByKeys(products, { sku, upc, isbn } = {}) {
  const perKey = [];
  const skuKey = normSku(sku);
  if (skuKey) perKey.push(products.filter((p) => normSku(p.sku) === skuKey));
  const upcKey = normCode(upc);
  if (upcKey) {
    perKey.push(products.filter((p) => normCode(p.upc) === upcKey || normCode(p.barcode) === upcKey));
  }
  const isbnKeyForms = isbnForms(isbn);
  if (isbnKeyForms.size) {
    perKey.push(products.filter((p) => {
      const productForms = isbnForms(p.isbn);
      return [...isbnKeyForms].some((form) => productForms.has(form));
    }));
  }
  if (!perKey.length) return null;
  if (perKey.some((matches) => matches.length > 1)) return null;
  const agreed = new Map();
  for (const matches of perKey) {
    if (matches[0]) agreed.set(matches[0].id, matches[0]);
  }
  if (agreed.size !== 1) return null;
  return [...agreed.values()][0];
}

async function mappingFor(client, businessId, provider, providerItemKey) {
  if (!providerItemKey) return null;
  const { rows } = await client.query(
    'SELECT * FROM pos_item_mappings WHERE business_id = $1 AND provider = $2 AND provider_item_key = $3 LIMIT 1',
    [businessId, provider, providerItemKey],
  );
  return rows[0] ?? null;
}

export async function resolveSaleLocation(client, businessId, { locationId, locationLabel } = {}) {
  if (locationId) {
    const { rows } = await client.query(
      'SELECT * FROM locations WHERE id = $1 AND business_id = $2 LIMIT 1',
      [locationId, businessId],
    );
    if (rows[0]) return rows[0];
  }
  if (locationLabel) {
    const { rows } = await client.query(
      'SELECT * FROM locations WHERE business_id = $1 ORDER BY created_at ASC',
      [businessId],
    );
    const byName = rows.find((row) => ci(row.name) === ci(locationLabel));
    if (byName) return byName;
    return rows[0] ?? null;
  }
  const { rows } = await client.query(
    'SELECT * FROM locations WHERE business_id = $1 ORDER BY created_at ASC LIMIT 1',
    [businessId],
  );
  return rows[0] ?? null;
}

/**
 * Try to apply ONE held line inside the caller's transaction.
 * Returns the line's new status. Never throws for stock shortage —
 * insufficient stock is a recorded outcome, not an error.
 */
async function applyLineTx(client, { businessId, provider, line, products, location, planKey, userName, caller, reference }) {
  let product = null;
  if (line.product_id) {
    product = products.find((p) => p.id === line.product_id) || null;
  }
  if (!product) {
    const mapping = await mappingFor(client, businessId, provider, line.provider_item_key);
    if (mapping) product = products.find((p) => p.id === mapping.product_id) || null;
  }
  if (!product) {
    // The three-key match. Lines recorded before migration
    // 050 carry no upc column value — their stored barcode
    // IS the retail code they arrived with, so it stands in
    // as the UPC key and old held lines keep their road.
    product = matchProductByKeys(products, {
      sku: line.sku,
      upc: line.upc || line.barcode,
      isbn: line.isbn,
    });
  }
  if (!product || !location) {
    await client.query(
      'UPDATE pos_sale_lines SET status = $1, product_id = $2, updated_at = NOW() WHERE id = $3',
      ['unmatched', product?.id ?? null, line.id],
    );
    return 'unmatched';
  }
  const level = await getLevel(client, businessId, product.id, location.id);
  const onHand = Number(level?.quantity ?? 0);
  const qty = Number(line.quantity) || 0;
  if (qty > onHand) {
    await client.query(
      'UPDATE pos_sale_lines SET status = $1, product_id = $2, updated_at = NOW() WHERE id = $3',
      ['insufficient_stock', product.id, line.id],
    );
    return 'insufficient_stock';
  }
  const { movement } = await recordMovementTx(client, {
    businessId,
    product,
    location,
    type: 'sale',
    quantity: qty,
    // eBay is a storefront, not a till (release 362): its
    // movements say where the sale actually happened. The
    // till providers' note is unchanged.
    note: provider === 'ebay' ? 'Sold on eBay' : `Sold at the till (${POS_PROVIDER_LABELS[provider] || provider})`,
    reference,
    userName,
    planKey,
    caller,
  });
  await client.query(
    'UPDATE pos_sale_lines SET status = $1, product_id = $2, movement_id = $3, updated_at = NOW() WHERE id = $4',
    ['applied', product.id, movement.id, line.id],
  );
  return 'applied';
}

function publicLine(row) {
  return { ...row, quantity: row.quantity == null ? null : Number(row.quantity) };
}

export function publicEvent(row, lines) {
  const event = {
    ...row,
    total_amount: row.total_amount == null ? null : Number(row.total_amount),
  };
  if (lines) event.lines = lines.map(publicLine);
  return event;
}

async function linesOfEvent(client, eventId) {
  const { rows } = await client.query(
    'SELECT * FROM pos_sale_lines WHERE event_id = $1 ORDER BY created_at ASC',
    [eventId],
  );
  return rows;
}

/**
 * Record + apply one normalized sale. Idempotent on
 * (business_id, provider, externalSaleId): a redelivery returns
 * { duplicate: true } with the recorded event and changes nothing.
 *
 * HELD FOR PLAN (owner's ruling, Nov 13, 2026 — till connections
 * are Business only): with holdForPlan set, the sale is recorded
 * verbatim — event and lines 'held_plan', NO movement written —
 * so a sale that arrives while the business is off the Business
 * plan is never lost and never applied against the wrong plan.
 * retryHeldLines() applies it, exactly once, once the business
 * is on Business again.
 */
/** A signed-in POS caller's movement name (owner's
 *  email-exposure rule, Nov 21, 2026): the person's display name
 *  — the owner's set name or "Owner", a member's staff name —
 *  never their email. No caller (a webhook delivery) resolves
 *  to null and the caller site keeps the provider label. */
async function posCallerName(queryable, businessId, caller) {
  if (!caller) return null;
  const { rows: biz } = await queryable.query(
    'SELECT owner_id FROM businesses WHERE id = $1 LIMIT 1',
    [businessId],
  );
  if (biz[0]?.owner_id && biz[0].owner_id === caller.id) {
    const { rows: u } = await queryable.query(
      'SELECT display_name FROM users WHERE id = $1 LIMIT 1',
      [caller.id],
    );
    return u[0]?.display_name?.trim() || 'Owner';
  }
  if (caller.email) {
    const { rows: s } = await queryable.query(
      'SELECT full_name FROM staff_members WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1',
      [businessId, caller.email],
    );
    if (s[0]?.full_name) return s[0].full_name;
  }
  return null;
}

export async function applyPosSale(pool, {
  businessId,
  connection = null,
  provider,
  source = 'webhook',
  sale,
  planKey = 'essentials',
  holdForPlan = false,
  caller = null,
}) {
  const externalSaleId = String(sale?.externalSaleId || '').trim();
  if (!externalSaleId) throw err(400, 'invalid_value', 'A sale needs its provider sale id.');
  const userName = (await posCallerName(pool, businessId, caller))
    || (provider === 'ebay' ? 'eBay' : `${POS_PROVIDER_LABELS[provider] || provider} POS`);
  const reference = `POS-${provider}-${externalSaleId}`.slice(0, 120);

  // The recorded outcome for an already-seen sale — the replay
  // answer. Read OUTSIDE the write transaction: after a unique
  // violation Postgres aborts the open transaction, so a
  // catch-and-continue inside withTx could never re-read safely.
  const recordedOutcome = async () => {
    const { rows } = await pool.query(
      'SELECT * FROM pos_sale_events WHERE business_id = $1 AND provider = $2 AND external_sale_id = $3 LIMIT 1',
      [businessId, provider, externalSaleId],
    );
    if (!rows[0]) return null;
    const lines = await linesOfEvent(pool, rows[0].id);
    return { duplicate: true, event: publicEvent(rows[0], lines) };
  };

  const already = await recordedOutcome();
  if (already) return already;

  try {
    return await withTx(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO pos_sale_events
           (id, business_id, connection_id, provider, external_sale_id, sold_at,
            location_label, total_amount, total_currency, status, source, summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $12, $10, $11)
         RETURNING *`,
        [
          crypto.randomUUID(), businessId, connection?.id ?? null, provider, externalSaleId,
          sale.soldAt ? new Date(sale.soldAt).toISOString() : null,
          String(sale.locationLabel || ''),
          sale.totalAmount == null || sale.totalAmount === '' ? null : Number(sale.totalAmount),
          String(sale.totalCurrency || ''),
          source,
          String(sale.summary || ''),
          holdForPlan ? 'held_plan' : 'held_unmatched',
        ],
      );
      const event = inserted.rows[0];

      const products = await loadProducts(client, businessId);
      const location = await resolveSaleLocation(client, businessId, {
        locationId: connection?.location_id || sale.locationId || null,
        locationLabel: sale.locationLabel,
      });

      for (const rawLine of sale.lines || []) {
        const qty = Number(rawLine.quantity) || 0;
        const lineId = crypto.randomUUID();
        // The line's three keys ride the row (release 364):
        // the UPC key is the retail code — an adapter still
        // calling it `barcode` lands in the same slot, and
        // the stored barcode column keeps carrying it for
        // every reader that predates the split.
        const upc = String(rawLine.upc || rawLine.barcode || '');
        const insertedLine = await client.query(
          `INSERT INTO pos_sale_lines
             (id, business_id, event_id, provider_item_key, item_label, sku, barcode, upc, isbn, quantity, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            lineId, businessId, event.id,
            String(rawLine.providerItemKey || ''), String(rawLine.itemLabel || ''),
            String(rawLine.sku || ''), upc, upc, String(rawLine.isbn || ''),
            qty, qty <= 0 ? 'ignored' : holdForPlan ? 'held_plan' : 'unmatched',
          ],
        );
        const line = insertedLine.rows[0];
        if (qty > 0 && !holdForPlan) {
          await applyLineTx(client, {
            businessId, provider, line, products, location, planKey, userName, caller, reference,
          });
        }
      }

      const status = await recomputeEventStatus(client, event.id);
      const fresh = await client.query('SELECT * FROM pos_sale_events WHERE id = $1', [event.id]);
      const lines = await linesOfEvent(client, event.id);
      return { duplicate: false, event: publicEvent({ ...fresh.rows[0], status }, lines) };
    });
  } catch (error) {
    // A simultaneous redelivery won the insert race: the write
    // transaction rolled back, and the recorded outcome is the
    // answer — exactly like the sequential replay above.
    if (/unique|duplicate/i.test(String(error?.message || ''))) {
      const recorded = await recordedOutcome();
      if (recorded) return recorded;
    }
    throw error;
  }
}

/**
 * One-tap apply for held lines: retry every unmatched /
 * insufficient_stock / held_plan line for one provider item key
 * (after its mapping is saved), or — with no key — every held
 * line in the business (the count-sales-held-for-the-plan action
 * uses the no-key form). Returns counts; each affected event's
 * status is recomputed. Only lines that can now apply change.
 */
export async function retryHeldLines(pool, { businessId, provider = null, providerItemKey = null, planKey = 'essentials', caller = null }) {
  return withTx(pool, async (client) => {
    let query = "SELECT * FROM pos_sale_lines WHERE business_id = $1 AND status IN ('unmatched', 'insufficient_stock', 'held_plan')";
    const values = [businessId];
    if (providerItemKey) { query += ` AND provider_item_key = $${values.length + 1}`; values.push(providerItemKey); }
    query += ' ORDER BY created_at ASC LIMIT 500';
    const { rows: held } = await client.query(query, values);
    const products = await loadProducts(client, businessId);
    const eventsTouched = new Set();
    let applied = 0;
    // Lines need their event's provider + connection location.
    for (const line of held) {
      const eventRows = await client.query('SELECT * FROM pos_sale_events WHERE id = $1', [line.event_id]);
      const event = eventRows.rows[0];
      if (!event) continue;
      if (provider && event.provider !== provider) continue;
      let connection = null;
      if (event.connection_id) {
        const connRows = await client.query('SELECT * FROM pos_connections WHERE id = $1', [event.connection_id]);
        connection = connRows.rows[0] ?? null;
      }
      const location = await resolveSaleLocation(client, businessId, {
        locationId: connection?.location_id || null,
        locationLabel: event.location_label,
      });
      const userName = (await posCallerName(client, businessId, caller))
        || (event.provider === 'ebay' ? 'eBay' : `${POS_PROVIDER_LABELS[event.provider] || event.provider} POS`);
      const result = await applyLineTx(client, {
        businessId,
        provider: event.provider,
        line,
        products,
        location,
        planKey,
        userName,
        caller,
        reference: `POS-${event.provider}-${event.external_sale_id}`.slice(0, 120),
      });
      if (result === 'applied') applied += 1;
      eventsTouched.add(event.id);
    }
    for (const eventId of eventsTouched) {
      await recomputeEventStatus(client, eventId);
    }
    return { retried: held.length, applied, stillHeld: held.length - applied };
  });
}

// ---------------------------------------------------------------------------
// CSV sales import — the fallback for tills with no API.
// ---------------------------------------------------------------------------

/** Compact RFC-style CSV reader (server twin of src/lib/csvImport.js). */
export function parseCsvText(text) {
  const clean = String(text || '').replace(/^\uFEFF/, ''); // strip a leading BOM
  if (!clean.trim()) return [];
  const firstLine = clean.slice(0, clean.indexOf('\n') + 1 || clean.length);
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const records = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); records.push(row); row = []; field = ''; }
    else if (char !== '\r') field += char;
  }
  if (field || row.length) { row.push(field); records.push(row); }
  return records.filter((cells) => cells.some((cell) => String(cell).trim()));
}

const CSV_COLUMNS = {
  sale_id: ['sale_id', 'order_id', 'transaction_id', 'receipt_id', 'sale', 'order_number', 'id'],
  sold_at: ['sold_at', 'date', 'sold_date', 'time', 'timestamp', 'created_at'],
  code: ['sku_or_barcode', 'sku', 'barcode', 'upc', 'code', 'item_code'],
  quantity: ['quantity', 'qty', 'quantity_sold', 'units'],
  item_name: ['item_name', 'name', 'product_name', 'item'],
  location: ['location', 'location_name', 'store', 'store_name'],
};

function normalizeHeader(header) {
  return String(header || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Parse end-of-day CSV text into normalized sales + problems.
 * Rows are grouped by sale_id (one sale, several item rows).
 * A row that cannot be recorded safely is a PROBLEM — reported
 * with its row number, never silently skipped.
 */
export function parseSalesCsv(text) {
  const records = parseCsvText(text);
  if (!records.length) {
    return { sales: [], problems: [{ row: 0, problem: 'The file is empty.' }] };
  }
  const headers = records[0].map(normalizeHeader);
  const columnIndex = {};
  for (const [field, aliases] of Object.entries(CSV_COLUMNS)) {
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx >= 0) columnIndex[field] = idx;
  }
  const problems = [];
  if (columnIndex.sale_id === undefined || columnIndex.code === undefined || columnIndex.quantity === undefined) {
    problems.push({
      row: 1,
      problem: 'The file needs columns named sale_id, sku_or_barcode and quantity (sold_at, item_name and location are optional).',
    });
    return { sales: [], problems };
  }
  const cell = (cells, field) => {
    const idx = columnIndex[field];
    return idx === undefined ? '' : String(cells[idx] ?? '').trim();
  };
  const bySale = new Map();
  records.slice(1).forEach((cells, i) => {
    const rowNumber = i + 2;
    const saleId = cell(cells, 'sale_id');
    const code = cell(cells, 'code');
    const qtyRaw = cell(cells, 'quantity');
    const qty = Number(qtyRaw);
    if (!saleId) {
      problems.push({ row: rowNumber, problem: 'No sale_id — a row without one cannot be checked against duplicates, so it was not recorded.' });
      return;
    }
    if (!code) {
      problems.push({ row: rowNumber, problem: `Sale ${saleId}: no SKU or barcode on this row, so the item cannot be matched.` });
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      problems.push({ row: rowNumber, problem: `Sale ${saleId}: quantity "${qtyRaw}" is not a number above zero.` });
      return;
    }
    if (!bySale.has(saleId)) {
      const soldAtRaw = cell(cells, 'sold_at');
      const parsed = soldAtRaw ? Date.parse(soldAtRaw) : NaN;
      bySale.set(saleId, {
        externalSaleId: saleId,
        soldAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
        locationLabel: cell(cells, 'location'),
        totalAmount: null,
        totalCurrency: '',
        lines: [],
      });
    }
    bySale.get(saleId).lines.push({
      providerItemKey: code,
      itemLabel: cell(cells, 'item_name'),
      // The CSV's one code column is "sku_or_barcode" — the
      // seller's code could be any of the three keys, so it
      // rides all three slots and the three-key match judges
      // it (release 364: keys pointing at different products
      // hold the line instead of guessing, as everywhere).
      sku: code,
      upc: code,
      isbn: code,
      quantity: qty,
    });
  });
  return { sales: [...bySale.values()], problems };
}
