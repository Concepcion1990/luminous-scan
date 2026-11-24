import { base44 } from '../api/client.js';
import { scoped } from './scoped.js';

/**
 * The restaurant corner's math (release 359, Nov 23, 2026) —
 * the client mirror of server/recipes.js. The server computes
 * the same figures for the recipe read (and shapes them away
 * for anyone without the money tick); this copy drives the
 * dish page's line-by-line costs and the order guide, from
 * rows the page already holds. Keep the two in step: yield
 * divides COST (edible-portion pricing) but never the shelf
 * quantity, sub-recipes roll up through their yield, and the
 * Q factor touches cost only.
 */

/** A product's unit conversions, however the row carries them
 *  (release 361): the entity stores a JSON array of
 *  {unit, per} — per = how many of that unit make ONE stock
 *  unit (1 kg = 1000 g → {unit:'g', per:1000}). Accepts the
 *  parsed array or the raw string; anything else reads as no
 *  conversions. */
export function parseUnitConversions(product) {
  const raw = product?.unit_conversions;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** A recipe line's quantity in the product's STOCK units
 *  (release 361 — the exact mirror of the server's
 *  lineStockQty): no line unit, or the stock unit itself,
 *  means the quantity already is stock units; a known
 *  conversion divides by its per; an unknown unit falls back
 *  to the quantity as written — never crash, never invent. */
export function lineStockQty(product, line) {
  const qty = Number(line?.quantity) || 0;
  if (!product || !line?.unit || line.unit === product.unit) return qty;
  const conversion = parseUnitConversions(product).find(
    (entry) => entry?.unit === line.unit && Number(entry?.per) > 0
  );
  return conversion ? qty / Number(conversion.per) : qty;
}

export function yieldQtyOf(recipe) {
  const qty = Number(recipe?.yield_qty);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function yieldFactor(line) {
  const pct = Number(line?.yield_pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 1;
  return pct / 100;
}

export function recipeCostPerMake(recipesById, productsById, recipe, seen = new Set()) {
  if (!recipe || seen.has(recipe.id)) return 0;
  const nextSeen = new Set(seen);
  nextSeen.add(recipe.id);
  let sum = 0;
  for (const line of recipe.lines || []) {
    const qty = Number(line?.quantity) || 0;
    if (qty <= 0) continue;
    if (line.kind === 'recipe') {
      const sub = recipesById.get(line.recipe_id);
      if (!sub) continue;
      sum += qty * (recipeCostPerMake(recipesById, productsById, sub, nextSeen) / yieldQtyOf(sub));
    } else {
      const product = productsById.get(line.product_id);
      sum += (lineStockQty(product, line) * (Number(product?.cost) || 0)) / yieldFactor(line);
    }
  }
  const q = Math.min(Math.max(Number(recipe.q_factor_pct) || 0, 0), 100);
  return sum * (1 + q / 100);
}

export function recipeCostPerUnit(recipesById, productsById, recipe) {
  if (!recipe) return 0;
  return recipeCostPerMake(recipesById, productsById, recipe) / yieldQtyOf(recipe);
}

/** Flatten a recipe to raw products: Map product_id -> the
 *  as-purchased quantity ONE make consumes (sub-recipes
 *  rolled up). This is what a sale takes off the shelf. */
export function expandRecipeToProducts(recipesById, recipe, seen = new Set(), productsById = null) {
  const out = new Map();
  if (!recipe || seen.has(recipe.id)) return out;
  const nextSeen = new Set(seen);
  nextSeen.add(recipe.id);
  for (const line of recipe.lines || []) {
    const qty = Number(line?.quantity) || 0;
    if (qty <= 0) continue;
    if (line.kind === 'recipe') {
      const sub = recipesById.get(line.recipe_id);
      if (!sub) continue;
      const subMakes = qty / yieldQtyOf(sub);
      for (const [productId, subQty] of expandRecipeToProducts(recipesById, sub, nextSeen, productsById)) {
        out.set(productId, (out.get(productId) || 0) + subQty * subMakes);
      }
    } else if (line.product_id) {
      // Depletion is in stock units (release 361): when the
      // caller hands over the products, a line written in a
      // converted unit (grams against a kilogram stock unit)
      // converts through lineStockQty; without products the
      // quantity stands as written, as before.
      const stockQty = productsById ? lineStockQty(productsById.get(line.product_id), line) : qty;
      out.set(line.product_id, (out.get(line.product_id) || 0) + stockQty);
    }
  }
  return out;
}

export async function listRecipes(businessId = '') {
  const page = await base44.entities.Recipe.filter(scoped({}, businessId), {
    sort: 'name',
    limit: 300,
  });
  return page.items ?? [];
}

export async function listPars(businessId = '') {
  const page = await base44.entities.Par.filter(scoped({}, businessId), {
    sort: 'product_name',
    limit: 500,
  });
  return page.items ?? [];
}

/** On hand for one product: the par's own location when the
 *  par names one, else the whole business. */
export function onHandFor(levels, productId, locationId) {
  let total = 0;
  for (const level of levels || []) {
    if (level.product_id !== productId) continue;
    if (locationId && level.location_id !== locationId) continue;
    total += Number(level.quantity) || 0;
  }
  return total;
}

/** Still coming: Σ (ordered − received) over the purchase
 *  orders that are actually out (ordered / partial — a draft
 *  is not on its way, a received one already landed). */
export function onOrderFor(purchaseOrders, productId) {
  let total = 0;
  for (const po of purchaseOrders || []) {
    if (!['ordered', 'partial'].includes(po.status)) continue;
    for (const line of po.lines || []) {
      if (line.product_id !== productId) continue;
      total += Math.max((Number(line.qty_ordered) || 0) - (Number(line.qty_received) || 0), 0);
    }
  }
  return total;
}

/**
 * The order guide (her spec): one row per par — par − on
 * hand − on order is the need, and a positive need rounds UP
 * to the par's pack size. Rows carry their supplier (the
 * par's own, falling back to the product's) so the page can
 * group them and send one draft purchase order per supplier
 * into the existing Purchasing flow.
 */
export function guideRows({ pars, levels, purchaseOrders, productsById, suppliersById }) {
  return (pars || []).map((par) => {
    const product = productsById.get(par.product_id);
    const onHand = onHandFor(levels, par.product_id, par.location_id || null);
    const onOrder = onOrderFor(purchaseOrders, par.product_id);
    const parQty = Number(par.par_qty) || 0;
    const need = parQty - onHand - onOrder;
    const pack = Number(par.pack_size) > 0 ? Number(par.pack_size) : 1;
    const orderQty = need > 0 ? Math.ceil(need / pack) * pack : 0;
    const supplierId = par.supplier_id || product?.supplier_id || '';
    const supplierName =
      par.supplier_name || product?.supplier_name || suppliersById?.get(supplierId)?.name || '';
    return {
      par,
      product,
      onHand,
      onOrder,
      parQty,
      need,
      orderQty,
      pack,
      supplierId,
      supplierName,
    };
  });
}

/**
 * The recipe upload (the ImportCenter pattern, small): one
 * ingredient per row — `name or SKU, quantity` — with an
 * optional header row. Rows match the catalog by SKU first,
 * then by name (case-insensitive). Returns the lines that
 * matched and the row texts that did not, so the owner sees
 * exactly what did not land — nothing is silently dropped.
 */
export function parseRecipeUpload(text, products) {
  const bySku = new Map();
  const byName = new Map();
  for (const product of products || []) {
    if (product.sku) bySku.set(String(product.sku).trim().toLowerCase(), product);
    if (product.name) byName.set(String(product.name).trim().toLowerCase(), product);
  }
  const lines = [];
  const unmatched = [];
  const rows = String(text || '')
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  rows.forEach((row, index) => {
    const cells = row.split(/[,\t;]/).map((cell) => cell.trim());
    const first = (cells[0] || '').toLowerCase();
    if (index === 0 && (first === 'ingredient' || first === 'product' || first === 'item' || first === 'name' || first === 'sku')) {
      return; // a header row, not an ingredient
    }
    const qty = Number(cells[1]);
    const product = bySku.get(first) || byName.get(first);
    if (!product || !(qty > 0)) {
      unmatched.push(row);
      return;
    }
    lines.push({
      kind: 'product',
      product_id: product.id,
      product_name: product.name,
      sku: product.sku || '',
      unit: product.unit || 'each',
      quantity: qty,
      yield_pct: 100,
    });
  });
  return { lines, unmatched };
}
