import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import AppMark from '@/components/brand/AppMark';
import LanguagePicker from '@/components/LanguagePicker';
import LegalFooter from '@/components/LegalFooter';
import TrademarkNotice from '@/components/TrademarkNotice';
import { t, useLocale } from '@/lib/i18n';
import { SOCIAL_LINKS } from '@/lib/socialLinks';
import instagramQr from '@/assets/social/instagram-qr.svg';
import facebookQr from '@/assets/social/facebook-qr.svg';
import threadsQr from '@/assets/social/threads-qr.svg';
import tiktokQr from '@/assets/social/tiktok-qr.svg';

const SOCIAL_QR = {
  instagram: instagramQr,
  facebook: facebookQr,
  threads: threadsQr,
  tiktok: tiktokQr,
};

/**
 * Public "Luminous StockHaven About" page — About the Founder, in her
 * own words. No calls to Base44 or payment providers. Accessible before
 * sign-up and before any subscription authorization, like the policy
 * pages.
 *
 * Nov 15, 2026 — her ruling: the founder story translates into all
 * 52 locales like everything else. The story renders from the locale
 * keys (about.founder.*); the English values are byte-identical to
 * the frozen module src/lib/aboutFounder.js, which stays the frozen
 * reference of her exact words — translations are renderings, never
 * edits. This page only lays the text out.
 */
const FOUNDER_PARAGRAPH_KEYS = [
  'about.founder.p1',
  'about.founder.p2',
  'about.founder.p3',
  'about.founder.p4',
];

export default function About() {
  useLocale();
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
          <BookOpen className="h-4 w-4" aria-hidden="true" /> {t('about.eyebrow')}
        </div>
        <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{t('about.pageTitle')}</h1>

        <section
          aria-labelledby="about-founder"
          className="mt-6 scroll-mt-6 rounded-xl border border-border bg-card p-4 sm:p-6"
        >
          <h2 id="about-founder" className="text-base font-semibold sm:text-lg">
            {t('about.founderHeading')}
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
            {FOUNDER_PARAGRAPH_KEYS.map((key) => (
              <p key={key}>{t(key)}</p>
            ))}
          </div>
        </section>

        {/* Her Nov 9, 2026 decision, placed Nov 15, 2026: the About
            page ties the app to the bookstore it comes from — the
            store name is a proper noun and stays as-is; the lead-in
            is translated (about.bookshopLeadIn). */}
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          {t('about.bookshopLeadIn')}{' '}
          <a
            href="https://theluminousbookshop.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-link underline underline-offset-4"
          >
            The Luminous Book Shop
          </a>
        </p>

        {/* Her Nov 16, 2026 request: the shop's four social pages,
            each with a QR code beside its link. Platform names and
            handles are proper nouns — they render as-is in every
            locale, so this section carries no translation keys. The
            QR artwork is generated SVG text (scripts/generate-social-qrs.mjs)
            pinned to these exact URLs by tests/t35/about-social-qr.test.js,
            which decodes every code with a real QR reader. */}
        <section className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-6">
          <ul className="grid gap-5 sm:grid-cols-2">
            {SOCIAL_LINKS.map((link) => (
              <li key={link.id} className="flex items-center gap-4">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <img
                    src={SOCIAL_QR[link.id]}
                    alt=""
                    aria-hidden="true"
                    className="h-20 w-20 rounded-md border border-border"
                  />
                </a>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{link.platform}</p>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-sm font-medium text-link underline underline-offset-4"
                  >
                    {link.handle}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* The owner's not-for-sale statement (restored Nov 15,
            2026 — her ruling: it should have already been here).
            Same component, same words as on Plans. */}
        <TrademarkNotice />

        <nav aria-label={t('legalNav.relatedInfo')} className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link to="/plans" className="font-medium text-link underline underline-offset-4">
            {t('legalNav.comparePlans')}
          </Link>
          <Link to="/terms-of-service" className="font-medium text-link underline underline-offset-4">
            {t('legalNav.terms')}
          </Link>
          <Link to="/subscription-policy" className="font-medium text-link underline underline-offset-4">
            {t('legalNav.subscription')}
          </Link>
          <Link to="/privacy-policy" className="font-medium text-link underline underline-offset-4">
            {t('legalNav.privacy')}
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
