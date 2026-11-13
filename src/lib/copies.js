import { base44 } from '@/api/client';
import { scoped } from '@/lib/scoped';

/**
 * Copies and variations. Several used books can share one ISBN while keeping
 * their own SKU, condition, price and location; clothing/stationery lines can be
 * grouped under an explicit copy group instead. Nothing is ever merged — each
 * copy stays its own product record.
 */

const digits = (value) => (value || '').replace(/[^0-9Xx]/g, '').toUpperCase();

/** The key shared by every copy or variation of one title. */
export function copyGroupKey(product) {
  if (!product) return '';
  const explicit = (product.copy_group || '').trim();
  if (explicit) return explicit;
  return digits(product.isbn);
}

/** Short line describing how one copy differs from its siblings. */
export function copyLabel(product) {
  if (!product) return '';
  const options = (product.variant_options || [])
    .map((row) => [row?.name, row?.value].filter(Boolean).join(': '))
    .filter(Boolean);
  return [product.variant_label, ...options, product.condition].filter(Boolean).join(' · ');
}

/** Every other copy or variation of the same title in this business. */
export async function loadCopyGroup({ businessId, product, limit = 100 }) {
  if (!product) return [];
  const group = (product.copy_group || '').trim();
  const isbn = (product.isbn || '').trim();
  const query = group ? { copy_group: group } : isbn ? { isbn } : null;
  if (!query) return [];

  const page = await base44.entities.Product.filter(scoped(query, businessId), {
    sort: 'sku',
    limit,
  });
  return (page.items ?? []).filter((item) => item.id !== product.id && item.id);
}