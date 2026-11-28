/**
 * Order by production — the core (Nov 26, 2026; plan
 * release 378: Gap 8c, with its Part 7 rider, the
 * self-filling prep sheets extension).
 *
 * ORDER BY PRODUCTION: a production plan — a batch run
 * (a recipe, a number of makes) or a catering event
 * (release 375) — turns into an ingredient order draft
 * by itself: the plan's recipes expand to ingredients
 * (the 359/361 machinery), what's already on hand comes
 * off, and what's left rounds UP to the pack size the
 * par names, grouped by supplier — the order guide's
 * shape (release 359).
 *
 * DOCTRINE (no silent changes, money edition): the only
 * purchase-order inserts in this module carry status
 * 'draft', always — one draft per supplier, into the
 * existing Purchasing flow. There is no send path and
 * nothing here orders anything; the owner reviews,
 * changes, and sends the drafts by hand, like every
 * other order.
 *
 * THE PREP EXTENSION is the reverse arithmetic and
 * lives on the Prep page (src/lib/restaurantOps.js
 * prepSuggestions): suggested makes from pars, what's
 * booked, and what's already prepped — shown, never
 * written. This module is the ordering half.
 *
 * BUSINESS-ONLY: the routes sit behind the restaurant
 * corner's plan gate. Making drafts rides the purchasing
 * door — the owner, or a member holding
 * `purchasing.manage` (the standing-orders door, release
 * 377). Working out a plan is a read, open to the team.
 *
 * Per-business private: every read and write is scoped
 * to one business, and a plan only ever names recipes
 * and events of that same business.
 */
import crypto from 'node:crypto';
import { expandRecipeToProducts } from './recipes.js';
import { eventPrep } from './cateringCore.js';
import { poNumberFor } from './standingOrdersCore.js';

export const PRODUCTION_MESSAGE =
  'Only the owner, a manager, or a person with the purchasing permission can order by production.';
