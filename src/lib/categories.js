/**
 * Categories, subcategories and tags as the catalog actually uses them.
 *
 * Products carry their classification as plain text, while the Categories page
 * stores managed records. These helpers read the words from products so the two
 * can be reconciled without losing a single existing classification.
 */

function tally(map, raw) {
  const name = String(raw ?? '').trim();
  if (!name) return;
  const key = name.toLowerCase();
  const entry = map.get(key) || { name, count: 0 };
  entry.count += 1;
  map.set(key, entry);
}

function toList(map) {
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Distinct values used by products, with how many products use each. */
export function productVocabulary(products = []) {
  const categories = new Map();
  const subcategories = new Map();
  const tags = new Map();
  const parentOf = new Map();

  products.forEach((product) => {
    tally(categories, product?.category);
    tally(subcategories, product?.subcategory);

    const sub = String(product?.subcategory ?? '').trim();
    const cat = String(product?.category ?? '').trim();
    if (sub && cat && !parentOf.has(sub.toLowerCase())) parentOf.set(sub.toLowerCase(), cat);

    (Array.isArray(product?.tags) ? product.tags : []).forEach((tag) => tally(tags, tag));
  });

  return {
    categories: toList(categories),
    subcategories: toList(subcategories).map((entry) => ({
      ...entry,
      parentName: parentOf.get(entry.name.toLowerCase()) || '',
    })),
    tags: toList(tags),
  };
}

/** lower-cased category or subcategory name → how many products use it. */
export function countByField(products = [], field) {
  const tallyMap = new Map();
  products.forEach((product) => {
    const name = String(product?.[field] ?? '').trim().toLowerCase();
    if (!name) return;
    tallyMap.set(name, (tallyMap.get(name) || 0) + 1);
  });
  return tallyMap;
}

/** Words products use that the managed list does not have yet. */
export function missingEntries(rows = [], products = []) {
  const known = (kind) =>
    new Set(
      rows
        .filter((row) => row.kind === kind)
        .map((row) => String(row.name || '').trim().toLowerCase())
    );
  const have = {
    category: known('category'),
    subcategory: known('subcategory'),
    tag: known('tag'),
  };

  const vocabulary = productVocabulary(products);
  const build = (kind, list) =>
    list
      .filter((entry) => entry.name && !have[kind].has(entry.name.toLowerCase()))
      .map((entry) => ({
        kind,
        name: entry.name,
        count: entry.count,
        parent_name: entry.parentName || '',
      }));

  return [
    ...build('category', vocabulary.categories),
    ...build('subcategory', vocabulary.subcategories),
    ...build('tag', vocabulary.tags),
  ];
}