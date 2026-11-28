/**
 * All-locations rollup + cross-location push — the core
 * (Nov 26, 2026; plan release 380: Gap 14 + its Part 7
 * quick-fire rider).
 *
 * THE ROLLUP is reporting over data that already exists —
 * no new capture, no new table, no migration. For every
 * business the caller OWNS it reads, from that business's
 * own records:
 *   - food cost %: the business's priced dishes' true cost
 *     (server/recipes.js recipeCostPerUnit, the 359 math)
 *     against their linked products' prices, aggregated —
 *     Σ true cost ÷ Σ price over dishes that carry a price.
 *     No priced dish means the figure is null, never a
 *     made-up zero (the missing-money rule).
 *   - stock value: Σ on-hand × cost over live products,
 *     with the units whose cost was never entered counted
 *     apart (missingCostUnits), never folded in as zero.
 *   - waste this week: the waste log's rows since Monday
 *     (date_trunc('week')) — units, entries, and value at
 *     each entry's own logged unit cost.
 *   - what's low: live products at or under their reorder
 *     point (reorder_point > 0), counted, with the first
 *     few named.
 *
 * THE PUSH is the small managing door beside the rollup:
 * copy a recipe, or this business's price set (product
 * price + cost), into the owner's OTHER businesses, so a
 * 2–5 location owner stops re-keying the same change per
 * business. Copies are explicit owner actions, business to
 * business, inside the owner's own account only — a target
 * the caller does not own is refused whole, and a target
 * not on the Business plan is reported skipped, never
 * written. Products and dishes match across businesses by
 * SKU first (exact, case-insensitive), then by name
 * (exact, case-insensitive) — the storefront-matching
 * doctrine's own order (any one of SKU/UPC/ISBN identifies;
 * here the catalog keys are SKU and name). Anything with
 * no match is NAMED in the result — dropped lines are
 * reported, never silent.
 *
 * A recipe copy UPDATES the same-named recipe in the
 * target (that is the point of the push: the change lands
 * everywhere) or inserts it new. A copy whose dish product
 * has no match in the target lands as a DRAFT — an active
 * recipe with no dish cannot deplete honestly — and the
 * result says so.
 *
 * OWNER-ONLY throughout: the rollup is the multi-business
 * owner's page, and the push is the owner's managing door.
 * BUSINESS-ONLY by nature (multi-business IS Business):
 * the routes sit behind the restaurant corner's plan gate,
 * and the Locations shelf itself only appears for owners
 * with 2+ businesses.
 */
import crypto from 'node:crypto';
import { loadBusinessesForUser } from './authz.js';
import { planFor, featureAllowed } from './plans.js';
import { recipeCostPerUnit, recipeLines } from './recipes.js';

