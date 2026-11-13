import { base44 } from '@/api/client';
import { escapeRegex } from '@/lib/inventory';
import { scoped } from '@/lib/scoped';
import { t } from './i18n.js';

/** Manual listing tracker: nothing syncs with a marketplace, the owner keeps it true. */
export const LISTING_CHANNELS = {
  shopify: { get label() { return t('listingsLib.channelShopify'); }, tone: 'green' },
  ebay: { get label() { return t('listingsLib.channelEbay'); }, tone: 'blue' },
  amazon: { get label() { return t('listingsLib.channelAmazon'); }, tone: 'yellow' },
  etsy: { get label() { return t('listingsLib.channelEtsy'); }, tone: 'purple' },
  walmart: { get label() { return t('listingsLib.channelWalmart'); }, tone: 'blue' },
  tiktok_shop: { get label() { return t('listingsLib.channelTiktokShop'); }, tone: 'pink' },
  facebook: { get label() { return t('listingsLib.channelFacebook'); }, tone: 'blue' },
  google: { get label() { return t('listingsLib.channelGoogle'); }, tone: 'green' },
  other: { get label() { return t('listingsLib.channelOther'); }, tone: 'gray' },
};

export const LISTING_STATUSES = {
  draft: { get label() { return t('listingsLib.statusDraft'); }, tone: 'gray' },
  live: { get label() { return t('listingsLib.statusLive'); }, tone: 'green' },
  paused: { get label() { return t('listingsLib.statusPaused'); }, tone: 'yellow' },
  ended: { get label() { return t('listingsLib.statusEnded'); }, tone: 'gray' },
};

export const LISTING_FILTERS = [
  { key: 'all', get label() { return t('listingsLib.filterAll'); } },
  { key: 'live', get label() { return t('listingsLib.filterLive'); } },
  { key: 'draft', get label() { return t('listingsLib.filterDraft'); } },
  { key: 'paused', get label() { return t('listingsLib.filterPaused'); } },
  { key: 'ended', get label() { return t('listingsLib.filterEnded'); } },
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