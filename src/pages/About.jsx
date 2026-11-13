import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import AppMark from '@/components/brand/AppMark';
import LanguagePicker from '@/components/LanguagePicker';
import LegalFooter from '@/components/LegalFooter';
import { ABOUT_FOUNDER as about } from '@/lib/aboutFounder';

/**
 * Public "Luminous StockHaven About" page — About the Founder, in her
 * own words. No calls to Base44 or payment providers. Accessible before
 * sign-up and before any subscription authorization, like the policy
 * pages. The text lives in src/lib/aboutFounder.js and is rendered
 * verbatim; this page only lays it out.
 */
export default function About() {
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
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> View plans
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <BookOpen className="h-4 w-4" aria-hidden="true" /> About Luminous StockHaven
        </div>
        <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{about.pageTitle}</h1>

        <section
          aria-labelledby="about-founder"
          className="mt-6 scroll-mt-6 rounded-xl border border-border bg-card p-4 sm:p-6"
        >
          <h2 id="about-founder" className="text-base font-semibold sm:text-lg">
            {about.sectionHeading}
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
            {about.paragraphs.map((paragraph, index) => (
              <p key={'about-founder-' + index}>{paragraph}</p>
            ))}
          </div>
        </section>

        <nav aria-label="Related information" className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link to="/plans" className="font-medium text-primary underline underline-offset-4">
            Compare plans
          </Link>
          <Link to="/terms-of-service" className="font-medium text-primary underline underline-offset-4">
            Terms of Service
          </Link>
          <Link to="/subscription-policy" className="font-medium text-primary underline underline-offset-4">
            Subscription and refunds
          </Link>
          <Link to="/privacy-policy" className="font-medium text-primary underline underline-offset-4">
            Privacy Policy
          </Link>
          <Link to="/welcome" className="font-medium text-primary underline underline-offset-4">
            Back to welcome
          </Link>
        </nav>

        <LegalFooter />
      </main>
    </div>
  );
}
