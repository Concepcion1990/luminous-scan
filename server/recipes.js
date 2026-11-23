/**
 * Restaurant recipes — the math and the shelf (release 359,
 * Nov 23, 2026).
 *
 * A recipe is a dish: the lines a kitchen consumes to make it.
 * Lines name catalog products (the raw ingredients) or other
 * recipes (sub-recipes — the sauce inside the pasta). Two jobs
 * live here:
 *
 *   THE MATH (pure, shared by the read shaping): what one make
 *   of a recipe truly costs. Ingredient lines cost at
 *   edible-portion price — the as-purchased cost divided by the
 *   line's yield (research A10: costing a whole chicken at its
 *   shelf price understates the dish by ~45%; the plate only
 *   carries the edible part). Sub-recipe lines cost at the
 *   sub-recipe's own cost per unit of output, rolled up
 *   recursively. The recipe's Q factor (salt, oil, garnish —
 *   the research's 3–5%) multiplies the itemised cost. It is a
 *   COSTING number only: it never changes what leaves the
 *   shelf.
 *
 *   THE SHELF (transactional): when a product with an ACTIVE
 *   recipe sells, its ingredients leave the same shelf in
 *   proportion — depleteForSaleTx, called from the movement
 *   funnel (server/movements.js recordMovementTx) and from the
 *   generic entity layer's sale hook, so every door that can
 *   sell the dish depletes it the same way. Drafts never
 *   deplete. Depletion NEVER blocks a sale: an ingredient
 *   short on the shelf depletes to zero and its ledger row
 *   records what actually moved (previous/new stay honest);
 *   an ingredient at zero writes no row; an ARCHIVED
 *   ingredient is skipped whole (the Nov 14 freeze — no
 *   movement of any kind touches an archived product).
 *   Each consume row names its cause (cause_movement_id =
 *   the sale movement's id): a redelivered sale finds its
 *   rows already written and depletes once, and reversing
 *   the sale restores exactly its own rows
 *   (restoreDepletionsTx) — a returned dish does NOT restore
 *   ingredients, because the food was made; only a reversed
 *   sale does.
 */
import crypto from 'node:crypto';
import { getLevel, setLevel, MOVEMENT_TYPES } from './movements.js';
import { parseJsonArray } from './authz.js';

export const RECIPE_DEPLETION_TYPES = ['consume'];

export function recipeLines(recipe) {
  const lines = parseJsonArray(recipe?.lines);
  return Array.isArray(lines) ? lines : [];
}

