import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';

/** Categories, subcategories and tags defined for the active business. */
export function useCatalogVocabulary(businessId) {
  const [rows, setRows] = useState([]);

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
  }, [businessId]);

  const names = (kind) => rows.filter((row) => row.kind === kind).map((row) => row.name);

  return {
    categories: names('category'),
    subcategories: names('subcategory'),
    tags: names('tag'),
  };
}