import { dishAllergens } from './restaurantOps.js';
import { yieldQtyOf } from './recipes.js';

/**
 * Kitchen display + guest menu math (plan release 371, Nov 26,
 * 2026) — pure helpers shared by the station view, the owner's
 * guest-menu page and the public guest page. The server mirror
 * is server/guestMenuCore.js; keep the two in step.
 *
 * Two doctrines live here:
 *  - RESCALING IS ONE TAP: the cook picks a batch count and
 *    every amount on the recipe rescales by exactly that count
 *    (yield scales too). Nothing else about the recipe changes.
 *  - THE GUEST MENU SHOWS ONLY WHAT THE OWNER PUBLISHED: an
 *    item exists on the menu only when its recipe id is in the
 *    owner's saved publication list, in that list's order, and
 *    its allergen flags come from the 361 allergen matrix
 *    (dishAllergens over the dish's own ingredients) — never
 *    from anything typed on the menu itself.
 */

/** Batch counts are whole batches, 1..99 — a station never
 *  cooks zero or a fraction by accident. Anything else reads
 *  back as 1. */
export function normalizeBatchCount(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : 1;
}

/** Trim float dust from a scaled amount (0.30000000004 -> 0.3). */
export function tidyQty(value) {
  const n = Number(value) || 0;
  return Math.round(n * 1000) / 1000;
}

/** The recipe's lines at `batches` batches: label, detail and
 *  the scaled quantity text, in the recipe's own order. */
export function scaledLines(recipe, recipesById, productsById, batches) {
  const count = normalizeBatchCount(batches);
  return (recipe?.lines || []).map((line) => {
    const qty = tidyQty((Number(line.quantity) || 0) * count);
    if (line.kind === 'recipe') {
      const sub = recipesById?.get(line.recipe_id);
      return {
        label: line.recipe_name || sub?.name || '',
        detail: sub ? `× ${yieldQtyOf(sub)}` : '',
        qty,
        qtyText: `${qty}`,
        unit: '',
      };
    }
    const product = productsById?.get(line.product_id);
    const unit = line.unit || product?.unit || '';
    return {
      label: line.product_name || product?.name || '',
      detail: '',
      qty,
      qtyText: `${qty} ${unit}`.trim(),
      unit,
    };
  });
}

/** The recipe's method, as steps: the description's own lines,
 *  in order, blanks dropped. A recipe with no written method
 *  has no steps — the display says so rather than inventing. */
export function recipeSteps(recipe) {
  return String(recipe?.description || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** The owner's saved publication list, cleaned: recipe ids
 *  only, no duplicates, order kept. */
export function cleanPublishedIds(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? (() => { try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; } })()
      : [];
  const seen = new Set();
  const out = [];
  for (const id of raw) {
    const text = typeof id === 'string' ? id.trim() : '';
    if (text && !seen.has(text)) { seen.add(text); out.push(text); }
  }
  return out;
}

/**
 * The guest menu, built: ONLY the published recipes, in the
 * publication's order, each with its name, photo, description,
 * its linked dish's price (null when the dish carries none),
 * and its allergen keys straight from the 361 matrix.
 * Unpublished recipes never appear; a published id with no
 * matching recipe is skipped, never guessed at.
 */
export function buildGuestMenuItems(recipes, products, publishedIds) {
  const byId = new Map((recipes || []).map((r) => [r.id, r]));
  const productsById = new Map((products || []).map((p) => [p.id, p]));
  const items = [];
  for (const id of cleanPublishedIds(publishedIds)) {
    const recipe = byId.get(id);
    if (!recipe) continue;
    const dish = recipe.product_id ? productsById.get(recipe.product_id) : null;
    const price = dish && Number(dish.price) > 0 ? Number(dish.price) : null;
    items.push({
      recipeId: recipe.id,
      name: recipe.name || '',
      description: recipe.description || '',
      photoUrl: recipe.photo_url || '',
      price,
      allergens: dishAllergens(recipes, products, recipe),
    });
  }
  return items;
}
