import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';

/**
 * Every ledger entry for one business, newest first, following pagination.
 * Reports and alerts both read the same history, so it is fetched one way.
 */
export async function fetchMovements(businessId, { pages = 12, pageSize = 500, since = '' } = {}) {
  const rows = [];
  let cursor = null;
  const query = since ? { created_date: { $gte: since } } : {};
  for (let page = 0; page < pages; page += 1) {
    const result = await base44.entities.StockMovement.filter(scoped(query, businessId), {
      sort: '-created_date',
      limit: pageSize,
      ...(cursor ? { cursor } : {}),
    });
    const items = result?.items ?? (Array.isArray(result) ? result : []);
    rows.push(...items);
    cursor = result?.next_cursor;
    if (!cursor || items.length === 0) break;
  }
  return rows;
}