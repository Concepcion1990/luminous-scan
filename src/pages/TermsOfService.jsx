import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, ShieldCheck } from 'lucide-react';
import AppMark from '@/components/brand/AppMark';
import LanguagePicker from '@/components/LanguagePicker';
import LegalFooter from '@/components/LegalFooter';
import { getPolicyDocument } from '@/lib/policyTranslations';
import { t, useLocale } from '@/lib/i18n';

/**
 * Effective, public/read-only website Terms. No calls to Base44 or payment providers.
 * Accessible before sign-up and before any subscription authorization.
 * The body renders in the visitor's language WHEN a translation is
 * registered for it (src/lib/policyTranslations.js); otherwise the
 * English body — the official text — is shown, and a translated body
 * is introduced by the protective line (policies.translationNotice).
 */
export default function TermsOfService() {
  const locale = useLocale();
  const { document: terms, translated } = getPolicyDocument('terms', locale);
  // Cross-links name the other documents by their own titles, so
  // the links follow the same translation as the documents
  // themselves (page chrome localized Nov 15, 2026).
  const subscriptionDoc = getPolicyDocument('subscription', locale).document;
  const privacyDoc = getPolicyDocument('privacy', locale).document;
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary px-4 py-4 text-primary-foreground sm:px-8">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <AppMark />
          <div className="flex items-center gap-3">
            <LanguagePicker tone="onPrimary" />
            <Link
              to="/plans"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-foreground/80 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t('legalNav.viewPlans')}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <FileText className="h-4 w-4" aria-hidden="true" /> {t('policies.legalInfoEyebrow')}
        </div>
        <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{terms.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('policies.operatedBy', { application: terms.application, owner: terms.owner })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('policies.effectiveLine', { effective: terms.effectiveDate, reviewed: terms.lastReviewed })}
        </p>

        <aside role="note" className="mt-6 rounded-xl border border-border bg-secondary/50 p-4">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="space-y-2 text-sm leading-relaxed">
              <p className="font-semibold">{t('policies.termsAsideTitle')}</p>
              <p>{terms.scope}</p>
            </div>
          </div>
        </aside>

        {translated && (
          <aside role="note" className="mt-6 rounded-xl border border-border bg-secondary/50 p-4">
            <p className="text-sm leading-relaxed">{t('policies.translationNotice')}</p>
          </aside>
        )}

        <div className="mt-5 text-sm leading-relaxed text-muted-foreground">
          {t('policies.termsReviewBefore')}{' '}
          <Link to="/subscription-policy" className="font-medium text-link underline underline-offset-4">
            {subscriptionDoc.title}
          </Link>
          {' '}{t('policies.termsReviewMid')}{' '}
          <Link to="/privacy-policy" className="font-medium text-link underline underline-offset-4">
            {privacyDoc.title}
          </Link>
          {t('policies.termsReviewAfter')}
        </div>

        <div className="mt-6 space-y-5">
          {terms.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={'terms-' + section.id}
              className="scroll-mt-6 rounded-xl border border-border bg-card p-4 sm:p-6"
            >
              <h2 id={'terms-' + section.id} className="text-base font-semibold sm:text-lg">
                {section.title}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
                {section.paragraphs.map((paragraph, index) => (
                  <p key={section.id + '-' + index}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <nav aria-label={t('legalNav.relatedLegal')} className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link to="/subscription-policy" className="font-medium text-link underline underline-offset-4">
            {t('legalNav.subscription')}
          </Link>
          <Link to="/privacy-policy" className="font-medium text-link underline underline-offset-4">
            {t('legalNav.privacy')}
          </Link>
          <Link to="/plans" className="font-medium text-link underline underline-offset-4">
            {t('legalNav.comparePlans')}
          </Link>
          <Link to="/welcome" className="font-medium text-link underline underline-offset-4">
            {t('legalNav.backToWelcome')}
          </Link>
        </nav>

        <LegalFooter />
      </main>
    </div>
  );
}