export const ROLLUP_OWNER_MESSAGE = 'Only the owner can use the all-locations rollup.';
export const ROLLUP_MESSAGE = 'Check the copy request and try again.';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cleanText(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

const liveProduct = (product) => product.status !== 'archived' && product.active !== false;
const moneyKnown = (value) =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

/**
 * Match one source product against a target business's
 * products: SKU first (both non-empty, exact apart from
 * case and surrounding space), then name the same way.
 * Returns the target product or null. Pure.
 */
export function matchProduct(source, targetProducts) {
  if (!source) return null;
  const sku = cleanText(source.sku, 120).toLowerCase();
  if (sku) {
    const bySku = (targetProducts || []).find(
      (p) => cleanText(p.sku, 120).toLowerCase() === sku,
    );
    if (bySku) return bySku;
  }
  const name = cleanText(source.name, 300).toLowerCase();
  if (name) {
    return (targetProducts || []).find(
      (p) => cleanText(p.name, 300).toLowerCase() === name,
    ) || null;
  }
  return null;
}

/**
 * Remap a source recipe into a target business's own ids.
 * Pure: the caller supplies the source recipe, the source
 * catalogs (Maps by id) and the target catalogs (arrays).
 * Returns { lines, dropped, dish } — dish is the matched
 * target product for the recipe's own dish (or null), and
 * dropped names every line that found no match, in the
 * order the lines were written.
 */
export function remapRecipeLines(sourceRecipe, sourceProductsById, sourceRecipesById, targetProducts, targetRecipes) {
  const dishSource = sourceRecipe?.product_id ? sourceProductsById.get(sourceRecipe.product_id) : null;
  const dish = dishSource
    ? matchProduct(dishSource, targetProducts)
    : (sourceRecipe?.product_name
      ? matchProduct({ name: sourceRecipe.product_name, sku: '' }, targetProducts)
      : null);
  const dropped = [];
  const lines = [];
  for (const line of recipeLines(sourceRecipe)) {
    if (line?.kind === 'recipe') {
      const subSource = line.recipe_id ? sourceRecipesById.get(line.recipe_id) : null;
      const wanted = cleanText(subSource?.name || line.recipe_name, 300).toLowerCase();
      const sub = wanted
        ? (targetRecipes || []).find((r) => cleanText(r.name, 300).toLowerCase() === wanted)
        : null;
      if (!sub) {
        dropped.push(cleanText(subSource?.name || line.recipe_name || '', 300));
        continue;
      }
      lines.push({ ...line, recipe_id: sub.id, recipe_name: sub.name });
    } else {
      const ingredient = line?.product_id ? sourceProductsById.get(line.product_id) : null;
      const matched = ingredient
        ? matchProduct(ingredient, targetProducts)
        : (line?.product_name ? matchProduct({ name: line.product_name, sku: line.sku || '' }, targetProducts) : null);
      if (!matched) {
        dropped.push(cleanText(ingredient?.name || line?.product_name || '', 300));
        continue;
      }
      lines.push({
        ...line,
        product_id: matched.id,
        product_name: matched.name,
        sku: matched.sku || '',
      });
    }
  }
  return { lines, dropped: dropped.filter(Boolean), dish };
}

/** One business's rollup row, from its own records. */
async function summarizeBusiness(pool, business) {
  const businessId = business.id;
  const [products, levels, recipes, waste] = await Promise.all([
    pool.query('SELECT * FROM products WHERE business_id = $1', [businessId]),
    pool.query('SELECT product_id, quantity FROM stock_levels WHERE business_id = $1', [businessId]),
    pool.query('SELECT * FROM recipes WHERE business_id = $1', [businessId]),
    pool.query(
      `SELECT COALESCE(SUM(quantity), 0) AS units, COUNT(*)::int AS entries,
              COALESCE(SUM(quantity * COALESCE(unit_cost, 0)), 0) AS value
       FROM waste_entries
       WHERE business_id = $1 AND created_at >= date_trunc('week', NOW())`,
      [businessId],
    ),
  ]);
  const productRows = products.rows.filter(liveProduct);
  const productById = new Map(productRows.map((p) => [p.id, p]));
  const recipesById = new Map(recipes.rows.map((r) => [r.id, r]));
  const allProductsById = new Map(products.rows.map((p) => [p.id, p]));

  // Food cost %: Σ true cost ÷ Σ price over priced dishes.
  let costSum = 0;
  let priceSum = 0;
  let pricedDishes = 0;
  for (const recipe of recipes.rows) {
    const price = Number(allProductsById.get(recipe.product_id)?.price) || 0;
    if (!(price > 0)) continue;
    pricedDishes += 1;
    costSum += recipeCostPerUnit(recipesById, allProductsById, recipe);
    priceSum += price;
  }
  const foodCostPct = pricedDishes > 0
    ? Math.round((costSum / priceSum) * 1000) / 10
    : null;

  // Stock value + what's low, from the levels.
  const qtyByProduct = new Map();
  for (const level of levels.rows) {
    qtyByProduct.set(level.product_id, (qtyByProduct.get(level.product_id) || 0) + (Number(level.quantity) || 0));
  }
  let stockValue = 0;
  let missingCostUnits = 0;
  for (const [productId, qty] of qtyByProduct) {
    const product = productById.get(productId);
    if (!product || !(qty > 0)) continue;
    if (moneyKnown(product.cost)) stockValue += qty * Number(product.cost);
    else missingCostUnits += qty;
  }
  const low = productRows
    .filter((p) => Number(p.reorder_point) > 0 && (qtyByProduct.get(p.id) || 0) <= Number(p.reorder_point))
    .map((p) => ({
      product_id: p.id,
      name: p.name,
      quantity: qtyByProduct.get(p.id) || 0,
      reorder_point: Number(p.reorder_point),
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const wasteRow = waste.rows[0] || {};
  return {
    business_id: businessId,
    name: business.name,
    foodCostPct,
    pricedDishes,
    stockValue: round2(stockValue),
    missingCostUnits: round2(missingCostUnits),
    waste: {
      units: round2(wasteRow.units || 0),
      entries: Number(wasteRow.entries) || 0,
      value: round2(wasteRow.value || 0),
    },
    lowCount: low.length,
    low: low.slice(0, 5),
  };
}

/**
 * The rollup read: one row per business the caller owns
 * (in the account's own order), plus the push panel's
 * source facts for the business in the URL — its recipes
 * and how many of its products carry a price or a cost.
 */
export async function buildRollup(pool, user, sourceBusinessId) {
  const owned = await loadBusinessesForUser(pool, user.id);
  const rows = [];
  for (const business of owned) rows.push(await summarizeBusiness(pool, business));
  const [recipes, products] = await Promise.all([
    pool.query(
      'SELECT id, name, status, product_name FROM recipes WHERE business_id = $1 ORDER BY name ASC',
      [sourceBusinessId],
    ),
    pool.query(
      'SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1 AND (price IS NOT NULL OR cost IS NOT NULL)',
      [sourceBusinessId],
    ),
  ]);
  return {
    businesses: rows,
    source: {
      business_id: sourceBusinessId,
      recipes: recipes.rows,
      pricedProducts: Number(products.rows[0]?.n) || 0,
    },
  };
}

function cleanTargetIds(input, sourceBusinessId) {
  const raw = Array.isArray(input?.target_business_ids) ? input.target_business_ids : [];
  const ids = [...new Set(raw.map((id) => cleanText(id, 120)).filter(Boolean))]
    .filter((id) => id !== sourceBusinessId);
  if (!ids.length) throw err(400, 'locations_rollup_invalid', ROLLUP_MESSAGE);
  return ids.slice(0, 10);
}

/** Resolve the caller's owned targets; a target the caller
 *  does not own refuses the whole request — copies stay
 *  inside the owner's own account, no partial surprises. */
async function ownedTargets(pool, user, ids) {
  const owned = await loadBusinessesForUser(pool, user.id);
  const byId = new Map(owned.map((b) => [b.id, b]));
  return ids.map((id) => {
    const business = byId.get(id);
    if (!business) throw err(400, 'locations_rollup_invalid', ROLLUP_MESSAGE);
    return business;
  });
}

async function targetPlanOk(pool, businessId) {
  return featureAllowed(await planFor(pool, businessId), 'restaurant');
}

/**
 * Copy one recipe from the source business into each
 * target. Per target: created | updated | skipped_plan,
 * the lines dropped for want of a match (named), and
 * whether the dish itself matched (an unmatched dish
 * lands the copy as a draft).
 */
export async function copyRecipe(pool, user, sourceBusinessId, input) {
  const recipeId = cleanText(input?.recipe_id, 120);
  if (!recipeId) throw err(400, 'locations_rollup_invalid', ROLLUP_MESSAGE);
  const targets = await ownedTargets(pool, user, cleanTargetIds(input, sourceBusinessId));

  const { rows: sourceRecipeRows } = await pool.query(
    'SELECT * FROM recipes WHERE id = $1 AND business_id = $2',
    [recipeId, sourceBusinessId],
  );
  const sourceRecipe = sourceRecipeRows[0];
  if (!sourceRecipe) throw err(400, 'locations_rollup_invalid', ROLLUP_MESSAGE);
  const [{ rows: sourceProducts }, { rows: sourceRecipes }] = await Promise.all([
    pool.query('SELECT * FROM products WHERE business_id = $1', [sourceBusinessId]),
    pool.query('SELECT * FROM recipes WHERE business_id = $1', [sourceBusinessId]),
  ]);
  const sourceProductsById = new Map(sourceProducts.map((p) => [p.id, p]));
  const sourceRecipesById = new Map(sourceRecipes.map((r) => [r.id, r]));

  const results = [];
  for (const target of targets) {
    if (!(await targetPlanOk(pool, target.id))) {
      results.push({ business_id: target.id, business_name: target.name, status: 'skipped_plan' });
      continue;
    }
    const [{ rows: targetProducts }, { rows: targetRecipes }] = await Promise.all([
      pool.query("SELECT * FROM products WHERE business_id = $1 AND COALESCE(status, 'active') <> 'archived'", [target.id]),
      pool.query('SELECT * FROM recipes WHERE business_id = $1', [target.id]),
    ]);
    const { lines, dropped, dish } = remapRecipeLines(
      sourceRecipe, sourceProductsById, sourceRecipesById, targetProducts, targetRecipes,
    );
    const status = dish ? sourceRecipe.status : 'draft';
    const existing = targetRecipes.find(
      (r) => cleanText(r.name, 300).toLowerCase() === cleanText(sourceRecipe.name, 300).toLowerCase(),
    );
    const values = [
      target.id,
      sourceRecipe.name,
      sourceRecipe.description || '',
      dish?.id || '',
      dish?.name || sourceRecipe.product_name || '',
      status,
      Number(sourceRecipe.yield_qty) || 1,
      Number(sourceRecipe.q_factor_pct) || 0,
      sourceRecipe.photo_url || '',
      JSON.stringify(lines),
      sourceRecipe.notes || '',
      user.id,
      user.email || '',
    ];
    let action;
    if (existing) {
      await pool.query(
        `UPDATE recipes SET name = $2, description = $3, product_id = $4, product_name = $5,
           status = $6, yield_qty = $7, q_factor_pct = $8, photo_url = $9, lines = $10,
           notes = $11, updated_at = NOW()
         WHERE id = $12 AND business_id = $1`,
        [...values, existing.id],
      );
      action = 'updated';
    } else {
      await pool.query(
        `INSERT INTO recipes
           (id, business_id, name, description, product_id, product_name, status, yield_qty,
            q_factor_pct, photo_url, location_id, location_name, lines, notes, created_by_id, created_by)
         VALUES ($13, $1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, '', $10, $11, $12, $14)`,
        [...values.slice(0, 11), values[11], crypto.randomUUID(), values[12]],
      );
      action = 'created';
    }
    results.push({
      business_id: target.id,
      business_name: target.name,
      status: action,
      dropped,
      dishMatched: Boolean(dish),
    });
  }
  return { recipe: { id: sourceRecipe.id, name: sourceRecipe.name }, results };
}

/**
 * Copy the source business's price set — every live
 * product's price and cost — into each target, matched by
 * SKU then name. Only values the source actually carries
 * are written (a null never erases a target's figure).
 * Per target: how many products were updated and how many
 * source products found no match (counted, and the rollup
 * names the rule — the products themselves are the
 * source's whole catalog, too many to list).
 */
export async function copyPrices(pool, user, sourceBusinessId, input) {
  const targets = await ownedTargets(pool, user, cleanTargetIds(input, sourceBusinessId));
  const { rows: sourceProducts } = await pool.query(
    "SELECT * FROM products WHERE business_id = $1 AND COALESCE(status, 'active') <> 'archived' AND active IS DISTINCT FROM FALSE",
    [sourceBusinessId],
  );
  const priced = sourceProducts.filter((p) => moneyKnown(p.price) || moneyKnown(p.cost));
  const results = [];
  for (const target of targets) {
    if (!(await targetPlanOk(pool, target.id))) {
      results.push({ business_id: target.id, business_name: target.name, status: 'skipped_plan' });
      continue;
    }
    const { rows: targetProducts } = await pool.query(
      "SELECT * FROM products WHERE business_id = $1 AND COALESCE(status, 'active') <> 'archived'",
      [target.id],
    );
    let updated = 0;
    let skipped = 0;
    for (const source of priced) {
      const match = matchProduct(source, targetProducts);
      if (!match) { skipped += 1; continue; }
      await pool.query(
        `UPDATE products SET price = COALESCE($2, price), cost = COALESCE($3, cost), updated_at = NOW()
         WHERE id = $1 AND business_id = $4`,
        [match.id, moneyKnown(source.price) ? Number(source.price) : null,
         moneyKnown(source.cost) ? Number(source.cost) : null, target.id],
      );
      updated += 1;
    }
    results.push({
      business_id: target.id,
      business_name: target.name,
      status: 'copied',
      updated,
      skipped,
    });
  }
  return { results };
}
