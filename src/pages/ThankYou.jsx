import { Link } from 'react-router-dom';
import { Clock3, ShieldCheck } from 'lucide-react';
import LegalFooter from '@/components/LegalFooter';

/**
 * The payment provider's return URL is exactly "/ThankYou" (see
 * App.jsx) — but while payments are switching to Stripe there is no
 * checkout to return from, so this page is a switching notice, not a
 * verification pass-through.
 *
 * It deliberately calls no backend function: no subscription can have
 * been created while subscriptions are paused, so there is nothing to
 * verify, and no customer is ever sent into the app from here. The
 * automatic recovery in src/lib/thankYouReconcileRetry.js is kept for
 * the Stripe rebuild, when a real checkout exists again — it is not
 * wired up here.
 */
export default function ThankYou() {
  return (
    <main className="flex min-h-screen flex-col px-6">
      <section className="m-auto max-w-md space-y-4 py-10 text-center">
        <div className="flex justify-center">
          <Clock3 className="h-9 w-9 text-primary" aria-hidden="true" />
        </div>
        <h1 className="text-3xl font-semibold">
          We&apos;re switching payments to Stripe — subscriptions will be back soon.
        </h1>
        <p className="text-muted-foreground">
          No subscription can be started right now, and nothing has been
          charged. If you were trying to subscribe, please check back once
          Stripe payments are live — your workspace and account are unchanged.
        </p>
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Your plan is determined by server-verified provider records.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/plans" className="inline-block rounded-md bg-primary px-5 py-2 text-primary-foreground">
            Back to plans
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          Do not start another checkout to try again — there is no checkout
          while subscriptions are paused.
        </p>
      </section>

      <LegalFooter />
    </main>
  );
}
