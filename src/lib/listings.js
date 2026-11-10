import { base44 } from '@/api/client';
import { escapeRegex } from '@/lib/inventory';
import { scoped } from '@/lib/scoped';

/** Manual listing tracker: nothing syncs with a marketplace, the owner keeps it true. */
export const LISTING_CHANNELS = {
  shopify: { label: 'Shopify', tone: 'green' },
  ebay: { label: 'eBay', tone: 'blue' },
  amazon: { label: 'Amazon', tone: 'yellow' },
  etsy: { label: 'Etsy', tone: 'purple' },
  walmart: { label: 'Walmart', tone: 'blue' },
  tiktok_shop: { label: 'TikTok Shop', tone: 'pink' },
  facebook: { label: 'Facebook', tone: 'blue' },
  google: { label: 'Google', tone: 'green' },
  other: { label: 'Other', tone: 'gray' },
};

export const LISTING_STATUSES = {
  draft: { label: 'Draft', tone: 'gray' },
  live: { label: 'Live', tone: 'green' },
  paused: { label: 'Paused', tone: 'yellow' },
  ended: { label: 'Ended', tone: 'gray' },
};

export const LISTING_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'draft', label: 'Draft' },
  { key: 'paused', label: 'Paused' },
  { key: 'ended', label: 'Ended' },
];

export async function listListings({ status = 'all', channel = 'all', search = '', businessId = '' } = {}) {
  const query = {};
  if (status !== 'all') query.status = status;
  if (channel !== 'all') query.channel = channel;
  const term = search.trim();
  if (term) {
    // A typed "(" or "*" is a search term, not a pattern: escaped, so the query always runs.
    const pattern = escapeRegex(term);
    query.$or = [
      { product_name: { $regex: pattern, $options: 'i' } },
      { sku: { $regex: pattern, $options: 'i' } },
      { external_id: { $regex: pattern, $options: 'i' } },
    ];
  }
  const page = await base44.entities.Listing.filter(scoped(query, businessId), {
    sort: '-updated_date',
    limit: 200,
  });
  return page.items ?? [];
}