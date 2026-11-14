import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';
import { dataVersion, subscribeData } from '@/lib/dataFreshness';

/** Categories, subcategories and tags defined for the active business. */
export function useCatalogVocabulary(businessId) {
  const [rows, setRows] = useState([]);
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
      .then((page) => !cancelled && setRows(page.items ?? []))
      .catch(() => !cancelled && setRows([]));
    return () => {
      cancelled = true;
    };
  }, [businessId, version]);

  const names = (kind) => rows.filter((row) => row.kind === kind).map((row) => row.name);

  return {
    categories: names('category'),
    subcategories: names('subcategory'),
    tags: names('tag'),
  };
}