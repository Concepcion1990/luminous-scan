/**
 * Recipe costs follow the newest invoice price — the pure
 * half (plan Part 7, item 390, Nov 26, 2026).
 *
 * The wire between two live features: release 361's supplier
 * invoices and release 359's recipe costing. Recipe costs are
 * computed at read time from each product's CURRENT cost
 * (shapeRecipeMoney in server/entities.js), so the whole link
 * is: when an invoice is approved, each of its lines whose
 * billed price differs from the product's current cost moves
 * that cost — and every recipe standing on the ingredient
 * records a visible note naming the invoice price it now
 * stands on. Nothing here touches the database; the entity
 * layer owns the writes and tests pin the math directly.
 */
import { priceAlertCandidates } from './restaurantOps.js';
import { expandRecipeToProducts } from './recipes.js';

/**
 * The cost updates one invoice carries: one entry per line
 * whose billed unit cost differs from the product's current
 * cost — { product_id, product_name, old_cost, new_cost }.
 * This is the price-alert scan's comparison (restaurantOps),
 * reused whole: approval and alerts judge a line the same
 * way, so the two doors can never disagree about whether a
 * price moved. Lines naming no product, unknown products,
 * and lines with no billed cost produce nothing; a line
 * billed at the current cost is not an update.
 */
export function invoiceCostUpdates(invoice, productsById) {
  return priceAlertCandidates(invoice, productsById);
}

/**
 * Every recipe standing on one ingredient: the recipes whose
 * flattened ingredient set — sub-recipes rolled up through
 * their yields, the depletion expansion — includes the
 * product. A recipe that uses the ingredient only inside a
 * sub-recipe stands on it exactly as much as one that names
 * it directly: its plate cost moves either way, so its note
 * must too. `recipes` is the business's recipe rows (lines
 * as stored JSON or parsed); returns the matching rows.
 */
export function recipesStandingOn(recipes, productId) {
  if (!productId || !Array.isArray(recipes)) return [];
  const byId = new Map(recipes.map((row) => [row.id, row]));
  return recipes.filter((recipe) => expandRecipeToProducts(byId, recipe).has(productId));
}

/** The recipe-row note values one applied cost update leaves
 *  behind (migration 068's columns): which ingredient moved,
 *  the invoice price it stands on, and the invoice it came
 *  from. The timestamp is the write's own (the entity layer
 *  stamps NOW()); it is not carried here. */
export function costNoteValues(update, invoice) {
  return {
    cost_note_product_id: update?.product_id || '',
    cost_note_product_name: update?.product_name || '',
    cost_note_price: update?.new_cost ?? null,
    cost_note_invoice_id: invoice?.id || '',
    cost_note_invoice_number: invoice?.invoice_number || '',
    cost_note_supplier_name: invoice?.supplier_name || '',
  };
}
