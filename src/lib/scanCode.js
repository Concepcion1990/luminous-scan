const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEME = /^https?:\/\//i;
const DOMAIN_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]{2,})+(\/[^\s]*)?$/i;
const IDENTIFIERISH = /^[A-Za-z0-9][A-Za-z0-9 ._\-/#+]{1,39}$/;
const REF_KEYS = [
  'upc',
  'ean',
  'gtin',
  'gtin13',
  'gtin12',
  'isbn',
  'isbn13',
  'sku',
  'barcode',
  'product_id',
  'productid',
  'pid',
];
const PRODUCT_SEGMENTS = ['product', 'products', 'p', 'item', 'items', 'book', 'books'];

/** Returns a safe http(s) address for a scanned value, or null. */
export function toSafeUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const hasScheme = SAFE_SCHEME.test(value);
  if (!hasScheme && !DOMAIN_LIKE.test(value)) return null;
  try {
    const url = new URL(hasScheme ? value : `https://${value}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Finds a product code carried inside a website address, so a product-page
 * link can offer a deliberate inventory search. Nothing is imported.
 */
export function extractProductRef(url) {
  try {
    const parsed = new URL(url);
    for (const key of REF_KEYS) {
      const value = parsed.searchParams.get(key);
      if (value && value.trim()) return { key, value: value.trim() };
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    const marker = segments.findIndex((segment) => PRODUCT_SEGMENTS.includes(segment.toLowerCase()));
    if (marker >= 0 && segments[marker + 1]) {
      const candidate = decodeURIComponent(segments[marker + 1]).replace(/\.html?$/i, '');
      // Slug identifiers ("blue-mug") are not product codes; only codes that
      // look like an identifier are offered as an inventory reference.
      if (IDENTIFIERISH.test(candidate) && /\d/.test(candidate)) {
        return { key: 'path', value: candidate };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Reads structured product information such as {"sku":"…","name":"…"}. */
export function parseStructured(raw) {
  const text = String(raw || '').trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const fields = Object.entries(data)
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
      .slice(0, 8)
      .map(([key, value]) => ({ key, value: String(value) }));
    if (!fields.length) return null;
    const identifier = fields.find((field) => REF_KEYS.includes(field.key.toLowerCase()));
    return { fields, identifier: identifier?.value || null };
  } catch {
    return null;
  }
}

/**
 * Works out what a decoded code represents without touching inventory.
 * Kinds: url · structured · identifier · text (unsafe links stay text).
 */
export function classifyScan(raw) {
  const value = String(raw || '').trim();
  if (!value) return { kind: 'empty', raw: '' };

  const url = toSafeUrl(value);
  if (url) {
    return { kind: 'url', raw: value, url, productRef: extractProductRef(url) };
  }

  const structured = parseStructured(value);
  if (structured) return { kind: 'structured', raw: value, ...structured };

  if (SCHEME.test(value) && !SAFE_SCHEME.test(value)) {
    return { kind: 'text', raw: value, unsafeLink: true };
  }

  if (IDENTIFIERISH.test(value) && /\d/.test(value)) {
    return { kind: 'identifier', raw: value };
  }

  return { kind: 'text', raw: value };
}