/**
 * Policy bodies by locale — the translation registry (Picker build).
 *
 * The three legal documents (Terms of Service, Subscription Policy,
 * Privacy Policy) live as English modules — the base text and the
 * OFFICIAL text. The owner decided (Nov 12) that they also get
 * translated into every locale so customers can truly read what they
 * agree to; translations roll out per locale in later passes, one
 * language at a time, and register here. Until a locale's translation
 * lands, the pages render the English body — a clean fallback, never
 * a half-translated document and never a blank page.
 *
 * A later pass adds a translated body by importing it in this file and
 * registering it:
 *
 *   import { STOCKHAVEN_TERMS_OF_SERVICE_FR } from './policies/terms.fr-FR.js';
 *   registerPolicyTranslation('terms', 'fr-FR', STOCKHAVEN_TERMS_OF_SERVICE_FR);
 *
 * A translation body carries the same shape as its English module
 * (title + sections at minimum); any field it omits (owner, dates,
 * scope...) is filled from the English document at read time, so a
 * translation can never silently drop the legal furniture. When a
 * translated body is shown, the page prints the protective line
 * (the `policies.translationNotice` i18n key) above it: the English
 * version is the official one.
 */
import { STOCKHAVEN_TERMS_OF_SERVICE } from './stockhavenTermsOfService.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY } from './stockhavenSubscriptionPolicy.js';
import { STOCKHAVEN_PRIVACY_POLICY } from './stockhavenPrivacyPolicy.js';

export const POLICY_KINDS = Object.freeze(['terms', 'subscription', 'privacy']);

const ENGLISH_BODIES = {
  terms: STOCKHAVEN_TERMS_OF_SERVICE,
  subscription: STOCKHAVEN_SUBSCRIPTION_POLICY,
  privacy: STOCKHAVEN_PRIVACY_POLICY,
};

// kind -> { localeCode: translatedBody }. Empty today — translations
// land per locale in later passes and register at import time.
const translatedBodies = { terms: {}, subscription: {}, privacy: {} };

/**
 * Register one locale's translated body for one document. Rejects
 * unknown kinds, English (the base is never "registered"), and bodies
 * without the minimum shape (a string title and a sections array), so
 * a malformed translation can never reach a page.
 */
export function registerPolicyTranslation(kind, locale, body) {
  if (!POLICY_KINDS.includes(kind)) return false;
  if (!locale || locale === 'en') return false;
  if (!body || typeof body.title !== 'string' || !Array.isArray(body.sections)) return false;
  translatedBodies[kind][locale] = body;
  return true;
}

/** True when a translated body exists for this document + locale. */
export function hasPolicyTranslation(kind, locale) {
  if (!POLICY_KINDS.includes(kind) || !locale || locale === 'en') return false;
  return Boolean(translatedBodies[kind][locale]);
}

/**
 * The document a policy page should render for a locale: the
 * registered translation (merged over the English document, so any
 * field the translation omits falls back to the official text) with
 * `translated: true`, or the English document itself with
 * `translated: false`. The page shows the protective line only when
 * `translated` is true.
 */
export function getPolicyDocument(kind, locale) {
  const english = ENGLISH_BODIES[kind];
  if (!english) return { document: null, translated: false };
  if (hasPolicyTranslation(kind, locale)) {
    return { document: { ...english, ...translatedBodies[kind][locale] }, translated: true };
  }
  return { document: english, translated: false };
}
