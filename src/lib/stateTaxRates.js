/**
 * The built-in US state base sales-tax table (owner rulings,
 * Nov 19, 2026; built in release 347).
 *
 * In Automatic tax mode, a new sales order fills its tax from
 * the CUSTOMER'S STATE base rate the moment the state is on the
 * order. These are STATE BASE RATES ONLY — the rate each state
 * itself levies, before any county/city/district tax. Local
 * taxes may add more; the app says so wherever the table is
 * offered. Hawaii's entry is its general excise tax rate and
 * New Mexico's its state gross receipts tax rate — the
 * state-level levies those states apply to sales.
 *
 * Source: Tax Foundation, "State and Local Sales Tax Rates,
 * Midyear 2026" (state rates in effect July 1, 2026), itself
 * compiled from the Sales Tax Clearinghouse and state revenue
 * department websites. Spot-verified against official state
 * sources on Nov 22, 2026: the New Mexico Taxation and Revenue
 * Department (state GRT 4.875%) and the South Dakota
 * Department of Revenue's Sales and Use Tax Guide, July 2026
 * (state rate 4.2% — a temporary cut scheduled to return to
 * 4.5% on July 1, 2027). Rates are stored at full statutory
 * precision (Missouri 4.225, Minnesota 6.875, New Jersey
 * 6.625, New Mexico 4.875) where the compilation rounds.
 *
 * One source of truth: the order form resolves through this
 * module, and tests/t44 pins all 51 entries.
 */
export const STATE_TAX_TABLE_SOURCE =
  'Tax Foundation, State and Local Sales Tax Rates, Midyear 2026 (rates in effect July 1, 2026)';
export const STATE_TAX_TABLE_AS_OF = '2026-07-01';

/** [code, name, state base rate percent] — alphabetical by name. */
const ROWS = [
  ['AL', 'Alabama', 4],
  ['AK', 'Alaska', 0],
  ['AZ', 'Arizona', 5.6],
  ['AR', 'Arkansas', 6.5],
  ['CA', 'California', 7.25],
  ['CO', 'Colorado', 2.9],
  ['CT', 'Connecticut', 6.35],
  ['DE', 'Delaware', 0],
  ['DC', 'District of Columbia', 6],
  ['FL', 'Florida', 6],
  ['GA', 'Georgia', 4],
  ['HI', 'Hawaii', 4],
  ['ID', 'Idaho', 6],
  ['IL', 'Illinois', 6.25],
  ['IN', 'Indiana', 7],
  ['IA', 'Iowa', 6],
  ['KS', 'Kansas', 6.5],
  ['KY', 'Kentucky', 6],
  ['LA', 'Louisiana', 5],
  ['ME', 'Maine', 5.5],
  ['MD', 'Maryland', 6],
  ['MA', 'Massachusetts', 6.25],
  ['MI', 'Michigan', 6],
  ['MN', 'Minnesota', 6.875],
  ['MS', 'Mississippi', 7],
  ['MO', 'Missouri', 4.225],
  ['MT', 'Montana', 0],
  ['NE', 'Nebraska', 5.5],
  ['NV', 'Nevada', 6.85],
  ['NH', 'New Hampshire', 0],
  ['NJ', 'New Jersey', 6.625],
  ['NM', 'New Mexico', 4.875],
  ['NY', 'New York', 4],
  ['NC', 'North Carolina', 4.75],
  ['ND', 'North Dakota', 5],
  ['OH', 'Ohio', 5.75],
  ['OK', 'Oklahoma', 4.5],
  ['OR', 'Oregon', 0],
  ['PA', 'Pennsylvania', 6],
  ['RI', 'Rhode Island', 7],
  ['SC', 'South Carolina', 6],
  ['SD', 'South Dakota', 4.2],
  ['TN', 'Tennessee', 7],
  ['TX', 'Texas', 6.25],
  ['UT', 'Utah', 6.1],
  ['VT', 'Vermont', 6],
  ['VA', 'Virginia', 5.3],
  ['WA', 'Washington', 6.5],
  ['WV', 'West Virginia', 6],
  ['WI', 'Wisconsin', 5],
  ['WY', 'Wyoming', 4],
];

export const US_STATE_TAX_RATES = ROWS.map(([code, name, rate]) => ({ code, name, rate }));

const BY_CODE = new Map(US_STATE_TAX_RATES.map((entry) => [entry.code, entry]));
const BY_NAME = new Map(US_STATE_TAX_RATES.map((entry) => [entry.name.toLowerCase(), entry]));

/** Country texts that mean the United States (blank = unstated).
 * Compared with periods stripped, so "U.S.A." and "USA" agree. */
const US_COUNTRY_ALIASES = new Set([
  '',
  'us',
  'usa',
  'united states',
  'united states of america',
  'america',
]);

function normalizePlace(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.+$/, '')
    .trim();
}

/**
 * The state table entry for an order's ship-to region + country,
 * or null when the order carries no resolvable US state.
 *
 * The region is the free text the order already carries: a
 * two-letter code ("NM", "nm") or a full state name ("New
 * Mexico") both resolve. A country that names somewhere other
 * than the US never resolves — those orders fall back to the
 * business's fixed rate, exactly as the owner ruled. A blank
 * country leaves the region to speak for itself.
 */
export function resolveStateTaxRate(region, country) {
  const countryKey = normalizePlace(country).toLowerCase().replace(/\./g, '');
  if (!US_COUNTRY_ALIASES.has(countryKey)) return null;
  const text = normalizePlace(region);
  if (!text) return null;
  if (/^[A-Za-z]{2}$/.test(text)) {
    return BY_CODE.get(text.toUpperCase()) || null;
  }
  return BY_NAME.get(text.toLowerCase()) || null;
}
