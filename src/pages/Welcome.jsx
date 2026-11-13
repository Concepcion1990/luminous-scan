import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import AppMark from '@/components/brand/AppMark';
import PlanOptionCard from '@/components/plans/PlanOptionCard';
import TrialCountdown from '@/components/plans/TrialCountdown';
import { Button } from '@/components/ui/button';
import { WELCOME_OPTIONS } from '@/lib/plans';
import { markWelcomeSeen } from '@/lib/welcome';
import { t } from '@/lib/i18n';

/**
 * First launch directs customers to compare plans before entering the app.
 * Opening this screen starts no trial and creates no subscription.
 */
export default function Welcome() {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary px-4 py-4 text-primary-foreground sm:px-8">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <AppMark />
          <Link
            to="/plans"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary-foreground/70 hover:text-primary-foreground"
          >
            {t('welcome.comparePlans')}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('welcome.eyebrow')}
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">
          {t('welcome.heading')}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          {t('auth.tagline')}
        </p>

        <div className="mt-5 max-w-2xl space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">{t('welcome.subheading')}</p>
          <p>
            {t('welcome.intro')}
          </p>
          <p>{t('welcome.explorePlans')}</p>
        </div>

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
                  <Button variant="outline" className="w-full" disabled>
                    {t('plans.availableAtLaunch')}
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full" asChild>
                    <Link to="/plans">{t('welcome.seeIncluded')}</Link>
                  </Button>
                )
              }
            />
          ))}
        </div>

        <div className="mt-6">
          <Button asChild>
            <Link to="/plans" onClick={markWelcomeSeen}>
              {t('welcome.choosePlan')}
            </Link>
          </Button>
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-secondary px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
          {t('welcome.noTrialNote')}
        </p>

        <p className="mt-6 text-xs text-muted-foreground">
          {t('welcome.alreadyHaveAccount')}{' '}
          <Link to="/login" className="underline underline-offset-2 hover:text-foreground">
            {t('welcome.signIn')}
          </Link>{' '}
          {t('welcome.inventoryWaiting')}
        </p>
      </main>
    </div>
  );
}