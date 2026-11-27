/**
 * Catering & private events, the simple version — the core
 * (Nov 26, 2026; plan release 375, Gap 11).
 *
 * An event book: date, party size, a menu picked from the
 * business's own recipes/dishes, deposit taken, balance
 * due. A one-page event sheet (BEO) comes out of the
 * Document Style Studio; the event's food pulls into prep
 * and production so a big party doesn't ambush the walk-in.
 *
 * Doctrines:
 *  - BUSINESS-ONLY: the routes sit behind the restaurant
 *    corner's plan gate; nothing here exists on Essentials.
 *  - DEPOSITS AND BALANCES ARE OWNER-ONLY MONEY: the shape
 *    below strips event_total, deposit and balance_due for
 *    every non-owner reader, and only the owner can set
 *    them (a manager's save preserves them untouched).
 *  - THE SIMPLE VERSION ONLY: no contracts, no
 *    e-signatures. The deposit is a record of money the
 *    owner already took; nothing here takes a payment.
 *  - Per-business private: every read and write is scoped
 *    to one business, and a menu line only ever names a
 *    recipe of that same business.
 */
import crypto from 'node:crypto';
import { expandRecipeToProducts, yieldQtyOf } from './recipes.js';

export const OWNER_MESSAGE = 'Only the owner or a manager can keep the event book.';
export const EVENT_MESSAGE = 'Check the event details and try again.';

