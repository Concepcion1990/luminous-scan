/**
 * The product form's category/subcategory save guard (owner ruling,
 * Nov 14, 2026): no silent category births. A value TYPED into the
 * form that is not in the business's managed list must stop the save
 * with a plain message — new entries are born only through the picker
 * list's "Add new" row. Before this, typed text rode onto the product
 * and surfaced as a category in the Products filters, invented by a
 * save nobody confirmed.
 *
 * judgeVocabularyValue decides one field:
 *  - empty, unchanged-since-open (edit/copy seeds are grandfathered —
 *    they are not new births), or vocabulary not loaded yet → pass
 *    with the trimmed value;
 *  - a case-insensitive match in the managed list or in the names
 *    created through Add new this session → pass with the LIST's
 *    exact spelling, so "drinks" and "Drinks" never become two
 *    categories;
 *  - anything else → not ok; the caller shows the plain message.
 */
export function judgeVocabularyValue({ typedRaw, initial, options, sanctioned, loaded }) {
  const typed = (typedRaw || '').trim();
  if (!typed || typed === initial || !loaded) return { ok: true, value: typed };
  const match = [...(options || []), ...(sanctioned || [])].find(
    (name) => name.toLowerCase() === typed.toLowerCase(),
  );
  if (!match) return { ok: false, value: typed };
  return { ok: true, value: match };
}
