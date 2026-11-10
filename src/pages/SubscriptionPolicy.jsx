import { Link } from 'react-router-dom';
import { FileText, ArrowLeft, ShieldCheck } from 'lucide-react';
import AppMark from '@/components/brand/AppMark';
import LegalFooter from '@/components/LegalFooter';
import { STOCKHAVEN_SUBSCRIPTION_POLICY as policy } from '@/lib/stockhavenSubscriptionPolicy';

/**
 * Public, read-only policy. Accessible before account creation, signing
 * in, or paying. No Base44 or payment-provider request and no subscription action.
 */
export default function SubscriptionPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary px-4 py-4 text-primary-foreground sm:px-8">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <AppMark />
          <Link
            to="/plans"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-foreground/80 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            View plans
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <FileText className="h-4 w-4" aria-hidden="true" />
          Customer billing information
        </div>
        <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">
          {policy.title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {policy.application} · Operated by {policy.owner}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Effective {policy.effectiveDate} · Reviewed {policy.lastReviewed}
        </p>

        <aside role="note" className="mt-6 rounded-xl border border-border bg-secondary/50 p-4">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div className="space-y-2 text-sm leading-relaxed">
              <p className="font-semibold">Website subscriptions only</p>
              <p>{policy.scope}</p>
              <p className="text-muted-foreground">{policy.launchNotice}</p>
            </div>
          </div>
        </aside>

        <p className="my-6 text-sm leading-relaxed text-muted-foreground">
          {policy.introduction}
        </p>

        <div className="space-y-5">
          {policy.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={'policy-' + section.id}
              className="scroll-mt-6 rounded-xl border border-border bg-card p-4 sm:p-6"
            >
              <h2 id={'policy-' + section.id} className="text-base font-semibold sm:text-lg">
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

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link
            to="/terms-of-service"
            className="font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Terms of Service
          </Link>
          <Link
            to="/privacy-policy"
            className="font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Privacy Policy
          </Link>
          <Link
            to="/plans"
            className="font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Compare plans
          </Link>
          <Link
            to="/welcome"
            className="font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Back to welcome
          </Link>
        </div>

        <LegalFooter />
      </main>
    </div>
  );
}
