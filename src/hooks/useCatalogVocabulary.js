import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';
import { dataVersion, subscribeData } from '@/lib/dataFreshness';

/** Categories, subcategories and tags defined for the active business. */
export function useCatalogVocabulary(businessId) {
  const [rows, setRows] = useState([]);
  // Which business's list has finished loading at least once. The
  // product form's no-silent-creation guard may only judge typed
  // values against a list that has actually arrived — an empty list
  // that is still loading proves nothing.
  const [loadedFor, setLoadedFor] = useState('');
  // One shared truth (Nov 14, 2026): category/tag writes bump the
  // inventory bus, and this hook refetches the moment it moves —
  // so Products facets and the product form's suggestions agree
  // with the Categories & tags page even while a screen stays open.
  const [version, setVersion] = useState(() => dataVersion('inventory'));

  useEffect(
    () => subscribeData('inventory', () => setVersion(dataVersion('inventory'))),
    [],
  );

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    base44.entities.Category
      .filter(scoped({}, businessId), { sort: 'name', limit: 500 })
      .then((page) => {
        if (cancelled) return;
        setRows(page.items ?? []);
        setLoadedFor(businessId);
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setLoadedFor(businessId);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, version]);

  const names = (kind) => rows.filter((row) => row.kind === kind).map((row) => row.name);

  return {
    categories: names('category'),
    subcategories: names('subcategory'),
    // The product Format pick-list's owner-added formats ride the
    // same per-business vocabulary table (kind 'format', Nov 24,
    // 2026): the built-in Paperback / Hardcover live in the form
    // itself; everything the owner adds lives here, per business.
    formats: names('format'),
    tags: names('tag'),
    loaded: Boolean(businessId) && loadedFor === businessId,
  };
}