export const PLAN_MESSAGE = 'Check the production plan and try again.';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cleanText(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * A production plan's source, cleaned for use: a batch
 * run names a recipe of the business and how many makes
 * (a whole number — a part-make is still a make), or an
 * event names one of the business's catering events.
 * Anything else is refused, never guessed at.
 */
export function cleanProductionSource(input) {
  const kind = cleanText(input?.kind, 20);
  if (kind === 'batch') {
    const recipeId = cleanText(input?.recipe_id, 120);
    const makes = Number(input?.makes);
    if (!recipeId || !Number.isFinite(makes) || makes < 1 || makes > 100000) {
      throw err(400, 'production_order_invalid', PLAN_MESSAGE);
    }
    return { kind: 'batch', recipe_id: recipeId, makes: Math.ceil(makes) };
  }
  if (kind === 'event') {
    const eventId = cleanText(input?.event_id, 120);
    if (!eventId) throw err(400, 'production_order_invalid', PLAN_MESSAGE);
    return { kind: 'event', event_id: eventId };
  }
  throw err(400, 'production_order_invalid', PLAN_MESSAGE);
}

function parseLines(lines) {
  if (Array.isArray(lines)) return lines;
  if (typeof lines === 'string') {
    try { const parsed = JSON.parse(lines); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

/**
 * The plan, pure. `needed` per ingredient comes from the
 * source: a batch run expands its recipe `makes` times;
 * an event folds its whole menu through the 375 prep
 * arithmetic (a cancelled event pulls nothing). On hand
 * is the business's whole shelf for the product (every
 * location — an order is for the business, like the
 * guide's business-wide pars). What's left rounds UP to
 * the pack size the product's par names (1 when no par
 * packs it), and each line carries its supplier — the
 * par's own, falling back to the product's — so the
 * lines group the order guide's way. Lines the shelf
 * already covers stay on the plan with orderQty 0, so
 * the owner sees the whole arithmetic, not just the buy.
 */
export function buildProductionPlan({ recipes = [], products = [], pars = [], levels = [], source, event = null } = {}) {
  const recipesById = new Map((recipes || []).map((r) => [r.id, r]));
  const productsById = new Map((products || []).map((p) => [p.id, p]));
  const needed = new Map();
  let sourceName = '';
  let sourceDetail = '';

  if (source?.kind === 'batch') {
    const recipe = recipesById.get(source.recipe_id);
    if (!recipe) throw err(400, 'production_order_invalid', PLAN_MESSAGE);
    const expanded = expandRecipeToProducts(recipesById, recipe, new Set(), productsById);
    for (const [productId, perMake] of expanded) {
      needed.set(productId, (needed.get(productId) || 0) + perMake * source.makes);
    }
    sourceName = recipe.name || '';
    sourceDetail = 'batch';
  } else if (source?.kind === 'event') {
    if (!event) throw err(400, 'production_order_invalid', PLAN_MESSAGE);
    const prep = eventPrep(recipes, products, event);
    for (const total of prep.totals) {
      needed.set(total.product_id, (needed.get(total.product_id) || 0) + total.quantity);
    }
    sourceName = event.name || '';
    sourceDetail = 'event';
  } else {
    throw err(400, 'production_order_invalid', PLAN_MESSAGE);
  }

  const onHandByProduct = new Map();
  for (const level of levels || []) {
    if (!level?.product_id) continue;
    onHandByProduct.set(level.product_id, (onHandByProduct.get(level.product_id) || 0) + (Number(level.quantity) || 0));
  }
  const parByProduct = new Map();
  for (const par of pars || []) {
    if (par?.product_id && !parByProduct.has(par.product_id)) parByProduct.set(par.product_id, par);
  }

  const lines = [...needed.entries()].map(([productId, qty]) => {
    const product = productsById.get(productId);
    const par = parByProduct.get(productId);
    const neededQty = round2(qty);
    const onHand = round2(onHandByProduct.get(productId) || 0);
    const need = Math.max(round2(neededQty - onHand), 0);
    const pack = Number(par?.pack_size) > 0 ? Number(par.pack_size) : 1;
    const orderQty = need > 0 ? Math.ceil(need / pack) * pack : 0;
    return {
      product_id: productId,
      product_name: product?.name || '',
      sku: product?.sku || '',
      unit: product?.unit || 'each',
      needed: neededQty,
      onHand,
      need,
      pack,
      orderQty,
      supplier_id: par?.supplier_id || product?.supplier_id || '',
      supplier_name: par?.supplier_name || product?.supplier_name || '',
      unit_cost: round2(product?.cost),
    };
  }).sort((a, b) => a.product_name.localeCompare(b.product_name));

  const groupMap = new Map();
  for (const line of lines) {
    if (!(line.orderQty > 0)) continue;
    const key = line.supplier_id || line.supplier_name || 'none';
    if (!groupMap.has(key)) {
      groupMap.set(key, { supplier_id: line.supplier_id, supplier_name: line.supplier_name, lines: [], total: 0 });
    }
    const group = groupMap.get(key);
    group.lines.push(line);
    group.total = round2(group.total + line.orderQty * line.unit_cost);
  }
  const groups = [...groupMap.values()].sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));

  return {
    source: { kind: sourceDetail, name: sourceName },
    lines,
    groups,
    covered: groups.length === 0,
  };
}

/* --------------------------------------------------- DB doors */

async function loadAll(pool, businessId) {
  const [recipes, products, pars, levels] = await Promise.all([
    pool.query('SELECT * FROM recipes WHERE business_id = $1', [businessId]),
    pool.query('SELECT * FROM products WHERE business_id = $1', [businessId]),
    pool.query('SELECT * FROM pars WHERE business_id = $1', [businessId]),
    pool.query('SELECT * FROM stock_levels WHERE business_id = $1', [businessId]),
  ]);
  return {
    recipes: recipes.rows.map((row) => ({ ...row, lines: parseLines(row.lines) })),
    products: products.rows,
    pars: pars.rows,
    levels: levels.rows,
  };
}

async function loadEvent(pool, businessId, eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM catering_events WHERE id = $1 AND business_id = $2 LIMIT 1',
    [eventId, businessId],
  );
  if (!rows[0]) throw err(400, 'production_order_invalid', PLAN_MESSAGE);
  return rows[0];
}

/** The plans this page can start from: the business's
 *  recipes (a batch run is any recipe, run any number of
 *  makes) and its upcoming booked catering events. */
export async function listProductionSources(pool, businessId, today) {
  const [{ rows: recipeRows }, { rows: eventRows }] = await Promise.all([
    pool.query('SELECT id, name FROM recipes WHERE business_id = $1 ORDER BY name ASC', [businessId]),
    pool.query(
      `SELECT id, name, event_date, party_size FROM catering_events
       WHERE business_id = $1 AND status = 'booked' AND event_date >= $2
       ORDER BY event_date ASC, name ASC`,
      [businessId, today],
    ),
  ]);
  return {
    recipes: recipeRows.map((row) => ({ id: row.id, name: row.name || '' })),
    events: eventRows.map((row) => ({
      id: row.id, name: row.name || '', event_date: row.event_date || '', party_size: Number(row.party_size) || 0,
    })),
  };
}

export async function planProduction(pool, businessId, sourceInput) {
  const source = cleanProductionSource(sourceInput);
  const data = await loadAll(pool, businessId);
  const event = source.kind === 'event' ? await loadEvent(pool, businessId, source.event_id) : null;
  const plan = buildProductionPlan({ ...data, source, event });
  if (source.kind === 'batch') plan.source.makes = source.makes;
  if (source.kind === 'event') plan.source.event_date = event.event_date || '';
  return plan;
}

/**
 * Make the drafts — THE money doctrine in code: one
 * purchase order per supplier group, inserted with
 * status 'draft', always, and nothing here sends or
 * orders anything. The owner reviews and sends them
 * from Purchasing, by hand, like every other order.
 * A plan the shelf already covers makes no drafts.
 */
export async function makeProductionDrafts(pool, businessId, sourceInput, { userId = null } = {}) {
  const plan = await planProduction(pool, businessId, sourceInput);
  const drafts = [];
  for (const group of plan.groups) {
    const lines = group.lines.map((line) => ({
      product_id: line.product_id,
      product_name: line.product_name,
      sku: line.sku || '',
      qty_ordered: line.orderQty,
      qty_received: 0,
      unit_cost: line.unit_cost,
    }));
    const number = poNumberFor();
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO purchase_orders
         (id, business_id, number, supplier_id, supplier_name, status, lines, subtotal, total, note, created_by_id)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$7,$8,$9)`,
      [id, businessId, number, group.supplier_id, group.supplier_name,
        JSON.stringify(lines), group.total, plan.source.name, userId],
    );
    drafts.push({ number, supplier_name: group.supplier_name, total: group.total, lines: lines.length });
  }
  return { drafts, plan };
}