export const EVENT_STATUSES = ['booked', 'done', 'cancelled'];

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanMoney(value) {
  if (value === null || value === undefined || String(value).trim() === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw err(400, 'catering_event', EVENT_MESSAGE);
  return round2(n);
}

function cleanText(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

/** One menu line, cleaned: a recipe of the business and the
 *  servings of it the party will eat. Lines naming no recipe
 *  or no servings are dropped, never invented. */
function cleanMenuLine(line) {
  const recipeId = cleanText(line?.recipe_id, 100);
  const servings = Number(line?.servings);
  if (!recipeId || !Number.isFinite(servings) || servings <= 0) return null;
  return { recipe_id: recipeId, servings: round2(servings) };
}

/** An event, cleaned for writing. Money arrives already
 *  owner-gated by the caller (the routes pass the stored
 *  values through for a non-owner writer). */
export function cleanEvent(input) {
  const date = cleanText(input?.event_date, 10);
  if (!DATE_RE.test(date)) throw err(400, 'catering_event', EVENT_MESSAGE);
  const time = cleanText(input?.event_time, 5);
  if (time && !TIME_RE.test(time)) throw err(400, 'catering_event', EVENT_MESSAGE);
  const name = cleanText(input?.name, 200);
  if (!name) throw err(400, 'catering_event', EVENT_MESSAGE);
  const party = Number(input?.party_size);
  if (!Number.isFinite(party) || party < 1 || party > 100000) {
    throw err(400, 'catering_event', EVENT_MESSAGE);
  }
  const status = EVENT_STATUSES.includes(input?.status) ? input.status : 'booked';
  const menu = Array.isArray(input?.menu)
    ? input.menu.map(cleanMenuLine).filter(Boolean).slice(0, 100)
    : [];
  return {
    name,
    event_date: date,
    event_time: time,
    party_size: Math.round(party),
    contact_name: cleanText(input?.contact_name, 200),
    contact_phone: cleanText(input?.contact_phone, 60),
    status,
    notes: cleanText(input?.notes, 2000),
    menu,
    event_total: cleanMoney(input?.event_total),
    deposit: cleanMoney(input?.deposit),
  };
}

export function parseMenu(raw) {
  if (Array.isArray(raw)) return raw.map(cleanMenuLine).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(cleanMenuLine).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * One event row, shaped for a reader. The menu lines gain
 * their dish names from the business's recipes. MONEY IS
 * OWNER-ONLY: for anyone else the money keys never exist on
 * the row at all — no total, no deposit, no balance.
 */
export function shapeEvent(row, recipesById, { isOwner = false } = {}) {
  const menu = parseMenu(row?.menu).map((line) => ({
    ...line,
    name: recipesById?.get(line.recipe_id)?.name || '',
  }));
  const shaped = {
    id: row.id,
    name: row.name || '',
    event_date: row.event_date || '',
    event_time: row.event_time || '',
    party_size: Number(row.party_size) || 0,
    contact_name: row.contact_name || '',
    contact_phone: row.contact_phone || '',
    status: row.status || 'booked',
    notes: row.notes || '',
    menu,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
  if (isOwner) {
    const total = round2(row.event_total);
    const deposit = round2(row.deposit);
    shaped.event_total = total;
    shaped.deposit = deposit;
    shaped.balance_due = round2(total - deposit);
  }
  return shaped;
}

/**
 * What one event pulls from the shelves — the prep face.
 * Pure. For each menu dish: the makes its servings take
 * (servings ÷ the recipe's yield per make, rounded UP — a
 * part-make still has to be made) and the ingredients those
 * makes consume, expanded through sub-recipes in stock
 * units by the 359/361 machinery. The totals fold every
 * dish's pull together, so the Prep page can show the whole
 * party's weight on the walk-in at a glance. A cancelled
 * event pulls nothing.
 */
export function eventPrep(recipes, products, event) {
  const recipesById = new Map((recipes || []).map((r) => [r.id, r]));
  const productsById = new Map((products || []).map((p) => [p.id, p]));
  const dishes = [];
  const totals = new Map();
  if (event && event.status !== 'cancelled') {
    for (const line of parseMenu(event.menu)) {
      const recipe = recipesById.get(line.recipe_id);
      if (!recipe) continue;
      const servings = Number(line.servings) || 0;
      if (!(servings > 0)) continue;
      const makes = Math.ceil(servings / yieldQtyOf(recipe));
      const expanded = expandRecipeToProducts(recipesById, recipe, new Set(), productsById);
      const ingredients = [...expanded.entries()].map(([productId, perMake]) => {
        const product = productsById.get(productId);
        const quantity = round2(perMake * makes);
        const entry = {
          product_id: productId,
          name: product?.name || '',
          quantity,
          unit: product?.unit || 'each',
        };
        const running = totals.get(productId) || { ...entry, quantity: 0 };
        running.quantity = round2(running.quantity + quantity);
        totals.set(productId, running);
        return entry;
      });
      dishes.push({ recipe_id: recipe.id, name: recipe.name, servings, makes, ingredients });
    }
  }
  return {
    dishes,
    totals: [...totals.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/* --------------------------------------------------- DB doors */

async function loadRecipes(pool, businessId) {
  const { rows } = await pool.query('SELECT * FROM recipes WHERE business_id = $1', [businessId]);
  return rows;
}

async function loadProducts(pool, businessId) {
  const { rows } = await pool.query('SELECT * FROM products WHERE business_id = $1', [businessId]);
  return rows;
}

/** Keep only menu lines naming a recipe of THIS business. */
function scopeMenu(menu, recipes) {
  const ids = new Set(recipes.map((r) => r.id));
  return menu.filter((line) => ids.has(line.recipe_id));
}

export async function listEvents(pool, businessId, { isOwner = false } = {}) {
  const [{ rows }, recipes] = await Promise.all([
    pool.query(
      'SELECT * FROM catering_events WHERE business_id = $1 ORDER BY event_date ASC, event_time ASC, name ASC',
      [businessId],
    ),
    loadRecipes(pool, businessId),
  ]);
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  return rows.map((row) => shapeEvent(row, recipesById, { isOwner }));
}

export async function getEvent(pool, businessId, eventId, { isOwner = false } = {}) {
  const { rows } = await pool.query(
    'SELECT * FROM catering_events WHERE id = $1 AND business_id = $2 LIMIT 1',
    [eventId, businessId],
  );
  if (!rows[0]) throw err(404, 'not_found', 'Not found.');
  const recipes = await loadRecipes(pool, businessId);
  return shapeEvent(rows[0], new Map(recipes.map((r) => [r.id, r])), { isOwner });
}

export async function createEvent(pool, businessId, input, { userId = null } = {}) {
  const recipes = await loadRecipes(pool, businessId);
  const clean = cleanEvent(input);
  clean.menu = scopeMenu(clean.menu, recipes);
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO catering_events
       (id, business_id, name, event_date, event_time, party_size, contact_name, contact_phone,
        status, notes, menu, event_total, deposit, created_by_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [id, businessId, clean.name, clean.event_date, clean.event_time, clean.party_size,
      clean.contact_name, clean.contact_phone, clean.status, clean.notes,
      JSON.stringify(clean.menu), clean.event_total, clean.deposit, userId],
  );
  return shapeEvent(rows[0], new Map(recipes.map((r) => [r.id, r])), { isOwner: true });
}

export async function updateEvent(pool, businessId, eventId, input, { isOwner = false } = {}) {
  const existing = (await pool.query(
    'SELECT * FROM catering_events WHERE id = $1 AND business_id = $2 LIMIT 1',
    [eventId, businessId],
  )).rows[0];
  if (!existing) throw err(404, 'not_found', 'Not found.');
  // Money is the owner's alone to set: a non-owner save
  // carries the stored money through untouched.
  const merged = isOwner ? input : { ...input, event_total: existing.event_total, deposit: existing.deposit };
  const recipes = await loadRecipes(pool, businessId);
  const clean = cleanEvent(merged);
  clean.menu = scopeMenu(clean.menu, recipes);
  const { rows } = await pool.query(
    `UPDATE catering_events SET
       name = $3, event_date = $4, event_time = $5, party_size = $6, contact_name = $7,
       contact_phone = $8, status = $9, notes = $10, menu = $11, event_total = $12,
       deposit = $13, updated_at = NOW()
     WHERE id = $1 AND business_id = $2
     RETURNING *`,
    [eventId, businessId, clean.name, clean.event_date, clean.event_time, clean.party_size,
      clean.contact_name, clean.contact_phone, clean.status, clean.notes,
      JSON.stringify(clean.menu), clean.event_total, clean.deposit],
  );
  return shapeEvent(rows[0], new Map(recipes.map((r) => [r.id, r])), { isOwner });
}

export async function deleteEvent(pool, businessId, eventId) {
  const { rowCount } = await pool.query(
    'DELETE FROM catering_events WHERE id = $1 AND business_id = $2',
    [eventId, businessId],
  );
  if (!rowCount) throw err(404, 'not_found', 'Not found.');
}

/** The prep face over the book: every upcoming booked event
 *  (today onward, in the caller's date) with the food it
 *  pulls — the rows the Prep page plans around. */
export async function upcomingEventPrep(pool, businessId, today) {
  const [{ rows }, recipes, products] = await Promise.all([
    pool.query(
      `SELECT * FROM catering_events
       WHERE business_id = $1 AND status = 'booked' AND event_date >= $2
       ORDER BY event_date ASC, event_time ASC, name ASC`,
      [businessId, today],
    ),
    loadRecipes(pool, businessId),
    loadProducts(pool, businessId),
  ]);
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  return rows.map((row) => ({
    event: shapeEvent(row, recipesById, { isOwner: false }),
    prep: eventPrep(recipes, products, row),
  }));
}

export async function eventPrepFor(pool, businessId, eventId) {
  const { rows } = await pool.query(
    'SELECT * FROM catering_events WHERE id = $1 AND business_id = $2 LIMIT 1',
    [eventId, businessId],
  );
  if (!rows[0]) throw err(404, 'not_found', 'Not found.');
  const [recipes, products] = await Promise.all([
    loadRecipes(pool, businessId),
    loadProducts(pool, businessId),
  ]);
  return eventPrep(recipes, products, rows[0]);
}
