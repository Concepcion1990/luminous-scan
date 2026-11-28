/**
 * Standing orders + supplier price book — the core
 * (Nov 26, 2026; plan release 377: Gap 8b + Q-fire 3).
 *
 * STANDING ORDERS: the recurring staples (the Tuesday
 * order) set up once as a recurring template. Making the
 * week's order writes ONE DRAFT purchase order into the
 * existing Purchasing flow for the owner to confirm.
 * DOCTRINE (no silent changes, money edition): a standing
 * order ALWAYS lands as a draft — this module has no code
 * path that marks an order ordered or sends one, ever.
 *
 * SUPPLIER PRICE BOOK / COMPARE: one ingredient, every
 * supplier's price, side by side — computed at read time
 * from the data the app already collects: supplier
 * invoice lines (release 361) and purchase-order lines
 * (orders actually placed: ordered / partial / received —
 * a draft is not a price anyone agreed to, and a cancelled
 * order never happened). Per supplier the LATEST price is
 * the current one; the full history rides along so the
 * owner sees how a price moved. Cheapest first, obvious.
 *
 * BUSINESS-ONLY: the routes sit behind the restaurant
 * corner's plan gate. Writes (set up / edit / make a
 * draft) ride the purchasing door — the owner, or a
 * member holding `purchasing.manage` (access.can covers
 * managers through their role). Reads are open to the
 * whole team, like the order guide.
 *
 * Per-business private: every read and write is scoped
 * to one business.
 */
import crypto from 'node:crypto';

export const ORDER_MESSAGE =
  'Only the owner, a manager, or a person with the purchasing permission can set up standing orders.';
export const STANDING_MESSAGE = 'Check the standing order details and try again.';

