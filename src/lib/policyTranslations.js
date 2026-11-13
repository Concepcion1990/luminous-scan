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
import { STOCKHAVEN_TERMS_OF_SERVICE_AM } from './policies/terms.am.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_AM } from './policies/subscription.am.js';
import { STOCKHAVEN_PRIVACY_POLICY_AM } from './policies/privacy.am.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_AR } from './policies/terms.ar.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_AR } from './policies/subscription.ar.js';
import { STOCKHAVEN_PRIVACY_POLICY_AR } from './policies/privacy.ar.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_BN } from './policies/terms.bn.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_BN } from './policies/subscription.bn.js';
import { STOCKHAVEN_PRIVACY_POLICY_BN } from './policies/privacy.bn.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_BHO } from './policies/terms.bho.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_BHO } from './policies/subscription.bho.js';
import { STOCKHAVEN_PRIVACY_POLICY_BHO } from './policies/privacy.bho.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_ES_MX } from './policies/terms.es-MX.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_ES_MX } from './policies/subscription.es-MX.js';
import { STOCKHAVEN_PRIVACY_POLICY_ES_MX } from './policies/privacy.es-MX.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_ES_ES } from './policies/terms.es-ES.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_ES_ES } from './policies/subscription.es-ES.js';
import { STOCKHAVEN_PRIVACY_POLICY_ES_ES } from './policies/privacy.es-ES.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_ES_US } from './policies/terms.es-US.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_ES_US } from './policies/subscription.es-US.js';
import { STOCKHAVEN_PRIVACY_POLICY_ES_US } from './policies/privacy.es-US.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_ES_CU } from './policies/terms.es-CU.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_ES_CU } from './policies/subscription.es-CU.js';
import { STOCKHAVEN_PRIVACY_POLICY_ES_CU } from './policies/privacy.es-CU.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_ES_PR } from './policies/terms.es-PR.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_ES_PR } from './policies/subscription.es-PR.js';
import { STOCKHAVEN_PRIVACY_POLICY_ES_PR } from './policies/privacy.es-PR.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_ES_VE } from './policies/terms.es-VE.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_ES_VE } from './policies/subscription.es-VE.js';
import { STOCKHAVEN_PRIVACY_POLICY_ES_VE } from './policies/privacy.es-VE.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_FR_FR } from './policies/terms.fr-FR.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_FR_FR } from './policies/subscription.fr-FR.js';
import { STOCKHAVEN_PRIVACY_POLICY_FR_FR } from './policies/privacy.fr-FR.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_FR_CA } from './policies/terms.fr-CA.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_FR_CA } from './policies/subscription.fr-CA.js';
import { STOCKHAVEN_PRIVACY_POLICY_FR_CA } from './policies/privacy.fr-CA.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_PT_BR } from './policies/terms.pt-BR.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_PT_BR } from './policies/subscription.pt-BR.js';
import { STOCKHAVEN_PRIVACY_POLICY_PT_BR } from './policies/privacy.pt-BR.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_PT_PT } from './policies/terms.pt-PT.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_PT_PT } from './policies/subscription.pt-PT.js';
import { STOCKHAVEN_PRIVACY_POLICY_PT_PT } from './policies/privacy.pt-PT.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_ZH_HANS } from './policies/terms.zh-Hans.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_ZH_HANS } from './policies/subscription.zh-Hans.js';
import { STOCKHAVEN_PRIVACY_POLICY_ZH_HANS } from './policies/privacy.zh-Hans.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_ZH_HANT } from './policies/terms.zh-Hant.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_ZH_HANT } from './policies/subscription.zh-Hant.js';
import { STOCKHAVEN_PRIVACY_POLICY_ZH_HANT } from './policies/privacy.zh-Hant.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_YUE } from './policies/terms.yue.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_YUE } from './policies/subscription.yue.js';
import { STOCKHAVEN_PRIVACY_POLICY_YUE } from './policies/privacy.yue.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_WUU } from './policies/terms.wuu.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_WUU } from './policies/subscription.wuu.js';
import { STOCKHAVEN_PRIVACY_POLICY_WUU } from './policies/privacy.wuu.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_DE } from './policies/terms.de.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_DE } from './policies/subscription.de.js';
import { STOCKHAVEN_PRIVACY_POLICY_DE } from './policies/privacy.de.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_IT } from './policies/terms.it.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_IT } from './policies/subscription.it.js';
import { STOCKHAVEN_PRIVACY_POLICY_IT } from './policies/privacy.it.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_JA } from './policies/terms.ja.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_JA } from './policies/subscription.ja.js';
import { STOCKHAVEN_PRIVACY_POLICY_JA } from './policies/privacy.ja.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_KO } from './policies/terms.ko.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_KO } from './policies/subscription.ko.js';
import { STOCKHAVEN_PRIVACY_POLICY_KO } from './policies/privacy.ko.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_RU } from './policies/terms.ru.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_RU } from './policies/subscription.ru.js';
import { STOCKHAVEN_PRIVACY_POLICY_RU } from './policies/privacy.ru.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_UK } from './policies/terms.uk.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_UK } from './policies/subscription.uk.js';
import { STOCKHAVEN_PRIVACY_POLICY_UK } from './policies/privacy.uk.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_FA } from './policies/terms.fa.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_FA } from './policies/subscription.fa.js';
import { STOCKHAVEN_PRIVACY_POLICY_FA } from './policies/privacy.fa.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_PRS } from './policies/terms.prs.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_PRS } from './policies/subscription.prs.js';
import { STOCKHAVEN_PRIVACY_POLICY_PRS } from './policies/privacy.prs.js';
import { STOCKHAVEN_TERMS_OF_SERVICE_UR } from './policies/terms.ur.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY_UR } from './policies/subscription.ur.js';
import { STOCKHAVEN_PRIVACY_POLICY_UR } from './policies/privacy.ur.js';