function yieldFactor(line) {
  const pct = Number(line?.yield_pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 1;
  return pct / 100;
}

function yieldQtyOf(recipe) {
  const qty = Number(recipe?.yield_qty);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

/**
 * What ONE make of the recipe costs, in the business's money.
 * recipesById / productsById are Maps (or plain objects) of the
 * business's rows. A cycle prices the looping branch at 0 —
 * validation refuses cycles at write time, so this is only a
 * seatbelt for rows written before the guard existed.
 */
export function recipeCostPerMake(recipesById, productsById, recipe, seen = new Set()) {
  if (!recipe || seen.has(recipe.id)) return 0;
  const nextSeen = new Set(seen);
  nextSeen.add(recipe.id);
  let sum = 0;
  for (const line of recipeLines(recipe)) {
    const qty = Number(line?.quantity) || 0;
    if (qty <= 0) continue;
    if (line.kind === 'recipe') {
      const sub = getFrom(recipesById, line.recipe_id);
      if (!sub) continue;
      sum += qty * (recipeCostPerMake(recipesById, productsById, sub, nextSeen) / yieldQtyOf(sub));
    } else {
      const product = getFrom(productsById, line.product_id);
      const cost = Number(product?.cost) || 0;
      sum += (qty * cost) / yieldFactor(line);
    }
  }
  const q = Number(recipe.q_factor_pct) || 0;
  return sum * (1 + Math.min(Math.max(q, 0), 100) / 100);
}

export function recipeCostPerUnit(recipesById, productsById, recipe) {
  if (!recipe) return 0;
  return recipeCostPerMake(recipesById, productsById, recipe) / yieldQtyOf(recipe);
}

function getFrom(map, id) {
  if (!id) return null;
  if (map instanceof Map) return map.get(id) ?? null;
  return map?.[id] ?? null;
}

/**
 * Flatten a recipe to raw products: Map product_id -> the
 * as-purchased quantity ONE make consumes. Sub-recipes roll
 * up through their yield (using q units of a sub-recipe that
 * yields y per make consumes q/y of its makes). Depletion
 * takes the AP quantity — yield is waste between the shelf
 * and the plate, and the shelf loses the whole thing.
 */
export function expandRecipeToProducts(recipesById, recipe, seen = new Set()) {
  const out = new Map();
  if (!recipe || seen.has(recipe.id)) return out;
  const nextSeen = new Set(seen);
  nextSeen.add(recipe.id);
  for (const line of recipeLines(recipe)) {
    const qty = Number(line?.quantity) || 0;
    if (qty <= 0) continue;
    if (line.kind === 'recipe') {
      const sub = getFrom(recipesById, line.recipe_id);
      if (!sub) continue;
      const subMakes = qty / yieldQtyOf(sub);
      const subFlat = expandRecipeToProducts(recipesById, sub, nextSeen);
      for (const [productId, subQty] of subFlat) {
        out.set(productId, (out.get(productId) || 0) + subQty * subMakes);
      }
    } else if (line.product_id) {
      out.set(line.product_id, (out.get(line.product_id) || 0) + qty);
    }
  }
  return out;
}

async function loadBusinessRecipes(client, businessId) {
  const { rows } = await client.query(
    'SELECT * FROM recipes WHERE business_id = $1',
    [businessId],
  );
  return rows;
}

export async function activeRecipeForProduct(client, businessId, productId) {
  if (!productId) return null;
  const { rows } = await client.query(
    `SELECT * FROM recipes WHERE business_id = $1 AND product_id = $2 AND status = 'active'
     ORDER BY created_at ASC LIMIT 1`,
    [businessId, productId],
  );
  return rows[0] ?? null;
}

async function insertConsumeMovement(client, values, caller) {
  const id = crypto.randomUUID();
  const { rows } = await client.query(
    `INSERT INTO stock_movements
       (id, business_id, product_id, product_name, sku, location_id, location_name, type,
        quantity, previous_qty, new_qty, to_location_id, to_location_name, scanned_code,
        reference, supplier_name, unit_cost, note, user_name, reversal_of_id, reversal_of_label,
        cause_movement_id, created_by_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [
      id,
      values.business_id,
      values.product_id || '',
      values.product_name || '',
      values.sku || '',
      values.location_id || '',
      values.location_name || '',
      values.type,
      values.quantity ?? 0,
      values.previous_qty ?? 0,
      values.new_qty ?? 0,
      '',
      '',
      '',
      values.reference || '',
      '',
      values.unit_cost ?? 0,
      values.note || '',
      values.user_name || '',
      values.reversal_of_id || null,
      values.reversal_of_label || '',
      values.cause_movement_id || null,
      caller?.id ?? null,
      caller?.email ?? null,
    ],
  );
  return rows[0];
}

/**
 * Take a sold dish's ingredients off the shelf it sold from.
 * Runs INSIDE the caller's transaction. Returns the consume
 * rows written (possibly none). Never throws for a shortage,
 * a missing recipe or a draft — depletion is a follower of
 * the sale, never its gatekeeper.
 */
export async function depleteForSaleTx(client, {
  businessId,
  saleMovement,
  product,
  location,
  quantity,
  userName,
  caller,
}) {
  if (!saleMovement?.id || !product?.id || !location?.id) return [];
  // Idempotency: rows already carrying this cause mean the
  // sale was already followed (a redelivery, a retried hook).
  const existing = await client.query(
    'SELECT id FROM stock_movements WHERE business_id = $1 AND cause_movement_id = $2 LIMIT 1',
    [businessId, saleMovement.id],
  );
  if (existing.rows.length) return [];
  const recipe = await activeRecipeForProduct(client, businessId, product.id);
  if (!recipe) return [];
  const all = await loadBusinessRecipes(client, businessId);
  const byId = new Map(all.map((row) => [row.id, row]));
  const flat = expandRecipeToProducts(byId, recipe);
  const makes = (Number(quantity) || 0) / yieldQtyOf(recipe);
  if (!(makes > 0)) return [];
  const written = [];
  for (const [ingredientId, perMake] of flat) {
    if (ingredientId === product.id) continue;
    const need = perMake * makes;
    if (!(need > 0)) continue;
    const { rows: productRows } = await client.query(
      'SELECT * FROM products WHERE id = $1 AND business_id = $2',
      [ingredientId, businessId],
    );
    const ingredient = productRows[0];
    if (!ingredient) continue;
    // The Nov 14 freeze: an archived product's stock does not
    // move for anyone — the recipe skips it, the sale stands.
    if (ingredient.status === 'archived') continue;
    const level = await getLevel(client, businessId, ingredientId, location.id);
    const onHand = Number(level?.quantity ?? 0);
    const take = Math.min(need, onHand);
    if (!(take > 0)) continue;
    await setLevel(client, businessId, ingredientId, location.id, onHand - take, undefined, caller);
    const movement = await insertConsumeMovement(client, {
      business_id: businessId,
      product_id: ingredient.id,
      product_name: ingredient.name,
      sku: ingredient.sku || '',
      location_id: location.id,
      location_name: location.name,
      type: 'consume',
      quantity: take,
      previous_qty: onHand,
      new_qty: onHand - take,
      reference: saleMovement.reference || '',
      unit_cost: Number(ingredient.cost) || 0,
      note: `Recipe: ${recipe.name}`,
      user_name: userName || '',
      cause_movement_id: saleMovement.id,
    }, caller);
    written.push(movement);
  }
  return written;
}

function movementLabel(movement) {
  const when = movement?.created_at
    ? new Date(movement.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  return [MOVEMENT_TYPES[movement?.type]?.label || movement?.type, when].filter(Boolean).join(' · ');
}

/**
 * Put a reversed sale's ingredients back. Each consume row
 * the sale caused is restored once, as a 'correction' row
 * naming it (the mirror-write house rule: nothing is edited,
 * the correction explains itself). Runs inside the caller's
 * transaction; returns the rows written.
 */
export async function restoreDepletionsTx(client, { businessId, saleMovement, userName, caller }) {
  if (!saleMovement?.id) return [];
  const { rows: consumes } = await client.query(
    `SELECT * FROM stock_movements
     WHERE business_id = $1 AND cause_movement_id = $2 AND type = 'consume'
     ORDER BY created_at ASC`,
    [businessId, saleMovement.id],
  );
  const written = [];
  for (const consume of consumes) {
    const already = await client.query(
      'SELECT id FROM stock_movements WHERE business_id = $1 AND reversal_of_id = $2 LIMIT 1',
      [businessId, consume.id],
    );
    if (already.rows.length) continue;
    const { rows: productRows } = await client.query(
      'SELECT status FROM products WHERE id = $1 AND business_id = $2',
      [consume.product_id, businessId],
    );
    if (productRows[0]?.status === 'archived') continue;
    const level = await getLevel(client, businessId, consume.product_id, consume.location_id);
    const current = Number(level?.quantity ?? 0);
    const qty = Number(consume.quantity) || 0;
    if (!(qty > 0)) continue;
    await setLevel(client, businessId, consume.product_id, consume.location_id, current + qty, undefined, caller);
    const label = movementLabel(consume);
    const movement = await insertConsumeMovement(client, {
      business_id: businessId,
      product_id: consume.product_id,
      product_name: consume.product_name,
      sku: consume.sku || '',
      location_id: consume.location_id,
      location_name: consume.location_name,
      type: 'correction',
      quantity: qty,
      previous_qty: current,
      new_qty: current + qty,
      reference: consume.reference || '',
      unit_cost: Number(consume.unit_cost) || 0,
      note: `Reverses ${label}`,
      user_name: userName || '',
      reversal_of_id: consume.id,
      reversal_of_label: label,
    }, caller);
    written.push(movement);
  }
  return written;
}
