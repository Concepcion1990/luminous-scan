/**
 * GS1 learn-more links for Settings (the owner's commission,
 * Nov 18, 2026): under the GS1 company prefix explanation, a door
 * to GS1 itself — "a lot of people won't understand that, like
 * me — remember I was confused."
 *
 * Her ruling, exactly:
 *   - The first link is the GS1 member organisation for the
 *     reader's OWN country, matched to the live locale (its
 *     country variant first; language-only locales resolve to
 *     the country where that language is at home).
 *   - For every country other than the US, the GS1 US link ALSO
 *     shows underneath — the person may have switched their app
 *     language but actually live in the US.
 *   - A country with no GS1 member organisation falls back to
 *     the global GS1 site as its door (plus the US link, same
 *     as everywhere else outside the US).
 *
 * Every URL below is the member organisation's real official
 * site, as listed in GS1's own local-offices directory (checked
 * Nov 18, 2026 — see publish-nov18-gs1links/publish-record.md).
 * Organisation names are proper nouns and are shown as-is in
 * every language; the words around them are translated
 * (`settings.details.gs1LearnMore*`).
 */

export const GS1_GLOBAL_URL = 'https://www.gs1.org/';
export const GS1_US_LINK = { name: 'GS1 US', url: 'https://www.gs1us.org/' };

/** Country code -> the GS1 member organisation serving it. */
export const GS1_BY_COUNTRY = {
  AU: { name: 'GS1 Australia', url: 'https://www.gs1au.org/' },
  BR: { name: 'GS1 Brazil', url: 'https://www.gs1br.org/' },
  CA: { name: 'GS1 Canada', url: 'https://www.gs1ca.org/' },
  CN: { name: 'GS1 China', url: 'https://www.gs1cn.org/' },
  CU: { name: 'GS1 Cuba', url: 'https://www.gs1cu.org/' },
  DE: { name: 'GS1 Germany', url: 'https://www.gs1-germany.de/' },
  EG: { name: 'GS1 Egypt', url: 'https://www.gs1eg.org/' },
  ES: { name: 'GS1 Spain', url: 'https://www.gs1es.org/' },
  FR: { name: 'GS1 France', url: 'https://www.gs1.fr/' },
  GB: { name: 'GS1 UK', url: 'https://www.gs1uk.org/' },
  HK: { name: 'GS1 Hong Kong', url: 'https://www.gs1hk.org/' },
  ID: { name: 'GS1 Indonesia', url: 'https://www.gs1id.org/' },
  IN: { name: 'GS1 India', url: 'https://www.gs1india.org/' },
  IR: { name: 'GS1 Iran', url: 'https://www.gs1ir.org/' },
  IT: { name: 'GS1 Italy', url: 'https://www.gs1it.org/' },
  JP: { name: 'GS1 Japan', url: 'https://www.gs1jp.org/' },
  KE: { name: 'GS1 Kenya', url: 'https://www.gs1kenya.org/' },
  KR: { name: 'GS1 Korea', url: 'https://www.gs1kr.org/' },
  MX: { name: 'GS1 Mexico', url: 'https://www.gs1mexico.org/' },
  MY: { name: 'GS1 Malaysia', url: 'https://www.gs1my.org/' },
  NG: { name: 'GS1 Nigeria', url: 'https://www.gs1-nigeria.org/' },
  PH: { name: 'GS1 Philippines', url: 'https://www.gs1ph.org/' },
  PK: { name: 'GS1 Pakistan', url: 'https://www.gs1pk.org/' },
  PT: { name: 'GS1 Portugal', url: 'https://www.gs1pt.org/' },
  RU: { name: 'GS1 Russia', url: 'https://www.gs1ru.org/' },
  TH: { name: 'GS1 Thailand', url: 'https://www.gs1thailand.org/' },
  TJ: { name: 'GS1 Tajikistan', url: 'https://www.gs1tj.org/' },
  TR: { name: 'GS1 Turkey', url: 'https://www.gs1tr.org/' },
  TW: { name: 'GS1 Taiwan', url: 'https://www.gs1tw.org/' },
  UA: { name: 'GS1 Ukraine', url: 'https://www.gs1ua.org/' },
  US: GS1_US_LINK,
  VE: { name: 'GS1 Venezuela', url: 'https://www.gs1ve.org/' },
  VN: { name: 'GS1 Vietnam', url: 'https://www.gs1vn.org.vn/' },
};

/**
 * Locale -> the country its reader is treated as living in.
 * Region variants speak for themselves (es-MX -> MX). Script
 * variants resolve by where that script is used (pa-Arab -> PK,
 * pa-Guru -> IN, zh-Hans -> CN, zh-Hant -> TW). Language-only
 * locales resolve to the language's home country. Puerto Rico
 * has no member organisation of its own — GS1 US serves it, so
 * es-PR resolves to the US. ET, BD and AF have no GS1 member
 * organisation; they resolve through to the global fallback.
 */
export const LOCALE_COUNTRY = {
  en: 'US',
  'en-AU': 'AU',
  'en-CA': 'CA',
  'en-GB': 'GB',
  'en-IN': 'IN',
  'es-CU': 'CU',
  'es-ES': 'ES',
  'es-MX': 'MX',
  'es-PR': 'US',
  'es-US': 'US',
  'es-VE': 'VE',
  'fr-CA': 'CA',
  'fr-FR': 'FR',
  'pt-BR': 'BR',
  'pt-PT': 'PT',
  'pa-Arab': 'PK',
  'pa-Guru': 'IN',
  'zh-Hans': 'CN',
  'zh-Hant': 'TW',
  am: 'ET',
  ar: 'EG',
  bho: 'IN',
  bn: 'BD',
  de: 'DE',
  fa: 'IR',
  gu: 'IN',
  ha: 'NG',
  hi: 'IN',
  id: 'ID',
  it: 'IT',
  ja: 'JP',
  jv: 'ID',
  kn: 'IN',
  ko: 'KR',
  mr: 'IN',
  ms: 'MY',
  pcm: 'NG',
  prs: 'AF',
  ru: 'RU',
  sw: 'KE',
  ta: 'IN',
  te: 'IN',
  tg: 'TJ',
  th: 'TH',
  tl: 'PH',
  tr: 'TR',
  uk: 'UA',
  ur: 'PK',
  vi: 'VN',
  wuu: 'CN',
  yo: 'NG',
  yue: 'HK',
};

/**
 * The links to show under the GS1 prefix field for a locale:
 * `{ country, own, us }` where `own` is `{ name, url, global }`
 * (name is null when global — the label is the translated
 * `settings.details.gs1GlobalSite` string) and `us` is the GS1
 * US link, or null when the reader's own country IS the US
 * (their one link already points there).
 */
export function gs1LinksForLocale(locale) {
  const country = LOCALE_COUNTRY[locale] || 'US';
  const member = GS1_BY_COUNTRY[country];
  const own = member
    ? { name: member.name, url: member.url, global: false }
    : { name: null, url: GS1_GLOBAL_URL, global: true };
  return { country, own, us: country === 'US' ? null : GS1_US_LINK };
}
