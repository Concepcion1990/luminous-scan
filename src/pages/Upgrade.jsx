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
import { t } from '@/lib/i18n';
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
  t('upgrade.downgradeWarning1'),
  t('upgrade.downgradeWarning2'),
  t('upgrade.downgradeWarning3'),
  t('upgrade.downgradeWarning4'),
  t('upgrade.downgradeWarning5'),
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
      setPlanChangeError(error?.message || t('upgrade.quoteFailed'));
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
      setPlanChangeError(error?.message || t('upgrade.confirmFailed'));
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
      if (!url) throw new Error(t('upgrade.paymentUpdateFailed'));
      window.location.assign(url);
    } catch (error) {
      setPaymentUpdateError(error?.message || t('upgrade.paymentUpdateFailed'));
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
        <Loader2 className="h-4 w-4 animate-spin" /> {t('plans.loadingPlan')}
      </div>
    );
  }

  // The policy effective dates come from the policy modules, never
  // hardcoded here, so this line cannot go stale when a policy bumps.
  const policyEffectiveLine =
    terms.effectiveDate === policy.effectiveDate
      ? t('plans.policyEffectiveBoth', { date: terms.effectiveDate })
      : t('plans.policyEffectiveSplit', { termsDate: terms.effectiveDate, policyDate: policy.effectiveDate });

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('upgrade.eyebrow')}</p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('upgrade.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {status === 'pending_checkout' ? (
            <>{t('upgrade.pendingCheckoutIntro', { days: TRIAL_DAYS })}</>
          ) : (
            <>{t('upgrade.intro', { days: TRIAL_DAYS })}{' '}
              <span className="font-medium text-foreground">{plan.name}</span>
              {status === 'grandfathered'
                ? t('upgrade.introGrandfathered')
                : status === 'trialing'
                  ? t('upgrade.introTrial')
                  : t('upgrade.introPeriod')}</>
          )}
        </p>
      </div>

      {status === 'past_due' && (
        <div role="status" className="space-y-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className="font-semibold">{t('upgrade.pastDueTitle')}</p>
          <p className="leading-relaxed text-muted-foreground">
            {t('upgrade.pastDueBody')}{' '}
            <a className="font-medium text-primary underline underline-offset-4" href="mailto:theluminousbookshop@outlook.com">
              theluminousbookshop@outlook.com
            </a>
            .
          </p>
          {paymentUpdateError && (
            <p role="alert" className="text-destructive">{paymentUpdateError}</p>
          )}
          <Button type="button" className="min-h-11" disabled={paymentUpdateBusy || !isOwner} onClick={updatePaymentMethod}>
            {paymentUpdateBusy ? t('upgrade.startingPaymentUpdate') : t('upgrade.updatePaymentMethod')}
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
                <span className="text-sm text-muted-foreground">{t('upgrade.perMonth')}</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('upgrade.taxNote')}
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
                      <Link to={`/subscribe?plan=${entry.key}`}>{t('upgrade.startSubscription')}</Link>
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {t('upgrade.trialCheckedNote')}
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
                      {t('upgrade.upgradeToBusiness')}
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {t('upgrade.upgradeNote')}
                      {status === 'trialing' && trialEndsOn ? ` ${t('upgrade.upgradeTrialNote', { date: trialEndsOn })}` : ''}
                    </p>
                  </>
                ) : current ? (
                  <Button className="w-full" variant="outline" disabled>
                    {t('plans.currentPlan')}
                  </Button>
                ) : isCanceled && isOwner ? (
                  <>
                    <Button className="w-full min-h-11" type="button" asChild>
                      <Link to={`/subscribe?plan=${entry.key}`}>{t('upgrade.subscribeAgain')}</Link>
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {t('upgrade.subscribeAgainNote')}
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
                      {t('upgrade.downgradeToEssentials')}
                    </Button>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {t('upgrade.downgradeNote')}
                    </p>
                  </>
                ) : isOwner ? (
                  <Button className="w-full min-h-11" variant="outline" disabled>
                    {t('upgrade.contactSupport')}
                  </Button>
                ) : (
                  <Button className="w-full" disabled>
                    {t('upgrade.signInAsOwner')}
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
                    {t('upgrade.cancelSubscription')}
                  </Button>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {status === 'trialing' && trialEndsOn ? (
                      <>{t('upgrade.cancelTrialNote', { date: trialEndsOn })}</>
                    ) : (
                      <>{t('upgrade.cancelNote')}</>
                    )}
                  </p>
                </div>
              )}
              {current && status === 'canceled' && cancelEndsOn && (
                <p role="status" className="mt-3 text-sm text-muted-foreground">
                  {t('upgrade.canceledEndsOn', { date: cancelEndsOn })}
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
              {planChangeTarget === 'business' ? t('upgrade.upgradeToBusiness') : t('upgrade.downgradeToEssentials')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {planChangeTarget === 'business'
                ? t('upgrade.dialogUpgradeDesc')
                : t('upgrade.dialogDowngradeDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {planChangePhase === 'loading' ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('upgrade.gettingQuote')}
            </p>
          ) : planChangePhase === 'done' && planChangeResult ? (
            <div role="status" className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
              <p className="font-semibold">
                {planChangeTarget === 'business' ? t('upgrade.doneUpgrade') : t('upgrade.doneDowngrade')}
              </p>
              <p className="text-muted-foreground">
                {planChangeTarget === 'business' && planChangeResult.trial_ends_at
                  ? t('upgrade.doneTrial', { trialEnds: formatDate(planChangeResult.trial_ends_at), firstCharge: formatDate(planChangeResult.first_charge_at) })
                  : planChangeTarget === 'business'
                    ? t('upgrade.doneUpgradeNow')
                    : t('upgrade.doneDowngradeBody', { date: formatDate(planChangeResult.effective_at) })}
              </p>
            </div>
          ) : planChangePhase === 'error' ? (
            <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
              <p className="font-semibold">{t('upgrade.planChangeNotCompleted')}</p>
              <p className="text-muted-foreground">{planChangeError || t('upgrade.planChangeFallback')}</p>
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
                  <dt className="text-muted-foreground">{t('upgrade.previewFrom')}</dt>
                  <dd className="font-medium">{PLANS[planChangePreview.current_plan]?.name || planChangePreview.current_plan}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('upgrade.previewTo')}</dt>
                  <dd className="font-medium">{t('upgrade.previewToValue', { name: PLANS[planChangePreview.target_plan]?.name || planChangePreview.target_plan, price: `$${planChangePreview.target_price.toFixed(2)}` })}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('upgrade.previewEffective')}</dt>
                  <dd className="font-medium">{formatDate(planChangePreview.effective_at) || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('upgrade.previewFirstCharge')}</dt>
                  <dd className="font-medium">{formatDate(planChangePreview.first_charge_at) || '—'}</dd>
                </div>
                {planChangePreview.trial_ends_at && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{t('upgrade.previewTrialEnds')}</dt>
                    <dd className="font-medium">{formatDate(planChangePreview.trial_ends_at)}</dd>
                  </div>
                )}
              </dl>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {planChangeTarget === 'business'
                  ? t('upgrade.previewUpgradeNote')
                  : t('upgrade.previewDowngradeNote')}
              </p>
            </div>
          ) : null}

          <AlertDialogFooter>
            {planChangePhase === 'done' ? (
              <Button type="button" onClick={() => closePlanChange(false)}>{t('upgrade.done')}</Button>
            ) : (
              <>
                <AlertDialogCancel disabled={planChangePhase === 'confirming' || planChangePhase === 'loading'}>
                  {t('upgrade.keepMyPlan')}
                </AlertDialogCancel>
                {planChangePhase === 'preview' && (
                  <Button type="button" disabled={planChangePhase === 'confirming'} onClick={confirmPlanChange}>
                    {planChangePhase === 'confirming' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {t('upgrade.confirming')}
                      </>
                    ) : (
                      t('upgrade.confirmPlanChange')
                    )}
                  </Button>
                )}
                {planChangePhase === 'error' && (
                  <Button type="button" onClick={() => closePlanChange(false)}>{t('upgrade.close')}</Button>
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
          {t('upgrade.reviewOur')}{' '}
          <Link to="/terms-of-service" className="font-semibold text-primary underline underline-offset-4">
            {t('upgrade.termsLink')}
          </Link>
          {t('upgrade.reviewJoin1')}{' '}
          <Link to="/subscription-policy" className="font-semibold text-primary underline underline-offset-4">
            {t('upgrade.policyLink')}
          </Link>
          {' '}{t('upgrade.reviewJoin2')}{' '}
          <Link to="/privacy-policy" className="font-semibold text-primary underline underline-offset-4">
            {t('upgrade.privacyLink')}
          </Link>
          {t('upgrade.reviewPeriod')} {policyEffectiveLine}
        </p>
        <p className="font-semibold text-foreground">{t('upgrade.upgradeNeverRestartsTrial')}</p>
        <p>
          {t('upgrade.trialHistoryNote')}
        </p>
        <p>
          {t('upgrade.providerConfirmNote')}
        </p>
        <p>
          {t('upgrade.chargedThroughProviderNote')}
        </p>
      </div>
    </div>
  );
}
