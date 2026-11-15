/**
 * Word-by-word product search (owner ruling, Nov 14, 2026): split the
 * query into words; a product matches when EVERY word appears
 * somewhere in its combined searchable text — name, SKU, UPC/EAN,
 * barcode, ISBN, author, brand, tags, AND its category name among
 * them. So "Cool Ranch chips" finds Cool Ranch Doritos (category
 * Chips), "chips" alone finds every Chips product, and single-word
 * searches behave exactly as before. Products (server query in
 * listProducts) and My inventory (client filter) share this rule.
 */
export const SEARCHABLE_FIELDS = [
  'name', 'sku', 'upc', 'barcode', 'isbn', 'author', 'brand', 'publisher',
  'manufacturer', 'category', 'subcategory', 'tags',
];

/** Splits a search box value into its words ("Cool Ranch chips" → 3). */
export function searchWords(search) {
  return String(search ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every word appears in the product's searchable text. */
export function productMatchesSearch(product, words) {
  if (!words.length) return true;
  const haystack = SEARCHABLE_FIELDS.map((field) => {
    const value = product?.[field];
    return Array.isArray(value) ? value.join(' ') : (value ?? '');
  })
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}
