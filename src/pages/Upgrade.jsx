import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, Loader2 } from 'lucide-react';
import useEntitlements from '@/hooks/useEntitlements';
import { useBusiness } from '@/hooks/useBusiness';
import { PLANS, TRIAL_DAYS } from '@/lib/plans';
import { STOCKHAVEN_SUBSCRIPTION_POLICY as policy } from '@/lib/stockhavenSubscriptionPolicy';
import { STOCKHAVEN_TERMS_OF_SERVICE as terms } from '@/lib/stockhavenTermsOfService';
import { Button } from '@/components/ui/button';
import EssentialsCheckoutReadinessDiagnostic from '@/components/billing/EssentialsCheckoutReadinessDiagnostic';
import UpgradeDryRunPanel from '@/components/billing/UpgradeDryRunPanel';
import CancelSubscriptionDialog from '@/components/billing/CancelSubscriptionDialog';

// Payments are switching to Stripe: no checkout, upgrade, or resubscribe
// action is offered on this page while the switch is under way. There is
// deliberately no call to create-checkout, upgrade-to-business, or
// apply-upgrade-plan-flip here — the first is a fail-closed stub and the
// other two were deleted with the retired draft flow. The upgrade button is
// disabled with a plain explanation, and the resubscribe buttons are
// disabled the same way, so no second simultaneous subscription can ever
// be started from this page (the audit-fix trap closure stays).
const PAYMENTS_SWITCHING_NOTICE =
  "We're switching payments to Stripe — subscriptions will be back soon.";
const UPGRADE_UNAVAILABLE =
  'Upgrades will be available once Stripe payments are live.';

function money(value) {
  return `$${value.toFixed(2)}`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
}

