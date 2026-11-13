/**
 * Translation framework — T6.
 *
 * One locale file per language (`src/lib/locales/<code>.js`), one
 * registry entry below, one `t()` helper. Arabic (ar) is the first
 * translated locale (T6.3) — the full app flows in it, RTL included.
 * Languages keep landing ONE AT A TIME, in ABC order of the list the
 * owner approves. See src/lib/locales/README.md for the how-to.
 *
 * The language comes from the business record (`language` on the
 * business — Settings → Details). An unknown or missing code falls
 * back to English, never to a blank screen. A missing key returns
 * the key itself, so an unfinished translation degrades to a visible
 * key instead of crashing the page.
 */
import { en } from './locales/en.js';
import { ar } from './locales/ar.js';
import { am } from './locales/am.js';
import { bn } from './locales/bn.js';
import { bho } from './locales/bho.js';
import { zhHans } from './locales/zh-Hans.js';
import { zhHant } from './locales/zh-Hant.js';
import { yue } from './locales/yue.js';
import { wuu } from './locales/wuu.js';
import { frCA } from './locales/fr-CA.js';
import { ms } from './locales/ms.js';
import { gu } from './locales/gu.js';
import { de } from './locales/de.js';
import { frFR } from './locales/fr-FR.js';
import { ha } from './locales/ha.js';
import { it } from './locales/it.js';
import { hi } from './locales/hi.js';
import { id } from './locales/id.js';
import { ja } from './locales/ja.js';
import { jv } from './locales/jv.js';
import { kn } from './locales/kn.js';
import { ko } from './locales/ko.js';
import { mr } from './locales/mr.js';
import { pcm } from './locales/pcm.js';
import { fa } from './locales/fa.js';
import { prs } from './locales/prs.js';
import { tg } from './locales/tg.js';

/** code -> strings. Add one language at a time, ABC order. */
export const LOCALES = { en, ar, am, bn, bho, 'zh-Hans': zhHans, 'zh-Hant': zhHant, yue, wuu, 'fr-CA': frCA, ms, gu, de, 'fr-FR': frFR, ha, it, hi, id, ja, jv, kn, ko, mr, pcm, fa, prs, tg };

/** Locale codes that read right-to-left (Arabic script family). */
export const RTL_LOCALES = new Set(['ar', 'fa', 'prs', 'tg', 'ur', 'pa-Arab']);

/** True when the locale reads right-to-left. */
export function isRTL(code = currentLocale) {
  return RTL_LOCALES.has(code);
}

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
  // T6.3: RTL locales flip the document direction so the whole layout
  // flows right-to-left (guarded — the node test env has no document).
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dir = isRTL(currentLocale) ? 'rtl' : 'ltr';
  }
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