export const POLICY_KINDS = Object.freeze(['terms', 'subscription', 'privacy']);

const ENGLISH_BODIES = {
  terms: STOCKHAVEN_TERMS_OF_SERVICE,
  subscription: STOCKHAVEN_SUBSCRIPTION_POLICY,
  privacy: STOCKHAVEN_PRIVACY_POLICY,
};

// kind -> { localeCode: translatedBody }. Translations land per
// locale in passes and register at import time (see the tranche
// registrations below the register function).
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

// --- Tranche 1 registrations (Nov 13, 2026) ----------------------
// Amharic (am), Arabic (ar), Bengali (bn), Bhojpuri (bho): full UI
// translation debt retired and all three policy bodies translated
// in the same pass.
registerPolicyTranslation('terms', 'am', STOCKHAVEN_TERMS_OF_SERVICE_AM);
registerPolicyTranslation('subscription', 'am', STOCKHAVEN_SUBSCRIPTION_POLICY_AM);
registerPolicyTranslation('privacy', 'am', STOCKHAVEN_PRIVACY_POLICY_AM);
registerPolicyTranslation('terms', 'ar', STOCKHAVEN_TERMS_OF_SERVICE_AR);
registerPolicyTranslation('subscription', 'ar', STOCKHAVEN_SUBSCRIPTION_POLICY_AR);
registerPolicyTranslation('privacy', 'ar', STOCKHAVEN_PRIVACY_POLICY_AR);
registerPolicyTranslation('terms', 'bn', STOCKHAVEN_TERMS_OF_SERVICE_BN);
registerPolicyTranslation('subscription', 'bn', STOCKHAVEN_SUBSCRIPTION_POLICY_BN);
registerPolicyTranslation('privacy', 'bn', STOCKHAVEN_PRIVACY_POLICY_BN);
registerPolicyTranslation('terms', 'bho', STOCKHAVEN_TERMS_OF_SERVICE_BHO);
registerPolicyTranslation('subscription', 'bho', STOCKHAVEN_SUBSCRIPTION_POLICY_BHO);
registerPolicyTranslation('privacy', 'bho', STOCKHAVEN_PRIVACY_POLICY_BHO);

