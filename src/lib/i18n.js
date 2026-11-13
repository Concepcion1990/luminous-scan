/**
 * Translation framework — T6.
 *
 * One locale file per language (`src/lib/locales/<code>.js`), one
 * registry entry below, one `t()` helper. Arabic (ar) is the first
 * translated locale (T6.3) — the full app flows in it, RTL included.
 * Languages keep landing ONE AT A TIME, in ABC order of the list the
 * owner approves. See src/lib/locales/README.md for the how-to.
 *
 * The language has two sources, in order: before sign-in it is the
 * visitor's own choice — the public LanguagePicker (landing, Plans,
 * Subscribe, Register, Login and the policy pages) — persisted in
 * localStorage (`stockhaven.locale`) so it survives navigation and
 * reloads, and carried into the business a registering visitor creates.
 * After sign-in the business record wins (`language` on the business —
 * Settings → Details), applied by Layout. An unknown or missing code
 * falls back to English, never to a blank screen. A missing key returns
 * the key itself, so an unfinished translation degrades to a visible
 * key instead of crashing the page.
 */
import { useSyncExternalStore } from 'react';
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
import { ptBR } from './locales/pt-BR.js';
import { ptPT } from './locales/pt-PT.js';
import { paGuru } from './locales/pa-Guru.js';
import { paArab } from './locales/pa-Arab.js';
import { ru } from './locales/ru.js';
import { esUS } from './locales/es-US.js';
import { esES } from './locales/es-ES.js';
import { esMX } from './locales/es-MX.js';
import { esCU } from './locales/es-CU.js';
import { esPR } from './locales/es-PR.js';
import { esVE } from './locales/es-VE.js';

/** code -> strings. Add one language at a time, ABC order. */
export const LOCALES = { en, ar, am, bn, bho, 'zh-Hans': zhHans, 'zh-Hant': zhHant, yue, wuu, 'fr-CA': frCA, ms, gu, de, 'fr-FR': frFR, ha, it, hi, id, ja, jv, kn, ko, mr, pcm, fa, prs, tg, 'pt-BR': ptBR, 'pt-PT': ptPT, 'pa-Guru': paGuru, 'pa-Arab': paArab, ru, 'es-US': esUS, 'es-ES': esES, 'es-MX': esMX, 'es-CU': esCU, 'es-PR': esPR, 'es-VE': esVE };

/** Locale codes that read right-to-left (Arabic script family).
 * Tajik ('tg') is NOT here: the app's Tajik text is Cyrillic and reads
 * left-to-right (removed Nov 12, 2026). */
export const RTL_LOCALES = new Set(['ar', 'fa', 'prs', 'ur', 'pa-Arab']);

/** True when the locale reads right-to-left. */
export function isRTL(code = currentLocale) {
  return RTL_LOCALES.has(code);
}

/** The locale codes the app can offer (ABC order). */
export const SUPPORTED_LOCALES = Object.keys(LOCALES).sort();

export const DEFAULT_LOCALE = 'en';

/**
 * The Settings label key naming each locale. The label VALUES are a
 * language's own name plus its English name in parentheses, identical
 * in every locale file by design (see locales/README.md) — so whichever
 * language is active, the picker and the Settings select always show
 * each language's own name for itself.
 */
export const LOCALE_LABEL_KEYS = {
  en: 'settings.details.english',
  ar: 'settings.details.arabic',
  am: 'settings.details.amharic',
  bn: 'settings.details.bengali',
  bho: 'settings.details.bhojpuri',
  'zh-Hans': 'settings.details.mandarinSimplified',
  'zh-Hant': 'settings.details.mandarinTraditional',
  yue: 'settings.details.cantonese',
  wuu: 'settings.details.shanghainese',
  'fr-CA': 'settings.details.frenchCanadian',
  'fr-FR': 'settings.details.french',
  ms: 'settings.details.malay',
  gu: 'settings.details.gujarati',
  de: 'settings.details.german',
  ha: 'settings.details.hausa',
  it: 'settings.details.italian',
  hi: 'settings.details.hindi',
  id: 'settings.details.indonesian',
  ja: 'settings.details.japanese',
  jv: 'settings.details.javanese',
  kn: 'settings.details.kannada',
  ko: 'settings.details.korean',
  mr: 'settings.details.marathi',
  pcm: 'settings.details.nigerianPidgin',
  fa: 'settings.details.persian',
  prs: 'settings.details.dari',
  tg: 'settings.details.tajik',
  'pt-BR': 'settings.details.portugueseBrazil',
  'pt-PT': 'settings.details.portuguesePortugal',
  'pa-Guru': 'settings.details.punjabiGurmukhi',
  'pa-Arab': 'settings.details.punjabiShahmukhi',
  ru: 'settings.details.russian',
  'es-US': 'settings.details.spanishUS',
  'es-ES': 'settings.details.spanishSpain',
  'es-MX': 'settings.details.spanishMexico',
  'es-CU': 'settings.details.spanishCuba',
  'es-PR': 'settings.details.spanishPuertoRico',
  'es-VE': 'settings.details.spanishVenezuela',
};

/** localStorage key holding the visitor's chosen locale (public picker). */
export const LOCALE_STORAGE_KEY = 'stockhaven.locale';

let currentLocale = DEFAULT_LOCALE;

/** Read the active locale code (default 'en'). */
export function getLocale() {
  return currentLocale;
}

function readStoredLocale() {
  try {
    const value = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return LOCALES[value] ? value : null;
  } catch {
    return null;
  }
}

function storeLocale(code) {
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, code);
  } catch {
    // Private mode or blocked storage: the choice still applies for
    // the rest of the session, it just is not remembered.
  }
}

// React subscription so a page re-renders the moment the locale changes
// (the picker's "applies immediately"): setLocale notifies, useLocale
// subscribes. Non-React callers (Layout's business-language effect)
// keep working exactly as before.
const localeListeners = new Set();

export function subscribeLocale(listener) {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

function notifyLocaleChanged() {
  for (const listener of [...localeListeners]) listener();
}

/** React hook: the active locale, re-rendering on every change. */
export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/**
 * Set the active locale. Unknown codes fall back to English — the
 * setting is a preference, never a crash. The choice is persisted to
 * localStorage so a visitor's language survives navigation and
 * reloads, and subscribers (useLocale) re-render immediately.
 */
export function setLocale(code) {
  currentLocale = LOCALES[code] ? code : DEFAULT_LOCALE;
  storeLocale(currentLocale);
  // T6.3: RTL locales flip the document direction so the whole layout
  // flows right-to-left (guarded — the node test env has no document).
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dir = isRTL(currentLocale) ? 'rtl' : 'ltr';
  }
  notifyLocaleChanged();
  return currentLocale;
}

/**
 * Apply the visitor's stored locale at app start (main.jsx). No stored
 * choice (or a code the registry no longer holds) leaves English.
 */
export function initLocale() {
  const stored = readStoredLocale();
  if (stored && stored !== currentLocale) setLocale(stored);
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

/** A locale's display label (its own name + English gloss) for pickers. */
export function localeLabel(code) {
  return t(LOCALE_LABEL_KEYS[code] ?? LOCALE_LABEL_KEYS[DEFAULT_LOCALE]);
}
