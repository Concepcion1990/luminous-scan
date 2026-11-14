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
 *     lines: [{ providerItemKey, itemLabel, sku, barcode, quantity }] }
 * and calls applyPosSale(). Everything after that is shared:
 *
 *   IDEMPOTENCY — (business_id, provider, external_sale_id) is
 *   UNIQUE. The event row is inserted FIRST; a redelivery (webhook
 *   retry, provider resend, CSV re-import) finds the row and
 *   returns the recorded outcome. Nothing ever double-counts.
 *
 *   MATCHING — a line finds its product three ways, in order:
 *   1. a saved pos_item_mappings row for its provider item key;
 *   2. an exact SKU match (case-insensitive);
 *   3. an exact match on upc / barcode / qr_code / isbn.
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

/** Exact code match, SKU field first, then every other code field. */
export function matchProductByCode(products, { sku, barcode }) {
  const candidates = [sku, barcode].map(ci).filter(Boolean);
  if (!candidates.length) return null;
  const bySku = products.find((p) => candidates.includes(ci(p.sku)));
  if (bySku) return bySku;
  return (
    products.find((p) =>
      [p.upc, p.barcode, p.qr_code, p.isbn].some((field) => candidates.includes(ci(field))),
    ) || null
  );
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
  if (!product) product = matchProductByCode(products, line);
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
    note: `Sold at the till (${POS_PROVIDER_LABELS[provider] || provider})`,
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
  const userName = caller?.email || `${POS_PROVIDER_LABELS[provider] || provider} POS`;
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
        const insertedLine = await client.query(
          `INSERT INTO pos_sale_lines
             (id, business_id, event_id, provider_item_key, item_label, sku, barcode, quantity, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            lineId, businessId, event.id,
            String(rawLine.providerItemKey || ''), String(rawLine.itemLabel || ''),
            String(rawLine.sku || ''), String(rawLine.barcode || ''),
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
      const userName = caller?.email || `${POS_PROVIDER_LABELS[event.provider] || event.provider} POS`;
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
      sku: code,
      barcode: code,
      quantity: qty,
    });
  });
  return { sales: [...bySale.values()], problems };
}