// --- Tranche 2 registrations (Nov 13, 2026) ----------------------
// Spanish variants: Mexico (es-MX), Spain (es-ES), United States
// (es-US), Cuba (es-CU), Puerto Rico (es-PR), Venezuela (es-VE):
// full UI translation debt retired and all three policy bodies
// translated in the same pass.
registerPolicyTranslation('terms', 'es-MX', STOCKHAVEN_TERMS_OF_SERVICE_ES_MX);
registerPolicyTranslation('subscription', 'es-MX', STOCKHAVEN_SUBSCRIPTION_POLICY_ES_MX);
registerPolicyTranslation('privacy', 'es-MX', STOCKHAVEN_PRIVACY_POLICY_ES_MX);
registerPolicyTranslation('terms', 'es-ES', STOCKHAVEN_TERMS_OF_SERVICE_ES_ES);
registerPolicyTranslation('subscription', 'es-ES', STOCKHAVEN_SUBSCRIPTION_POLICY_ES_ES);
registerPolicyTranslation('privacy', 'es-ES', STOCKHAVEN_PRIVACY_POLICY_ES_ES);
registerPolicyTranslation('terms', 'es-US', STOCKHAVEN_TERMS_OF_SERVICE_ES_US);
registerPolicyTranslation('subscription', 'es-US', STOCKHAVEN_SUBSCRIPTION_POLICY_ES_US);
registerPolicyTranslation('privacy', 'es-US', STOCKHAVEN_PRIVACY_POLICY_ES_US);
registerPolicyTranslation('terms', 'es-CU', STOCKHAVEN_TERMS_OF_SERVICE_ES_CU);
registerPolicyTranslation('subscription', 'es-CU', STOCKHAVEN_SUBSCRIPTION_POLICY_ES_CU);
registerPolicyTranslation('privacy', 'es-CU', STOCKHAVEN_PRIVACY_POLICY_ES_CU);
registerPolicyTranslation('terms', 'es-PR', STOCKHAVEN_TERMS_OF_SERVICE_ES_PR);
registerPolicyTranslation('subscription', 'es-PR', STOCKHAVEN_SUBSCRIPTION_POLICY_ES_PR);
registerPolicyTranslation('privacy', 'es-PR', STOCKHAVEN_PRIVACY_POLICY_ES_PR);
registerPolicyTranslation('terms', 'es-VE', STOCKHAVEN_TERMS_OF_SERVICE_ES_VE);
registerPolicyTranslation('subscription', 'es-VE', STOCKHAVEN_SUBSCRIPTION_POLICY_ES_VE);
registerPolicyTranslation('privacy', 'es-VE', STOCKHAVEN_PRIVACY_POLICY_ES_VE);

// --- Tranche 3 registrations (Nov 13, 2026) ----------------------
// French (fr-FR, fr-CA) and Portuguese (pt-BR, pt-PT): full UI
// translation debt retired and all three policy bodies translated
// in the same pass.
registerPolicyTranslation('terms', 'fr-FR', STOCKHAVEN_TERMS_OF_SERVICE_FR_FR);
registerPolicyTranslation('subscription', 'fr-FR', STOCKHAVEN_SUBSCRIPTION_POLICY_FR_FR);
registerPolicyTranslation('privacy', 'fr-FR', STOCKHAVEN_PRIVACY_POLICY_FR_FR);
registerPolicyTranslation('terms', 'fr-CA', STOCKHAVEN_TERMS_OF_SERVICE_FR_CA);
registerPolicyTranslation('subscription', 'fr-CA', STOCKHAVEN_SUBSCRIPTION_POLICY_FR_CA);
registerPolicyTranslation('privacy', 'fr-CA', STOCKHAVEN_PRIVACY_POLICY_FR_CA);
registerPolicyTranslation('terms', 'pt-BR', STOCKHAVEN_TERMS_OF_SERVICE_PT_BR);
registerPolicyTranslation('subscription', 'pt-BR', STOCKHAVEN_SUBSCRIPTION_POLICY_PT_BR);
registerPolicyTranslation('privacy', 'pt-BR', STOCKHAVEN_PRIVACY_POLICY_PT_BR);
registerPolicyTranslation('terms', 'pt-PT', STOCKHAVEN_TERMS_OF_SERVICE_PT_PT);
registerPolicyTranslation('subscription', 'pt-PT', STOCKHAVEN_SUBSCRIPTION_POLICY_PT_PT);
registerPolicyTranslation('privacy', 'pt-PT', STOCKHAVEN_PRIVACY_POLICY_PT_PT);

// --- Tranche 4 registrations, part 1 (Nov 13, 2026) ---------------
// Chinese Simplified (zh-Hans) and Traditional (zh-Hant): full UI
// translation debt retired and all three policy bodies translated.
// Cantonese (yue) and Wu (wuu) follow in part 2 of this tranche.
registerPolicyTranslation('terms', 'zh-Hans', STOCKHAVEN_TERMS_OF_SERVICE_ZH_HANS);
registerPolicyTranslation('subscription', 'zh-Hans', STOCKHAVEN_SUBSCRIPTION_POLICY_ZH_HANS);
registerPolicyTranslation('privacy', 'zh-Hans', STOCKHAVEN_PRIVACY_POLICY_ZH_HANS);
registerPolicyTranslation('terms', 'zh-Hant', STOCKHAVEN_TERMS_OF_SERVICE_ZH_HANT);
registerPolicyTranslation('subscription', 'zh-Hant', STOCKHAVEN_SUBSCRIPTION_POLICY_ZH_HANT);
registerPolicyTranslation('privacy', 'zh-Hant', STOCKHAVEN_PRIVACY_POLICY_ZH_HANT);

