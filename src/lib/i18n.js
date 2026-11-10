/**
 * Translation framework — T6.
 *
 * One locale file per language (`src/lib/locales/<code>.js`), one
 * registry entry below, one `t()` helper. The UI stays English until
 * the owner picks the first translation language — strings already go
 * through the layer, so adding a language never touches a page.
 *
 * Rules (owner's): languages are added ONE AT A TIME, in ABC order
 * of the language list she approves. The first language has NOT been
 * picked yet — do not add one on a guess. See
 * src/lib/locales/README.md for the how-to.
 *
 * The language comes from the business record (`language` on the
 * business — Settings → Details). An unknown or missing code falls
 * back to English, never to a blank screen. A missing key returns
 * the key itself, so an unfinished translation degrades to a visible
 * key instead of crashing the page.
 */
import { en } from './locales/en.js';

/** code -> strings. Add one language at a time, ABC order. */
export const LOCALES = { en };

/** The locale codes the app can offer (ABC order). */
export const SUPPORTED_LOCALES = Object.keys(LOCALES).sort();

export const DEFAULT_LOCALE = 'en';

let currentLocale = DEFAULT_LOCALE;

/** Read the active locale code (default 'en'). */
export function getLocale() {
  return currentLocale;
}

/**
 * Set the active locale. Unknown codes fall back to English — the
 * setting is a preference, never a crash.
 */
export function setLocale(code) {
  currentLocale = LOCALES[code] ? code : DEFAULT_LOCALE;
  return currentLocale;
}

/** The strings for one locale code (English when unknown). */
export function getStrings(code = currentLocale) {
  return LOCALES[code] ?? LOCALES[DEFAULT_LOCALE];
}

/**
 * Translate a key, with `{name}` interpolation:
 *   t('scan.onlyOnHand', { count: 3, location: 'Aisle 1' })
 * Missing keys return the key itself; missing variables leave the
 * `{name}` placeholder in place so the gap is visible, not silent.
 */
export function t(key, vars = {}) {
  const strings = getStrings();
  let text = strings[key];
  if (typeof text !== 'string') {
    text = LOCALES[DEFAULT_LOCALE][key];
  }
  if (typeof text !== 'string') return key;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
  );
}

/** The plural-aware count suffix used by the sync indicator. */
export function pluralSuffix(count) {
  return count === 1 ? '' : 's';
}
