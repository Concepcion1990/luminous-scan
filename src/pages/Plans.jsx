import { Link } from 'react-router-dom';
import { Check, LogOut, Minus } from 'lucide-react';
import AppMark from '@/components/brand/AppMark';
import LegalFooter from '@/components/LegalFooter';
import TrademarkNotice from '@/components/TrademarkNotice';
import PlanOptionCard from '@/components/plans/PlanOptionCard';
import TrialCountdown from '@/components/plans/TrialCountdown';
import { Button } from '@/components/ui/button';
import { COMPARISON_ROWS, MOBILE_PLAN, PLANS, WELCOME_OPTIONS, formatPrice } from '@/lib/plans';
import { STOCKHAVEN_SUBSCRIPTION_POLICY as policy } from '@/lib/stockhavenSubscriptionPolicy';
import { STOCKHAVEN_TERMS_OF_SERVICE as terms } from '@/lib/stockhavenTermsOfService';
import { useAuth } from '@/lib/AuthContext';
import useEntitlements from '@/hooks/useEntitlements';

function Cell({ value }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-ok" aria-label="Included" />;
  if (value === false) {
    return <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label="Not included" />;
  }
  return <span className="text-[11px] leading-snug text-muted-foreground sm:text-xs">{value}</span>;
}

/** Essentials against Business, with the mobile-only plan shown beside them. */
export default function Plans() {
  const { isAuthenticated, logout } = useAuth();
  const { plan, status, isLoading } = useEntitlements();
  // A signed-in customer already holds a plan: show it, never offer them
  // a fresh Subscribe for the plan they already pay for (that would be a
  // duplicate subscription), and route any change through /upgrade.
  // pending_checkout means no subscription exists yet, so the Subscribe
  // links stay. While entitlements are still loading, the plan is
  // unknown — show the visitor links rather than a wrong "Current plan".
  const isCurrentPlan = (key) =>
    isAuthenticated && !isLoading && status !== 'pending_checkout' && plan.key === key;
  const changeThroughUpgrade = isAuthenticated && !isLoading && status !== 'pending_checkout';

  // The policy effective dates come from the policy modules, never
  // hardcoded here, so this line cannot go stale when a policy bumps.
  const policyEffectiveLine =
    terms.effectiveDate === policy.effectiveDate
      ? `The Terms of Service and the Subscription, Cancellation & Refund Policy are effective ${terms.effectiveDate}.`
      : `The Terms of Service is effective ${terms.effectiveDate}, and the Subscription, Cancellation & Refund Policy is effective ${policy.effectiveDate}.`;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary px-4 py-4 text-primary-foreground sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <AppMark />
          <Link
            to="/welcome"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary-foreground/70 hover:text-primary-foreground"
          >
            Back to welcome
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Plans &amp; features
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Compare Stockhaven plans</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          One account, whichever plan you choose — Business covers up to five businesses. Prices are monthly in US dollars,
          and eligible new website customers can receive one seven-day trial across Essentials
          and Business. Upgrading an existing Essentials subscription to Business does not
          restart the trial or create another free trial. Website plan prices are
          before applicable taxes, if any. Your exact charge will be shown before you
          authorize a subscription.
        </p>

        <div className="mt-5">
          <TrialCountdown />
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {WELCOME_OPTIONS.map((option) => (
            <PlanOptionCard
              key={option.key}
              option={option}
              highlight={option.key === 'business'}
              action={
                option.available === false ? (
                  <Button className="w-full" variant="outline" disabled>
                    Available at mobile launch
                  </Button>
                ) : isCurrentPlan(option.key) ? (
                  <>
                    <p className="mb-2 text-center">
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
                        Your plan
                      </span>
                    </p>
                    <Button className="w-full" variant="outline" disabled>
                      Current plan
                    </Button>
                  </>
                ) : changeThroughUpgrade ? (
                  <Button className="w-full" asChild>
                    <Link to="/upgrade">Change plan</Link>
                  </Button>
                ) : (
                  <Button className="w-full" asChild>
                    <Link to={`/subscribe?plan=${option.key}`}>Subscribe</Link>
                  </Button>
                )
              }
            />
          ))}
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-secondary/60">
                <th className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Feature
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold">
                  Mobile
                  <span className="mt-0.5 block font-mono text-[10px] font-normal text-muted-foreground">
                    {formatPrice(MOBILE_PLAN.price)}/mo
                  </span>
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold">
                  Essentials
                  <span className="mt-0.5 block font-mono text-[10px] font-normal text-muted-foreground">
                    {formatPrice(PLANS.essentials.price)}/mo
                  </span>
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold">
                  Business
                  <span className="mt-0.5 block font-mono text-[10px] font-normal text-muted-foreground">
                    {formatPrice(PLANS.business.price)}/mo
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.label} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 text-xs sm:text-sm">{row.label}</td>
                  <td className="px-3 py-2.5 text-center">
                    <Cell value={row.mobile} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <Cell value={row.essentials} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <Cell value={row.business} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Both website plans include the mobile companion, so a website subscriber never pays the
            monthly mobile fee as well.
          </p>
          <p>
            Essentials is $14.99/month plus applicable taxes, if any. Business is
            $29.99/month plus applicable taxes, if any. Any required tax is determined
            during provider checkout and must appear in the final total before payment.
            This comparison page is not a tax quote or payment authorization.
          </p>
          <p>
            The mobile-only plan is $4.99/month at its intended U.S. base price.
            The App Store or Google Play shows the actual local subscription price
            and any applicable taxes before purchase. Its product, site and staff
            allowances are set at launch, separately from the website tiers.
          </p>
          <p>
            A website plan change must be confirmed by the billing provider. The new price,
            effective date and any proration will be explained before the change is authorized.
            An upgrade should not create a second subscription.
          </p>
          <p>
            Prices, charges and trials are handled by the provider you subscribe through — the App
            Store, Google Play, the website or Shopify — never by this page.
          </p>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          Before subscribing, please review the{' '}
          <Link to="/terms-of-service" className="font-medium text-primary underline underline-offset-4">
            Luminous Stockhaven Terms of Service
          </Link>
          , the{' '}
          <Link to="/subscription-policy" className="font-medium text-primary underline underline-offset-4">
            Subscription, Cancellation &amp; Refund Policy
          </Link>{' '}
          and the{' '}
          <Link to="/privacy-policy" className="font-medium text-primary underline underline-offset-4">
            Privacy Policy
          </Link>
          . {policyEffectiveLine}
        </p>

        <TrademarkNotice />

        <p className="mt-3 text-center text-sm">
          <Link to="/about" className="font-medium text-primary underline underline-offset-4">
            About Luminous Stockhaven
          </Link>
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {isAuthenticated ? (
            <Button variant="outline" onClick={() => logout()}>
              <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Log out
            </Button>
          ) : (
            <Button asChild>
              <Link to="/login">Sign in or create an account</Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/welcome">Back to welcome</Link>
          </Button>
        </div>

        <LegalFooter />
      </main>
    </div>
  );
}