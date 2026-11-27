import crypto from 'node:crypto';

/**
 * Guest menu publication — server core (plan release 371,
 * Nov 26, 2026). The client mirror of the menu shaping is
 * src/lib/kitchenMenu.js; keep the two in step.
 *
 * The publication is the OWNER'S choice and nothing else: a
 * row in menu_publications (migration 060) naming the recipes
 * the guests may see, under an unguessable slug. The public
 * door shapes its answer from that list alone — a recipe that
 * is not on the list does not exist for a guest, and no cost,
 * stock, supplier or staff fact ever rides the shaped item.
 * Allergen flags are computed here from the products' own
 * allergen records, rolled up through sub-recipes — the 361
 * allergen matrix's rule, never a hand-typed menu note.
 */

export const MENU_SLUG_BYTES = 24;

export function newMenuSlug() {
  return crypto.randomBytes(MENU_SLUG_BYTES).toString('base64url');
}

const ALLERGENS = ['milk', 'eggs', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'wheat', 'soy', 'sesame'];

export function parseAllergens(product) {
  const raw = product?.allergens;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim()
      ? (() => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } })()
      : [];
  return list.filter((key) => ALLERGENS.includes(key));
}

function expandToProductIds(recipesById, recipe, seen = new Set()) {
  const out = new Set();
  if (!recipe || seen.has(recipe.id)) return out;
  const next = new Set(seen); next.add(recipe.id);
  for (const line of recipe.lines || []) {
    if (line.kind === 'recipe') {
      const sub = recipesById.get(line.recipe_id);
      for (const id of expandToProductIds(recipesById, sub, next)) out.add(id);
    } else if (line.product_id) out.add(line.product_id);
  }
  return out;
}

/** Every allergen in a dish: the union over its expanded
 *  ingredients plus its linked dish product — the matrix rule. */
export function dishAllergensServer(recipes, products, recipe) {
  const recipesById = new Map((recipes || []).map((r) => [r.id, r]));
  const productsById = new Map((products || []).map((p) => [p.id, p]));
  const found = new Set();
  if (recipe?.product_id) for (const k of parseAllergens(productsById.get(recipe.product_id))) found.add(k);
  for (const pid of expandToProductIds(recipesById, recipe)) {
    for (const k of parseAllergens(productsById.get(pid))) found.add(k);
  }
  return ALLERGENS.filter((k) => found.has(k));
}

export function cleanPublishedIds(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? (() => { try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; } })()
      : [];
  const seen = new Set(); const out = [];
  for (const id of raw) {
    const text = typeof id === 'string' ? id.trim() : '';
    if (text && !seen.has(text)) { seen.add(text); out.push(text); }
  }
  return out;
}

/** Shape the public menu: ONLY published recipes, in the
 *  publication's order, guest-safe fields only. */
export function buildGuestMenu({ business, publication, recipes, products }) {
  const byId = new Map((recipes || []).map((r) => [r.id, r]));
  const productsById = new Map((products || []).map((p) => [p.id, p]));
  const items = [];
  for (const id of cleanPublishedIds(publication?.recipe_ids)) {
    const recipe = byId.get(id);
    if (!recipe) continue;
    const dish = recipe.product_id ? productsById.get(recipe.product_id) : null;
    items.push({
      recipeId: recipe.id,
      name: recipe.name || '',
      description: recipe.description || '',
      photoUrl: recipe.photo_url || '',
      price: dish && Number(dish.price) > 0 ? Number(dish.price) : null,
      allergens: dishAllergensServer(recipes, products, recipe),
    });
  }
  return {
    businessName: business?.name || '',
    currency: business?.currency || '',
    items,
  };
}

export function shapePublication(row) {
  if (!row) return { slug: '', enabled: false, recipeIds: [] };
  return {
    slug: row.slug || '',
    enabled: row.enabled === true,
    recipeIds: cleanPublishedIds(row.recipe_ids),
  };
}