export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]; // 0 = Monday … 6 = Sunday

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cleanText(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanMoney(value) {
  if (value === null || value === undefined || String(value).trim() === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw err(400, 'standing_orders_invalid', STANDING_MESSAGE);
  return round2(n);
}

/** Who may set up standing orders and make drafts: the
 *  owner, or anyone whose role/permissions carry the
 *  purchasing door (managers carry it by role). */
export function canOrder(access) {
  if (!access) return false;
  if (access.isOwner) return true;
  return typeof access.can === 'function' ? access.can('purchasing.manage') : false;
}

/* ------------------------------------------------ standing orders */

export function cleanStandingOrder(input) {
  const name = cleanText(input?.name, 200);
  if (!name) throw err(400, 'standing_orders_invalid', STANDING_MESSAGE);
  let weekday = null;
  if (input?.weekday !== null && input?.weekday !== undefined && input?.weekday !== '') {
    const day = Number(input.weekday);
    if (!Number.isInteger(day) || !WEEKDAYS.includes(day)) {
      throw err(400, 'standing_orders_invalid', STANDING_MESSAGE);
    }
    weekday = day;
  }
  const rawLines = Array.isArray(input?.lines) ? input.lines : [];
  if (!rawLines.length || rawLines.length > 200) {
    throw err(400, 'standing_orders_invalid', STANDING_MESSAGE);
  }
  const lines = rawLines.map((line) => {
    const productName = cleanText(line?.product_name, 200);
    const qty = Number(line?.qty);
    if (!productName || !Number.isFinite(qty) || qty <= 0 || qty > 1000000) {
      throw err(400, 'standing_orders_invalid', STANDING_MESSAGE);
    }
    return {
      product_id: cleanText(line?.product_id, 120),
      product_name: productName,
      sku: cleanText(line?.sku, 120),
      qty: Math.round(qty * 1000) / 1000,
      unit_cost: cleanMoney(line?.unit_cost),
    };
  });
  return {
    name,
    supplier_id: cleanText(input?.supplier_id, 120),
    supplier_name: cleanText(input?.supplier_name, 200),
    weekday,
    active: input?.active !== false,
    lines,
    note: cleanText(input?.note, 2000),
  };
}

export function shapeStandingOrder(row) {
  let lines = row.lines;
  if (typeof lines === 'string') {
    try { lines = JSON.parse(lines); } catch { lines = []; }
  }
  return {
    id: row.id,
    name: row.name || '',
    supplier_id: row.supplier_id || '',
    supplier_name: row.supplier_name || '',
    weekday: row.weekday === null || row.weekday === undefined ? null : Number(row.weekday),
    active: row.active !== false,
    lines: Array.isArray(lines) ? lines : [],
    note: row.note || '',
    last_draft_at: row.last_draft_at || null,
    last_draft_number: row.last_draft_number || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

/* ------------------------------------------------ the price book */

function parseLines(lines) {
  if (Array.isArray(lines)) return lines;
  if (typeof lines === 'string') {
    try { const parsed = JSON.parse(lines); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

function dateOf(...values) {
  for (const value of values) {
    const text = String(value || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  }
  return '';
}

/**
 * The price book, pure: every priced observation the app
 * already holds, grouped by ingredient. Invoices give
 * {product_id, quantity, unit_cost} lines; purchase
 * orders give {product_id, qty_ordered, unit_cost} lines
 * and count only when actually placed (ordered / partial
 * / received). Per (ingredient, supplier) the latest
 * observation is that supplier's current price; offers
 * come back cheapest first so the cheapest is obvious.
 * History keeps every observation, newest first.
 */
export function buildPriceBook({ invoices = [], purchaseOrders = [] } = {}) {
  const byProduct = new Map();
  const observe = (obs) => {
    if (!obs.product_id || !(obs.unit_cost > 0)) return;
    if (!byProduct.has(obs.product_id)) {
      byProduct.set(obs.product_id, { product_id: obs.product_id, product_name: obs.product_name || '', history: [] });
    }
    const entry = byProduct.get(obs.product_id);
    if (!entry.product_name && obs.product_name) entry.product_name = obs.product_name;
    entry.history.push(obs);
  };

  for (const invoice of invoices || []) {
    const supplier = {
      supplier_id: invoice.supplier_id || '',
      supplier_name: invoice.supplier_name || '',
    };
    const date = dateOf(invoice.invoice_date, invoice.created_date, invoice.created_at);
    for (const line of parseLines(invoice.lines)) {
      observe({
        product_id: String(line?.product_id || ''),
        product_name: String(line?.product_name || ''),
        ...supplier,
        unit_cost: round2(line?.unit_cost),
        source: 'invoice',
        date,
      });
    }
  }
  for (const po of purchaseOrders || []) {
    if (!['ordered', 'partial', 'received'].includes(po.status)) continue;
    const supplier = {
      supplier_id: po.supplier_id || '',
      supplier_name: po.supplier_name || '',
    };
    const date = dateOf(po.order_date, po.created_date, po.created_at);
    for (const line of parseLines(po.lines)) {
      observe({
        product_id: String(line?.product_id || ''),
        product_name: String(line?.product_name || ''),
        ...supplier,
        unit_cost: round2(line?.unit_cost),
        source: 'order',
        date,
      });
    }
  }

  const products = [...byProduct.values()].map((entry) => {
    const history = [...entry.history].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const latestBySupplier = new Map();
    for (const obs of history) {
      const key = obs.supplier_id || obs.supplier_name;
      if (!latestBySupplier.has(key)) latestBySupplier.set(key, obs);
    }
    const offers = [...latestBySupplier.values()].sort((a, b) => a.unit_cost - b.unit_cost);
    return {
      product_id: entry.product_id,
      product_name: entry.product_name,
      offers,
      cheapest: offers[0] || null,
      history,
    };
  });
  products.sort((a, b) => String(a.product_name).localeCompare(String(b.product_name)));
  return products;
}

/** The current price one supplier charges for one
 *  ingredient, from the book — null when never priced. */
export function latestPriceFor(book, productId, supplierId, supplierName) {
  const entry = (book || []).find((p) => p.product_id === productId);
  if (!entry) return null;
  const offer = entry.offers.find(
    (o) => (supplierId && o.supplier_id === supplierId) || (supplierName && o.supplier_name === supplierName),
  );
  return offer ? offer.unit_cost : null;
}

/**
 * The lines a draft gets: the template's quantities, with
 * each line's cost refreshed to the standing order's own
 * supplier's current price from the book when the book has
 * one — the price compare working at ordering time. A
 * line the book has never priced keeps the template cost.
 */
export function draftLinesFor(standingOrder, book) {
  return (standingOrder.lines || []).map((line) => {
    const current = latestPriceFor(book, line.product_id, standingOrder.supplier_id, standingOrder.supplier_name);
    return {
      product_id: line.product_id || '',
      product_name: line.product_name || '',
      sku: line.sku || '',
      qty_ordered: Number(line.qty) || 0,
      qty_received: 0,
      unit_cost: current !== null ? current : round2(line.unit_cost),
    };
  });
}

export function poNumberFor(date = new Date()) {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `PO-${iso.replace(/-/g, '').slice(2)}-${String(Date.now()).slice(-3)}`;
}

/* --------------------------------------------------- DB doors */

export async function listStandingOrders(pool, businessId) {
  const { rows } = await pool.query(
    'SELECT * FROM standing_orders WHERE business_id = $1 ORDER BY name ASC',
    [businessId],
  );
  return rows.map(shapeStandingOrder);
}

export async function createStandingOrder(pool, businessId, input, { userId = null } = {}) {
  const clean = cleanStandingOrder(input);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO standing_orders
       (id, business_id, name, supplier_id, supplier_name, weekday, active, lines, note, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [id, businessId, clean.name, clean.supplier_id, clean.supplier_name, clean.weekday,
      clean.active, JSON.stringify(clean.lines), clean.note, userId],
  );
  return shapeStandingOrder(rows[0]);
}

export async function updateStandingOrder(pool, businessId, standingId, input) {
  const existing = (await pool.query(
    'SELECT * FROM standing_orders WHERE id = $1 AND business_id = $2 LIMIT 1',
    [standingId, businessId],
  )).rows[0];
  if (!existing) throw err(404, 'not_found', 'Not found.');
  const clean = cleanStandingOrder(input);
  const { rows } = await pool.query(
    `UPDATE standing_orders SET
       name = $3, supplier_id = $4, supplier_name = $5, weekday = $6, active = $7,
       lines = $8, note = $9, updated_at = NOW()
     WHERE id = $1 AND business_id = $2
     RETURNING *`,
    [standingId, businessId, clean.name, clean.supplier_id, clean.supplier_name, clean.weekday,
      clean.active, JSON.stringify(clean.lines), clean.note],
  );
  return shapeStandingOrder(rows[0]);
}

export async function deleteStandingOrder(pool, businessId, standingId) {
  const { rowCount } = await pool.query(
    'DELETE FROM standing_orders WHERE id = $1 AND business_id = $2',
    [standingId, businessId],
  );
  if (!rowCount) throw err(404, 'not_found', 'Not found.');
}

export async function fetchPriceBook(pool, businessId) {
  const invoices = (await pool.query(
    'SELECT * FROM supplier_invoices WHERE business_id = $1 ORDER BY invoice_date DESC NULLS LAST, created_at DESC',
    [businessId],
  )).rows;
  const purchaseOrders = (await pool.query(
    'SELECT * FROM purchase_orders WHERE business_id = $1',
    [businessId],
  )).rows;
  return buildPriceBook({ invoices, purchaseOrders });
}

/**
 * Make this week's draft — THE money doctrine in code:
 * the purchase order is inserted with status 'draft',
 * always, and nothing here sends or orders anything.
 * The owner reviews and sends it from Purchasing, by
 * hand, like every other order. The template is stamped
 * with the draft it produced.
 */
export async function makeDraftOrder(pool, businessId, standingId, { userId = null } = {}) {
  const row = (await pool.query(
    'SELECT * FROM standing_orders WHERE id = $1 AND business_id = $2 LIMIT 1',
    [standingId, businessId],
  )).rows[0];
  if (!row) throw err(404, 'not_found', 'Not found.');
  const standing = shapeStandingOrder(row);
  const book = await fetchPriceBook(pool, businessId);
  const lines = draftLinesFor(standing, book);
  const total = round2(lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0));
  const number = poNumberFor();
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO purchase_orders
       (id, business_id, number, supplier_id, supplier_name, status, lines, subtotal, total, note, created_by_id)
     VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$7,$8,$9)
     RETURNING *`,
    [id, businessId, number, standing.supplier_id, standing.supplier_name,
      JSON.stringify(lines), total, standing.name, userId],
  );
  await pool.query(
    `UPDATE standing_orders SET last_draft_at = NOW(), last_draft_number = $3, updated_at = NOW()
     WHERE id = $1 AND business_id = $2`,
    [standingId, businessId, number],
  );
  const order = rows[0];
  return {
    number,
    status: order.status,
    total,
    lines,
    standingOrder: standing,
  };
}