export default function Upgrade() {
  const { plan, status, record, isLoading, activeId, refetch } = useEntitlements();
  const { user, record: businessRecord } = useBusiness();
  const [cancellationOpen, setCancellationOpen] = useState(false);
  // Only the business owner can cancel its subscription, and only while
  // there is a live paid or trial subscription to cancel. The
  // complimentary (grandfathered) workspace is never cancellable.
  const cancelEndsOn = (() => {
    if (status !== 'canceled' || !record?.period_ends_at) return null;
    const date = new Date(record.period_ends_at);
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;
  })();
  // The trial end date, kept separate from the upgrade effective date:
  // the two are not the same thing and must never be shown as one date.
  // Falls back to period_ends_at only when the record carries no
  // trial_ends_at (a trial's paid-through date is its trial end).
  const trialEndsOn = (() => {
    const value = record?.trial_ends_at || record?.period_ends_at;
    return value ? formatDate(value) : null;
  })();
  // This is a UI courtesy only: the backend verifies ownership independently.
  const isOwner = Boolean(user?.id && businessRecord?.created_by_id === user.id);

  // Keep these private billing diagnostics available in the owner's Base44
  // builder preview/local development, but out of published customer builds.
  const isBase44BuilderPreview = (() => {
    if (import.meta.env.DEV) return true;
    if (typeof window === 'undefined') return false;
    const { hostname, pathname, ancestorOrigins } = window.location;
    const builderAncestors = Array.from(ancestorOrigins || []);
    return (hostname === 'app.base44.com' && pathname.startsWith('/apps/')) ||
      builderAncestors.includes('https://app.base44.com');
  })();
  const canShowPrivateBillingDiagnostics = isOwner && isBase44BuilderPreview;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your plan…
      </div>
    );
  }

  // The policy effective dates come from the policy modules, never
  // hardcoded here, so this line cannot go stale when a policy bumps.
  const policyEffectiveLine =
    terms.effectiveDate === policy.effectiveDate
      ? `The Terms of Service and the Subscription, Cancellation & Refund Policy are effective ${terms.effectiveDate}.`
      : `The Terms of Service is effective ${terms.effectiveDate}, and the Subscription, Cancellation & Refund Policy is effective ${policy.effectiveDate}.`;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Plans</p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Choose what fits your shop</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {status === 'pending_checkout' ? (
            <>This new workspace is limited to Essentials until you choose a subscription.
              Eligible new customers can receive one {TRIAL_DAYS}-day trial per account.
              Subscription checkout is being finalized. No trial has started and no charge has been made.</>
          ) : (
            <>Eligible new customers can receive one {TRIAL_DAYS}-day trial per account,
              not one trial per plan. Changing from Essentials to Business never starts
              another free trial. You are on{' '}
              <span className="font-medium text-foreground">{plan.name}</span>
              {status === 'grandfathered'
                ? ' — a full Business workspace, at no charge.'
                : status === 'trialing'
                  ? ' (trial).'
                  : '.'}</>
          )}
        </p>
        <p role="status" className="mt-3 max-w-2xl rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          {PAYMENTS_SWITCHING_NOTICE}
        </p>
      </div>

      {status === 'past_due' && (
        <div role="status" className="space-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className="font-semibold">Payment past due — payment updates return with Stripe</p>
          <p className="leading-relaxed text-muted-foreground">
            Your last payment did not go through, so this subscription is past due.
            Payment updates will be available once Stripe payments are live. If you need help,
            email{' '}
            <a className="font-medium text-primary underline underline-offset-4" href="mailto:theluminousbookshop@outlook.com">
              theluminousbookshop@outlook.com
            </a>
            .
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {Object.values(PLANS).map((entry) => {
          const awaitingSubscription = status === 'pending_checkout';
          const current = !awaitingSubscription && entry.key === plan.key;
          // A fresh checkout is only ever a first checkout
          // (pending_checkout) or a resubscribe after a cancellation.
          // A customer who already holds a subscription must never be
          // offered a fresh checkout for another plan — that would be a
          // second simultaneous subscription, not a plan change.
          const isCanceled = status === 'canceled';
          const canUpgrade = entry.key === 'business' && plan.key === 'essentials' &&
            ['active', 'trialing', 'past_due'].includes(status);
          const isDowngradeCard = entry.key === 'essentials' && plan.key === 'business';
          return (
            <div
              key={entry.key}
              className={`flex flex-col rounded-xl border bg-card p-5 ${
                current ? 'border-primary ring-1 ring-primary/20' : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">{entry.name}</h2>
                {current && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-primary">
                    Your plan
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{entry.blurb}</p>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="numeric text-3xl font-semibold">{money(entry.price)}</span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Plus applicable taxes, if any. The provider must show your exact total before you approve a charge.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {entry.includes.map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 pt-1">
                {awaitingSubscription && isOwner ? (
                  <>
                    <Button className="w-full min-h-11" type="button" disabled>
                      Start Subscription
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {PAYMENTS_SWITCHING_NOTICE}
                    </p>
                  </>
                ) : canUpgrade && isOwner ? (
                  <>
                    <Button
                      className="w-full min-h-11"
                      type="button"
                      disabled
                    >
                      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                      Upgrade to Business
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {UPGRADE_UNAVAILABLE}
                    </p>
                  </>
                ) : current ? (
                  <Button className="w-full" variant="outline" disabled>
                    Current plan
                  </Button>
                ) : isCanceled && isOwner ? (
                  <>
                    <Button className="w-full min-h-11" type="button" disabled>
                      Subscribe again
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {PAYMENTS_SWITCHING_NOTICE} This starts a new subscription — a returning email does
                      not get a second free trial.
                    </p>
                  </>
                ) : isDowngradeCard ? (
                  <Button className="w-full min-h-11" variant="outline" disabled>
                    Downgrade not available yet — contact support
                  </Button>
                ) : isOwner ? (
                  <Button className="w-full min-h-11" variant="outline" disabled>
                    Contact support to change your plan
                  </Button>
                ) : (
                  <Button className="w-full" disabled>
                    Sign in as business owner
                  </Button>
                )}
              </div>
              {current && isOwner && ['active', 'trialing', 'past_due'].includes(status) && (
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full min-h-11 border-destructive text-destructive hover:bg-destructive/10"
                    onClick={() => setCancellationOpen(true)}
                  >
                    Cancel Subscription
                  </Button>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {status === 'trialing' && trialEndsOn ? (
                      <>Cancelling during your trial keeps your full 7 days — access ends on {trialEndsOn}, and you will not be charged.</>
                    ) : (
                      <>Cancels at the end of your paid period — you keep full access until then.</>
                    )}
                  </p>
                </div>
              )}
              {current && status === 'canceled' && cancelEndsOn && (
                <p role="status" className="mt-3 text-sm text-muted-foreground">
                  This subscription is canceled and ends on {cancelEndsOn}. You keep full access until then.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <CancelSubscriptionDialog
        open={cancellationOpen}
        onOpenChange={setCancellationOpen}
        planLabel={plan?.name}
        status={status}
        periodEndsAt={record?.period_ends_at}
        trialEndsAt={record?.trial_ends_at || record?.period_ends_at}
        businessId={activeId}
        onCanceled={() => { if (typeof refetch === 'function') refetch(); }}
      />

      {canShowPrivateBillingDiagnostics && (
        <>
          <EssentialsCheckoutReadinessDiagnostic businessId={activeId} />
          <UpgradeDryRunPanel />
        </>
      )}

      <div className="space-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <p>
          Review our{' '}
          <Link to="/terms-of-service" className="font-semibold text-primary underline underline-offset-4">
            Terms of Service
          </Link>
          ,{' '}
          <Link to="/subscription-policy" className="font-semibold text-primary underline underline-offset-4">
            Subscription, Cancellation &amp; Refund Policy
          </Link>
          {' '}and our{' '}
          <Link to="/privacy-policy" className="font-semibold text-primary underline underline-offset-4">
            Privacy Policy
          </Link>
          . {policyEffectiveLine}
        </p>
        <p className="font-semibold text-foreground">Upgrading never restarts your free trial.</p>
        <p>
          If you are paying for Essentials and move to Business, you keep the same
          customer account and trial history. Business does not include an extra
          seven-day trial. If you upgrade while your original trial is still running,
          its original end date does not reset.
        </p>
        <p>
          Plan changes require confirmation from the billing provider. Any price
          difference, proration, and effective date must be shown before you approve
          the change. An upgrade must not create a second simultaneous subscription.
        </p>
        <p>
          Plan changes are charged through the billing provider. You can cancel
          your subscription from this page using the Cancel Subscription button
          under your current plan, or from Settings. Canceling stops future
          renewals at the end of your paid period; it never ends your access at
          once. Existing complimentary workspaces are not charged by viewing
          these options.
        </p>
      </div>
    </div>
  );
}
