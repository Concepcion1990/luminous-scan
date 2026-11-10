import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import AppMark from '@/components/brand/AppMark';
import PlanOptionCard from '@/components/plans/PlanOptionCard';
import TrialCountdown from '@/components/plans/TrialCountdown';
import { Button } from '@/components/ui/button';
import { WELCOME_OPTIONS } from '@/lib/plans';
import { markWelcomeSeen } from '@/lib/welcome';

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
            Compare plans
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Welcome
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">
          Welcome to Luminous StockHaven
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          A home for everything your business carries.
        </p>

        <div className="mt-5 max-w-2xl space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Manage your inventory your way.</p>
          <p>
            Whether you need a simple mobile inventory companion or a complete inventory-management
            system for your growing business, Luminous StockHaven has options for you.
          </p>
          <p>Explore our available plans before starting your free trial.</p>
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
                    Available at mobile launch
                  </Button>
                ) : (
                  <Button variant="outline" className="w-full" asChild>
                    <Link to="/plans">See what's included</Link>
                  </Button>
                )
              }
            />
          ))}
        </div>

        <div className="mt-6">
          <Button asChild>
            <Link to="/plans" onClick={markWelcomeSeen}>
              Choose a subscription plan
            </Link>
          </Button>
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-secondary px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
          Opening this screen starts nothing. No trial begins and no card is charged — a seven-day
          trial starts only when you choose a plan and confirm it. Both website plans include the
          mobile companion, so you never pay the monthly mobile fee on top of them.
        </p>

        <p className="mt-6 text-xs text-muted-foreground">
          Already have a StockHaven account?{' '}
          <Link to="/login" className="underline underline-offset-2 hover:text-foreground">
            Sign in
          </Link>{' '}
          and your inventory is right where you left it.
        </p>
      </main>
    </div>
  );
}