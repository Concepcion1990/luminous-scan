import { expandRecipeToProducts, onHandFor, yieldQtyOf } from './recipes.js';

/**
 * Restaurant operations math (release 361, Nov 23, 2026) —
 * pure helpers for the ops doors: allergens, expiry lots,
 * the invoice three-way match preview, menu engineering,
 * variance and prep. No money is invented here: a figure
 * that depends on cost is only produced when the rows the
 * caller holds already carry it (the server shapes recipe
 * true_cost and waste unit_cost away for anyone without the
 * money tick, and these helpers leave the matching fields
 * null rather than computing around the gap).
 */

/** The nine major allergens, by stable key. Labels live in
 *  the locales under allergens.<key>. */
export const ALLERGENS = [
  'milk',
  'eggs',
  'fish',
  'shellfish',
  'tree_nuts',
  'peanuts',
  'wheat',
  'soy',
  'sesame',
];

/** A product's allergen keys, however the row carries them
 *  (the entity stores a JSON array). */
export function parseAllergens(product) {
  const raw = product?.allergens;
  if (Array.isArray(raw)) return raw.filter((key) => ALLERGENS.includes(key));
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((key) => ALLERGENS.includes(key)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Every allergen in a dish: the union over its expanded
 *  ingredients (sub-recipes rolled up). Unit conversions are
 *  irrelevant here — presence is what matters. */
export function dishAllergens(recipes, products, recipe) {
  const recipesById = new Map((recipes || []).map((r) => [r.id, r]));
  const productsById = new Map((products || []).map((p) => [p.id, p]));
  const found = new Set();
  if (recipe?.product_id) {
    for (const key of parseAllergens(productsById.get(recipe.product_id))) found.add(key);
  }
  for (const productId of expandRecipeToProducts(recipesById, recipe).keys()) {
    for (const key of parseAllergens(productsById.get(productId))) found.add(key);
  }
  return ALLERGENS.filter((key) => found.has(key));
}

/** First-expired, first-out: batches with a use-by date sort
 *  earliest first; a batch with no date goes last. */
export function fefoOrder(batches) {
  return [...(batches || [])].sort((a, b) => {
    const aDate = a.expires_on || '';
    const bDate = b.expires_on || '';
    if (aDate && bDate) return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    if (aDate) return -1;
    if (bDate) return 1;
    return 0;
  });
}

const dayMs = 24 * 60 * 60 * 1000;

function dateOnly(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Batches already past their use-by date, or reaching it
 *  within `days` days of `from` (today by default). */
export function expiringSoon(batches, days, from = new Date()) {
  const start = dateOnly(from).getTime();
  const limit = start + Math.max(Number(days) || 0, 0) * dayMs;
  return fefoOrder(batches).filter((batch) => {
    if (!batch.expires_on || !(Number(batch.quantity) > 0)) return false;
    const when = dateOnly(batch.expires_on).getTime();
    return Number.isFinite(when) && when <= limit;
  });
}

/** Whole days from `from` until a batch's use-by date
 *  (negative once it has passed). */
export function daysUntilExpiry(batch, from = new Date()) {
  if (!batch?.expires_on) return null;
  const when = dateOnly(batch.expires_on).getTime();
  if (!Number.isFinite(when)) return null;
  return Math.round((when - dateOnly(from).getTime()) / dayMs);
}

/**
 * The three-way match, previewed on the client before save
 * (the server's read shaping is authoritative): each invoice
 * line against its purchase order line — ordered and received
 * from the PO, invoiced from the invoice, unit costs
 * compared. Flags: ok | short (invoiced less than ordered) |
 * over (invoiced more than ordered) | price_diff (the unit
 * cost moved) | not_ordered (no PO line for the product).
 * With no PO the match is null, exactly as the server shapes
 * it.
 */
export function matchInvoice(invoice, purchaseOrder) {
  if (!invoice || !purchaseOrder) return null;
  const poLines = new Map();
  for (const line of purchaseOrder.lines || []) {
    if (line?.product_id) poLines.set(line.product_id, line);
  }
  let allOk = true;
  const lines = (invoice.lines || []).map((line) => {
    const poLine = poLines.get(line?.product_id);
    const invoiced = Number(line?.quantity) || 0;
    if (!poLine) {
      allOk = false;
      return { ...line, ordered: null, received: null, invoiced, flag: 'not_ordered' };
    }
    const ordered = Number(poLine.qty_ordered) || 0;
    const received = Number(poLine.qty_received) || 0;
    let flag = 'ok';
    if (invoiced < ordered) flag = 'short';
    else if (invoiced > ordered) flag = 'over';
    else if (Math.abs((Number(line?.unit_cost) || 0) - (Number(poLine.unit_cost) || 0)) > 0.0001) flag = 'price_diff';
    if (flag !== 'ok') allOk = false;
    return { ...line, ordered, received, invoiced, flag };
  });
  return { lines, status: allOk ? 'match' : 'review' };
}

function inPeriod(row, period) {
  if (!period?.from && !period?.to) return true;
  const day = String(row?.created_date || '').slice(0, 10);
  if (!day) return false;
  if (period.from && day < period.from) return false;
  if (period.to && day > period.to) return false;
  return true;
}

/**
 * Menu engineering: one row per dish (a recipe linked to a
 * product), from the period's sale movements. Units and
 * revenue always figure; margin rides the recipe's
 * server-shaped true_cost — absent for non-money holders, so
 * marginPerUnit, totalMargin and quadrant stay null rather
 * than being computed from costs the reader may not see.
 * Quadrants split on the averages: a star sells well and
 * earns well, a plowhorse sells well and earns little, a
 * puzzle earns well and sells little, a dog does neither.
 */
export function menuEngineering(recipes, products, saleMovements, period) {
  const productsById = new Map((products || []).map((p) => [p.id, p]));
  const unitsByProduct = new Map();
  for (const movement of saleMovements || []) {
    if (movement?.type !== 'sale' || !inPeriod(movement, period)) continue;
    unitsByProduct.set(
      movement.product_id,
      (unitsByProduct.get(movement.product_id) || 0) + (Number(movement.quantity) || 0)
    );
  }
  const rows = [];
  for (const recipe of recipes || []) {
    if (!recipe?.product_id) continue;
    const product = productsById.get(recipe.product_id);
    const units = unitsByProduct.get(recipe.product_id) || 0;
    const price = Number(product?.price) || 0;
    const hasCost = recipe.true_cost != null;
    const marginPerUnit = hasCost ? price - Number(recipe.true_cost) : null;
    rows.push({
      recipe,
      product: product || null,
      name: recipe.name,
      units,
      revenue: units * price,
      marginPerUnit,
      totalMargin: marginPerUnit != null ? marginPerUnit * units : null,
      quadrant: null,
    });
  }
  const sold = rows.filter((row) => row.units > 0);
  const avgUnits = sold.length ? sold.reduce((sum, row) => sum + row.units, 0) / sold.length : 0;
  const margined = sold.filter((row) => row.marginPerUnit != null);
  const avgMargin = margined.length
    ? margined.reduce((sum, row) => sum + row.marginPerUnit, 0) / margined.length
    : null;
  for (const row of rows) {
    if (!(row.units > 0) || row.marginPerUnit == null || avgMargin == null) continue;
    const popular = row.units >= avgUnits;
    const earns = row.marginPerUnit >= avgMargin;
    row.quadrant = popular && earns ? 'star' : popular ? 'plowhorse' : earns ? 'puzzle' : 'dog';
  }
  return rows.sort((a, b) => b.units - a.units);
}

/**
 * Variance: what should have left the shelf against what
 * did, per product, over the period. Theoretical use is the
 * recipe depletion (consume movements); staff meals and
 * waste are their own columns (waste from the waste log —
 * its write-off movements are not double-counted); every
 * other way out (sales of the product itself, damage, loss,
 * write-offs the waste log does not explain) lands in
 * otherOut, and unexplained is exactly that otherOut — the
 * gap a manager still has to explain.
 */
export function varianceRows(movements, wasteEntries, period) {
  const byProduct = new Map();
  const rowFor = (movement) => {
    const key = movement.product_id || movement.product_name || '';
    if (!byProduct.has(key)) {
      byProduct.set(key, {
        product_id: movement.product_id || '',
        name: movement.product_name || '',
        theoretical: 0,
        staffMeal: 0,
        waste: 0,
        otherOut: 0,
        totalOut: 0,
        unexplained: 0,
      });
    }
    return byProduct.get(key);
  };
  const wasteIds = new Set((wasteEntries || []).map((entry) => entry.id));
  for (const movement of movements || []) {
    if (!inPeriod(movement, period)) continue;
    const qty = Math.abs(Number(movement.quantity) || 0);
    if (!(qty > 0)) continue;
    if (movement.type === 'consume') {
      const row = rowFor(movement);
      row.theoretical += qty;
      row.totalOut += qty;
    } else if (movement.type === 'staff_meal') {
      const row = rowFor(movement);
      row.staffMeal += qty;
      row.totalOut += qty;
    } else if (movement.type === 'write_off' && wasteIds.has(movement.reference)) {
      // The waste log below speaks for this movement.
      continue;
    } else if (['sale', 'damaged', 'lost', 'write_off', 'disassemble', 'transfer'].includes(movement.type)) {
      const row = rowFor(movement);
      row.otherOut += qty;
      row.totalOut += qty;
    }
  }
  for (const entry of wasteEntries || []) {
    if (!inPeriod(entry, period)) continue;
    const row = rowFor(entry);
    const qty = Math.abs(Number(entry.quantity) || 0);
    row.waste += qty;
    row.totalOut += qty;
  }
  const rows = [...byProduct.values()];
  for (const row of rows) row.unexplained = row.otherOut;
  return rows
    .filter((row) => row.totalOut > 0)
    .sort((a, b) => b.totalOut - a.totalOut);
}

/**
 * The prep sheet: one row per dish whose product carries a
 * par — build up to the par, in whole makes of its recipe —
 * with the ingredients those makes will take, in stock
 * units. A dish already at or above par needs no makes.
 */
export function prepRows(pars, recipes, products, levels) {
  const productsById = new Map((products || []).map((p) => [p.id, p]));
  const recipesById = new Map((recipes || []).map((r) => [r.id, r]));
  const parByProduct = new Map();
  for (const par of pars || []) {
    if (par?.product_id) parByProduct.set(par.product_id, par);
  }
  const rows = [];
  for (const recipe of recipes || []) {
    if (!recipe?.product_id) continue;
    const par = parByProduct.get(recipe.product_id);
    if (!par) continue;
    const buildTo = Number(par.par_qty) || 0;
    const onHand = onHandFor(levels, recipe.product_id, par.location_id || null);
    const shortfall = Math.max(buildTo - onHand, 0);
    const makes = shortfall > 0 ? Math.ceil(shortfall / yieldQtyOf(recipe)) : 0;
    const expanded = expandRecipeToProducts(recipesById, recipe, new Set(), productsById);
    const ingredients = [...expanded.entries()].map(([productId, qty]) => {
      const product = productsById.get(productId);
      return {
        product_id: productId,
        name: product?.name || '',
        photo_url: product?.photo_urls?.[0] || '',
        quantity: qty * makes,
        unit: product?.unit || 'each',
      };
    });
    rows.push({ recipe, buildTo, onHand, makes, ingredients });
  }
  return rows.sort((a, b) => a.recipe.name.localeCompare(b.recipe.name));
}

/** Waste log reason codes (fixed by the record). Labels
 *  live in the locales under ops.waste.reason.<code>. */
export const WASTE_REASONS = [
  'spoilage',
  'overproduction',
  'prep_mistake',
  'returned',
  'spillage',
  'other',
];

/** Fridge, freezer and hot-holding defaults, in Celsius —
 *  the ranges a new temperature log starts from. A reading
 *  is in range when it sits between min and max (a null end
 *  is open). */
export const TEMP_PRESETS = [
  { key: 'fridge', min: 0, max: 4 },
  { key: 'freezer', min: -23, max: -18 },
  { key: 'hot', min: 60, max: null },
];

export function tempPresetFor(unitName) {
  const name = String(unitName || '').toLowerCase();
  if (name.includes('freez')) return TEMP_PRESETS[1];
  if (name.includes('hot') || name.includes('hold') || name.includes('steam')) return TEMP_PRESETS[2];
  return TEMP_PRESETS[0];
}

/** Whether a reading is inside a preset's range, converting
 *  the reading to Celsius first when it was taken in
 *  Fahrenheit. */
export function tempInRange(temperature, scale, preset) {
  const value = Number(temperature);
  if (!Number.isFinite(value) || !preset) return false;
  const celsius = scale === 'F' ? ((value - 32) * 5) / 9 : value;
  if (preset.min != null && celsius < preset.min) return false;
  if (preset.max != null && celsius > preset.max) return false;
  return true;
}

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The accounting ledger as CSV text: one row per event
 * across the given sections, under the ledger's fixed
 * columns. Sections arrive server-shaped
 * ({section, rows: [{date, item, quantity, unitCost,
 * totalCost, reference}]}); a row whose money the server
 * withheld leaves its cost cells blank.
 */
export function accountingCsv(sections) {
  const header = ['Section', 'Date', 'Item', 'Quantity', 'Unit cost', 'Total cost', 'Reference'];
  const lines = [header.join(',')];
  for (const section of sections || []) {
    for (const row of section.rows || []) {
      lines.push(
        [
          csvCell(section.section),
          csvCell(row.date),
          csvCell(row.item),
          csvCell(row.quantity),
          csvCell(row.unitCost),
          csvCell(row.totalCost),
          csvCell(row.reference),
        ].join(',')
      );
    }
  }
  return lines.join('\r\n');
}
