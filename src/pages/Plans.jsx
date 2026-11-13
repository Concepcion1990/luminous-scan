import { Link } from 'react-router-dom';
import { Check, LogOut, Minus } from 'lucide-react';
import AppMark from '@/components/brand/AppMark';
import LanguagePicker from '@/components/LanguagePicker';
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
import { t, useLocale } from '@/lib/i18n';

function Cell({ value }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-ok" aria-label={t('plans.included')} />;
  if (value === false) {
    return <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label={t('plans.notIncluded')} />;
  }
  return <span className="text-[11px] leading-snug text-muted-foreground sm:text-xs">{value}</span>;
}

/** Essentials against Business, with the mobile-only plan shown beside them. */
export default function Plans() {
  // Public page: re-render in the visitor's language when the picker
  // switches it (the header below carries the picker).
  useLocale();
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
      ? t('plans.policyEffectiveBoth', { date: terms.effectiveDate })
      : t('plans.policyEffectiveSplit', { termsDate: terms.effectiveDate, policyDate: policy.effectiveDate });

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary px-4 py-4 text-primary-foreground sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <AppMark />
          <div className="flex items-center gap-3">
            <LanguagePicker tone="onPrimary" />
            <Link
              to="/welcome"
              className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary-foreground/70 hover:text-primary-foreground"
            >
              {t('plans.backToWelcome')}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('plans.eyebrow')}
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{t('plans.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t('plans.intro')}
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
                    {t('plans.availableAtLaunch')}
                  </Button>
                ) : isCurrentPlan(option.key) ? (
                  <>
                    <p className="mb-2 text-center">
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
                        {t('plans.yourPlan')}
                      </span>
                    </p>
                    <Button className="w-full" variant="outline" disabled>
                      {t('plans.currentPlan')}
                    </Button>
                  </>
                ) : changeThroughUpgrade ? (
                  <Button className="w-full" asChild>
                    <Link to="/upgrade">{t('plans.changePlan')}</Link>
                  </Button>
                ) : (
                  <Button className="w-full" asChild>
                    <Link to={`/subscribe?plan=${option.key}`}>{t('plans.subscribe')}</Link>
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
                  {t('plans.featureHeader')}
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold">
                  Mobile
                  <span className="mt-0.5 block font-mono text-[10px] font-normal text-muted-foreground">
                    {formatPrice(MOBILE_PLAN.price)}{t('plans.perMonthShort')}
                  </span>
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold">
                  Essentials
                  <span className="mt-0.5 block font-mono text-[10px] font-normal text-muted-foreground">
                    {formatPrice(PLANS.essentials.price)}{t('plans.perMonthShort')}
                  </span>
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold">
                  Business
                  <span className="mt-0.5 block font-mono text-[10px] font-normal text-muted-foreground">
                    {formatPrice(PLANS.business.price)}{t('plans.perMonthShort')}
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
            {t('plans.mobileIncludedNote')}
          </p>
          <p>
            {t('plans.priceNote')}
          </p>
          <p>
            {t('plans.mobilePriceNote')}
          </p>
          <p>
            {t('plans.planChangeNote')}
          </p>
          <p>
            {t('plans.providerNote')}
          </p>
        </div>

        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          {t('plans.reviewBefore')}{' '}
          <Link to="/terms-of-service" className="font-medium text-primary underline underline-offset-4">
            {t('plans.termsLink')}
          </Link>
          {t('plans.reviewJoin1')}{' '}
          <Link to="/subscription-policy" className="font-medium text-primary underline underline-offset-4">
            {t('plans.policyLink')}
          </Link>{' '}
          {t('plans.reviewJoin2')}{' '}
          <Link to="/privacy-policy" className="font-medium text-primary underline underline-offset-4">
            {t('plans.privacyLink')}
          </Link>
          {t('plans.reviewPeriod')} {policyEffectiveLine}
        </p>

        <TrademarkNotice />

        <p className="mt-3 text-center text-sm">
          <Link to="/about" className="font-medium text-primary underline underline-offset-4">
            {t('auth.aboutLink')}
          </Link>
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {isAuthenticated ? (
            <Button variant="outline" onClick={() => logout()}>
              <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('plans.logOut')}
            </Button>
          ) : (
            <Button asChild>
              <Link to="/login">{t('plans.signInOrCreate')}</Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/welcome">{t('plans.backToWelcome')}</Link>
          </Button>
        </div>

        <LegalFooter />
      </main>
    </div>
  );
}