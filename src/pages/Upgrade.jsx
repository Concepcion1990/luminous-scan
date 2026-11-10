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
import { base44 } from '@/api/client';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// T4: Stripe plan changes are live. Upgrade and downgrade run on the
// SAME Stripe subscription — never a second Checkout session. The
// dialog below fetches a real quote from the server (preview) and
// only then confirms. Upgrading during a trial carries the trial end
// explicitly, so the first Business charge lands at trial end.
// Downgrading is effective next cycle: Business until the paid
// period ends, then Essentials, no refund — and the dialog warns
// first, in plain words, about everything lost.
const DOWNGRADE_WARNING_ITEMS = [
  'Staff beyond 3 lose access — Essentials includes 3 additional staff.',
  'Extra businesses and stores (2, 3, 4, 5 — however many beyond the first) are no longer available.',
  'Export goes away — no CSV/Excel export, import only.',
  'The Bundles and Suppliers pages go away, along with the other Business-only pages.',
  'Inventory itself moves smoothly into Essentials — nothing you stocked is deleted.',
];

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
  const [planChangeOpen, setPlanChangeOpen] = useState(false);
  const [planChangeTarget, setPlanChangeTarget] = useState(null);
  const [planChangePhase, setPlanChangePhase] = useState('idle');
  const [planChangePreview, setPlanChangePreview] = useState(null);
  const [planChangeError, setPlanChangeError] = useState(null);
  const [planChangeResult, setPlanChangeResult] = useState(null);
  const [paymentUpdateBusy, setPaymentUpdateBusy] = useState(false);
  const [paymentUpdateError, setPaymentUpdateError] = useState(null);
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

  const openPlanChange = async (targetPlan) => {
    if (!activeId || !isOwner) return;
    setPlanChangeTarget(targetPlan);
    setPlanChangeOpen(true);
    setPlanChangePhase('loading');
    setPlanChangePreview(null);
    setPlanChangeError(null);
    setPlanChangeResult(null);
    try {
      const response = await base44.functions.invoke('preview-plan-change', {
        target_plan: targetPlan,
        business_id: activeId,
      });
      setPlanChangePreview(response?.data ?? null);
      setPlanChangePhase('preview');
    } catch (error) {
      setPlanChangeError(error?.message || 'The plan change could not be quoted. Nothing was changed.');
      setPlanChangePhase('error');
    }
  };

  const confirmPlanChange = async () => {
    if (planChangePhase !== 'preview' || !planChangeTarget || !activeId) return;
    setPlanChangePhase('confirming');
    setPlanChangeError(null);
    try {
      const response = await base44.functions.invoke('request-plan-upgrade', {
        target_plan: planChangeTarget,
        business_id: activeId,
      });
      setPlanChangeResult(response?.data ?? null);
      setPlanChangePhase('done');
      if (typeof refetch === 'function') refetch();
    } catch (error) {
      setPlanChangeError(error?.message || 'The plan change could not be completed. Nothing was changed.');
      setPlanChangePhase('error');
    }
  };

  const closePlanChange = (next) => {
    if (!next) {
      setPlanChangeOpen(false);
      setPlanChangeTarget(null);
      setPlanChangePhase('idle');
      setPlanChangePreview(null);
      setPlanChangeError(null);
      setPlanChangeResult(null);
    }
  };

  const updatePaymentMethod = async () => {
    if (paymentUpdateBusy || !activeId) return;
    setPaymentUpdateBusy(true);
    setPaymentUpdateError(null);
    try {
      const response = await base44.functions.invoke('update-payment-method', {
        business_id: activeId,
      });
      const url = response?.data?.url;
      if (!url) throw new Error('The payment update could not be started.');
      window.location.assign(url);
    } catch (error) {
      setPaymentUpdateError(error?.message || 'The payment update could not be started.');
      setPaymentUpdateBusy(false);
    }
  };

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
              Eligible new customers can receive one {TRIAL_DAYS}-day trial per account.</>
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
      </div>

      {status === 'past_due' && (
        <div role="status" className="space-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className="font-semibold">Payment past due</p>
          <p className="leading-relaxed text-muted-foreground">
            Your last payment did not go through, so this subscription is past due.
            Update your payment method below — Stripe will retry on its own schedule,
            and your subscription will not be canceled early. If you need help,
            email{' '}
            <a className="font-medium text-primary underline underline-offset-4" href="mailto:theluminousbookshop@outlook.com">
              theluminousbookshop@outlook.com
            </a>
            .
          </p>
          {paymentUpdateError && (
            <p role="alert" className="text-destructive">{paymentUpdateError}</p>
          )}
          <Button type="button" className="min-h-11" disabled={paymentUpdateBusy || !isOwner} onClick={updatePaymentMethod}>
            {paymentUpdateBusy ? 'Starting payment update…' : 'Update payment method'}
          </Button>
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
                    <Button className="w-full min-h-11" type="button" asChild>
                      <Link to={`/subscribe?plan=${entry.key}`}>Start Subscription</Link>
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Eligible new customers get one 7-day free trial — checked by the server before checkout.
                    </p>
                  </>
                ) : canUpgrade && isOwner ? (
                  <>
                    <Button
                      className="w-full min-h-11"
                      type="button"
                      onClick={() => void openPlanChange('business')}
                    >
                      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                      Upgrade to Business
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Same subscription, no second trial, no immediate charge — the price difference lands on your next invoice.
                      {status === 'trialing' && trialEndsOn ? ` Your trial continues until ${trialEndsOn}, then Business starts at $29.99/month.` : ''}
                    </p>
                  </>
                ) : current ? (
                  <Button className="w-full" variant="outline" disabled>
                    Current plan
                  </Button>
                ) : isCanceled && isOwner ? (
                  <>
                    <Button className="w-full min-h-11" type="button" asChild>
                      <Link to={`/subscribe?plan=${entry.key}`}>Subscribe again</Link>
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      This starts a new subscription — a returning email does
                      not get a second free trial.
                    </p>
                  </>
                ) : isDowngradeCard && isOwner ? (
                  <>
                    <Button
                      className="w-full min-h-11"
                      variant="outline"
                      type="button"
                      onClick={() => void openPlanChange('essentials')}
                    >
                      Downgrade to Essentials
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      Business continues until the end of your paid period, then Essentials starts at $14.99/month. No refund for downgrading.
                    </p>
                  </>
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

      <AlertDialog open={planChangeOpen} onOpenChange={closePlanChange}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {planChangeTarget === 'business' ? 'Upgrade to Business' : 'Downgrade to Essentials'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {planChangeTarget === 'business'
                ? 'Your trial and subscription stay on the same subscription — no second subscription, no new trial.'
                : 'Downgrading never deletes your data — but some of it becomes inaccessible. Read this first.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {planChangePhase === 'loading' ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Getting your quote…
            </p>
          ) : planChangePhase === 'done' && planChangeResult ? (
            <div role="status" className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
              <p className="font-semibold">
                {planChangeTarget === 'business' ? 'You are on Business now.' : 'Downgrade scheduled.'}
              </p>
              <p className="text-muted-foreground">
                {planChangeTarget === 'business' && planChangeResult.trial_ends_at
                  ? `Your trial continues until ${formatDate(planChangeResult.trial_ends_at)}, then Business starts at $29.99/month. Your first Business charge is on ${formatDate(planChangeResult.first_charge_at)}.`
                  : planChangeTarget === 'business'
                    ? `Business starts now at $29.99/month. The price difference lands on your next invoice — no immediate charge.`
                    : `You keep Business until ${formatDate(planChangeResult.effective_at)}, then Essentials starts at $14.99/month. No refund for downgrading.`}
              </p>
            </div>
          ) : planChangePhase === 'error' ? (
            <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
              <p className="font-semibold">The plan change was NOT completed.</p>
              <p className="text-muted-foreground">{planChangeError || 'Nothing was changed. Please try again.'}</p>
            </div>
          ) : planChangePreview ? (
            <div className="space-y-3 text-sm">
              {planChangeTarget === 'essentials' && (
                <ul className="list-disc space-y-2 pl-5 leading-relaxed">
                  {DOWNGRADE_WARNING_ITEMS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              <dl className="space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-3">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">From</dt>
                  <dd className="font-medium">{PLANS[planChangePreview.current_plan]?.name || planChangePreview.current_plan}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">To</dt>
                  <dd className="font-medium">{PLANS[planChangePreview.target_plan]?.name || planChangePreview.target_plan} — ${planChangePreview.target_price.toFixed(2)}/month</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Effective</dt>
                  <dd className="font-medium">{formatDate(planChangePreview.effective_at) || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">First charge at the new price</dt>
                  <dd className="font-medium">{formatDate(planChangePreview.first_charge_at) || '—'}</dd>
                </div>
                {planChangePreview.trial_ends_at && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Trial ends (unchanged)</dt>
                    <dd className="font-medium">{formatDate(planChangePreview.trial_ends_at)}</dd>
                  </div>
                )}
              </dl>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {planChangeTarget === 'business'
                  ? 'Upgrading never restarts your free trial, and it never creates a second subscription.'
                  : 'Downgrading is effective at the end of your paid period. Your lost-feature data is kept but inaccessible — it is never deleted as a side effect of downgrading.'}
              </p>
            </div>
          ) : null}

          <AlertDialogFooter>
            {planChangePhase === 'done' ? (
              <Button type="button" onClick={() => closePlanChange(false)}>Done</Button>
            ) : (
              <>
                <AlertDialogCancel disabled={planChangePhase === 'confirming' || planChangePhase === 'loading'}>
                  Keep my plan
                </AlertDialogCancel>
                {planChangePhase === 'preview' && (
                  <Button type="button" disabled={planChangePhase === 'confirming'} onClick={confirmPlanChange}>
                    {planChangePhase === 'confirming' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Confirming…
                      </>
                    ) : (
                      'Confirm plan change'
                    )}
                  </Button>
                )}
                {planChangePhase === 'error' && (
                  <Button type="button" onClick={() => closePlanChange(false)}>Close</Button>
                )}
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