// --- Tranche 4 registrations, part 2 (Nov 13, 2026) ---------------
// Cantonese (yue) and Wu (wuu): full UI translation debt retired
// and all three policy bodies translated. Tranche 4 is complete.
registerPolicyTranslation('terms', 'yue', STOCKHAVEN_TERMS_OF_SERVICE_YUE);
registerPolicyTranslation('subscription', 'yue', STOCKHAVEN_SUBSCRIPTION_POLICY_YUE);
registerPolicyTranslation('privacy', 'yue', STOCKHAVEN_PRIVACY_POLICY_YUE);
registerPolicyTranslation('terms', 'wuu', STOCKHAVEN_TERMS_OF_SERVICE_WUU);
registerPolicyTranslation('subscription', 'wuu', STOCKHAVEN_SUBSCRIPTION_POLICY_WUU);
registerPolicyTranslation('privacy', 'wuu', STOCKHAVEN_PRIVACY_POLICY_WUU);

// --- Tranche 5 registrations (Nov 13, 2026) ----------------------
// German (de), Italian (it), Japanese (ja): full UI translation
// debt retired and all three policy bodies translated.
registerPolicyTranslation('terms', 'de', STOCKHAVEN_TERMS_OF_SERVICE_DE);
registerPolicyTranslation('subscription', 'de', STOCKHAVEN_SUBSCRIPTION_POLICY_DE);
registerPolicyTranslation('privacy', 'de', STOCKHAVEN_PRIVACY_POLICY_DE);
registerPolicyTranslation('terms', 'it', STOCKHAVEN_TERMS_OF_SERVICE_IT);
registerPolicyTranslation('subscription', 'it', STOCKHAVEN_SUBSCRIPTION_POLICY_IT);
registerPolicyTranslation('privacy', 'it', STOCKHAVEN_PRIVACY_POLICY_IT);
registerPolicyTranslation('terms', 'ja', STOCKHAVEN_TERMS_OF_SERVICE_JA);
registerPolicyTranslation('subscription', 'ja', STOCKHAVEN_SUBSCRIPTION_POLICY_JA);
registerPolicyTranslation('privacy', 'ja', STOCKHAVEN_PRIVACY_POLICY_JA);

// --- Tranche 6 registrations (Nov 13, 2026) ---
// Korean (ko), Russian (ru), Ukrainian (uk): full UI translation debt retired and all three
// policy bodies translated in the same pass.
registerPolicyTranslation('terms', 'ko', STOCKHAVEN_TERMS_OF_SERVICE_KO);
registerPolicyTranslation('subscription', 'ko', STOCKHAVEN_SUBSCRIPTION_POLICY_KO);
registerPolicyTranslation('privacy', 'ko', STOCKHAVEN_PRIVACY_POLICY_KO);
registerPolicyTranslation('terms', 'ru', STOCKHAVEN_TERMS_OF_SERVICE_RU);
registerPolicyTranslation('subscription', 'ru', STOCKHAVEN_SUBSCRIPTION_POLICY_RU);
registerPolicyTranslation('privacy', 'ru', STOCKHAVEN_PRIVACY_POLICY_RU);
registerPolicyTranslation('terms', 'uk', STOCKHAVEN_TERMS_OF_SERVICE_UK);
registerPolicyTranslation('subscription', 'uk', STOCKHAVEN_SUBSCRIPTION_POLICY_UK);
registerPolicyTranslation('privacy', 'uk', STOCKHAVEN_PRIVACY_POLICY_UK);

// --- Tranche 7 registrations (Nov 13, 2026) ---
// Persian (fa), Dari (prs), Urdu (ur): full UI translation debt retired and all three
// policy bodies translated in the same pass.
registerPolicyTranslation('terms', 'fa', STOCKHAVEN_TERMS_OF_SERVICE_FA);
registerPolicyTranslation('subscription', 'fa', STOCKHAVEN_SUBSCRIPTION_POLICY_FA);
registerPolicyTranslation('privacy', 'fa', STOCKHAVEN_PRIVACY_POLICY_FA);
registerPolicyTranslation('terms', 'prs', STOCKHAVEN_TERMS_OF_SERVICE_PRS);
registerPolicyTranslation('subscription', 'prs', STOCKHAVEN_SUBSCRIPTION_POLICY_PRS);
registerPolicyTranslation('privacy', 'prs', STOCKHAVEN_PRIVACY_POLICY_PRS);
registerPolicyTranslation('terms', 'ur', STOCKHAVEN_TERMS_OF_SERVICE_UR);
registerPolicyTranslation('subscription', 'ur', STOCKHAVEN_SUBSCRIPTION_POLICY_UR);
registerPolicyTranslation('privacy', 'ur', STOCKHAVEN_PRIVACY_POLICY_UR);

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
