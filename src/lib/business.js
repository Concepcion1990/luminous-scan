import { base44 } from '@/api/client';
import { localTimeZoneName } from '@/lib/dates';
import { t } from './i18n.js';

export const APP_NAME = 'Luminous StockHaven';
export const APP_TAGLINE = 'A home for everything your business carries.';
export const PUBLISHER = 'The Luminous Book Shop, LLC';

/** One login can own this many independent businesses. Enforced again server-side. */
export const MAX_BUSINESSES = 5;

export const DEFAULT_BUSINESS = {
  // The software name is never used as a merchant's business name — the two
  // identities stay separate, even before a business profile is saved.
  name: 'Your business',
  tagline: '',
  logo_url: '',
  brand_color: '#145042',
  contact_email: '',
  contact_phone: '',
  website: '',
  address: '',
  currency: 'USD',
  timezone: '',
  date_format: 'MMM d, yyyy',
  unit_system: 'imperial',
  language: 'en',
};

export const BRAND_COLORS = [
  { get label() { return t('businessLib.brandColor.forest'); }, value: '#145042' },
  { get label() { return t('businessLib.brandColor.deepPine'); }, value: '#1d3b2a' },
  { get label() { return t('businessLib.brandColor.ink'); }, value: '#22303a' },
  { get label() { return t('businessLib.brandColor.clay'); }, value: '#7d4b34' },
  { get label() { return t('businessLib.brandColor.plum'); }, value: '#5b3352' },
];

export const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD', 'MXN', 'JPY'];

export const DATE_FORMATS = [
  { value: 'MMM d, yyyy', get label() { return t('businessLib.dateFormat.mmmDyyyy'); } },
  { value: 'd MMM yyyy', get label() { return t('businessLib.dateFormat.dMmmYyyy'); } },
  { value: 'M/d/yyyy', get label() { return t('businessLib.dateFormat.mDYyyy'); } },
  { value: 'yyyy-MM-dd', get label() { return t('businessLib.dateFormat.yyyyMMdd'); } },
];

/** Fills in defaults so the app always has a name, tagline and timezone to show. */
export function resolveBusiness(record) {
  const base = { ...DEFAULT_BUSINESS, timezone: localTimeZoneName() };
  if (!record) return base;
  return {
    ...base,
    ...record,
    name: record.name?.trim() || base.name,
    tagline: record.tagline?.trim() || '',
    timezone: record.timezone || base.timezone,
  };
}

/**
 * The signed-in owner's businesses plus the one currently being worked in.
 * The selected workspace is only a preference — access is decided by row rules.
 */
export async function loadWorkspace() {
  const [user, page] = await Promise.all([
    base44.auth.me().catch(() => null),
    base44.entities.Business.filter({}, { sort: 'created_date', limit: MAX_BUSINESSES }),
  ]);
  const businesses = page.items ?? [];
  const saved = user?.active_business_id ?? user?.data?.active_business_id ?? null;
  const activeId = businesses.some((b) => b.id === saved) ? saved : businesses[0]?.id ?? null;
  return { user, businesses, activeId };
}

export async function switchBusiness(businessId) {
  await base44.auth.updateMe({ active_business_id: businessId });
}

export async function createBusiness(values) {
  const response = await base44.functions.invoke('createBusiness', {
    name: values.name,
    tagline: values.tagline || '',
    currency: values.currency || 'USD',
  });
  if (response.data?.error) throw new Error(response.data.error);
  return response.data.business;
}

export async function renameBusiness(businessId, name) {
  return base44.entities.Business.update(businessId, { name: name.trim() });
}

export async function saveBusiness(record, values) {
  const payload = {
    name: values.name?.trim() || 'Your business',
    tagline: values.tagline?.trim() || '',
    logo_url: values.logo_url || '',
    brand_color: values.brand_color || DEFAULT_BUSINESS.brand_color,
    contact_email: values.contact_email?.trim() || '',
    contact_phone: values.contact_phone?.trim() || '',
    website: values.website?.trim() || '',
    address: values.address?.trim() || '',
    currency: values.currency || 'USD',
    timezone: values.timezone || localTimeZoneName(),
    date_format: values.date_format || 'MMM d, yyyy',
    unit_system: values.unit_system || 'imperial',
    language: values.language || 'en',
  };
  return record?.id
    ? base44.entities.Business.update(record.id, payload)
    : base44.entities.Business.create(payload);
}

export function timezoneOptions() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch {
    // Older browsers fall through to the short list below.
  }
  return [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Anchorage',
    'Pacific/Honolulu',
    'America/Toronto',
    'Europe/London',
    'Europe/Berlin',
    'Australia/Sydney',
    'UTC',
  ];
}