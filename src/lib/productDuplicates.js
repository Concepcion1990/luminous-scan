/**
 * Duplicate recognition — the pure half of the owner's counting rule
 * (Nov 14, 2026): a copy of a product is the SAME product, never
 * another one. "It should not be counting the copy at all."
 *
 * A product is a duplicate of another when either mark says so:
 *  - the durable marker: `duplicate_of` names the product it was
 *    copied from (migration 024; set by the Duplicate action from
 *    now on — a copy of a copy points at the original), or
 *  - the legacy birthmarks, for copies minted before the marker
 *    existed: the Duplicate action has always cleared the copy's
 *    code fields (upc, barcode, qr_code) and minted its SKU as
 *    `<SKU>-COPY` (or `-COPY-2`, `-COPY-3`, … on a clash). A product
 *    carrying BOTH birthmarks is a copy; either one alone is not
 *    proof — a real product may share a shelf name, and a real
 *    product's codes may be re-entered by hand.
 *
 * Status never matters here: a copy is a copy active or archived,
 * and an original counts active or archived — archiving never
 * frees a slot (the owner, watching her pill drop 3 → 2 when she
 * archived a product: "that should have stayed at three out of
 * 50"). Only a true delete lowers the count. This one definition
 * is THE product count everywhere: the Products pill, the
 * server-side plan cap (whose twin predicate lives in
 * server/entities.js), the Overview's Active SKUs card and its
 * limit hint. 'Select all N listed' is a different number — a
 * plain row count for bulk actions — and is not decided here.
 */

/** True when the product is a copy of another product. */
export function isDuplicateProduct(product) {
  if (!product) return false;
  if (product.duplicate_of) return true;
  const sku = String(product.sku || '').trim();
  if (!/-COPY(-\d+)?$/i.test(sku)) return false;
  return !product.upc && !product.barcode && !product.qr_code;
}

/** How many of these products are distinct products (copies excluded). */
export function countDistinctProducts(products) {
  return (products || []).reduce(
    (count, product) => count + (isDuplicateProduct(product) ? 0 : 1),
    0,
  );
}
