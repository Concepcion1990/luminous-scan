import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppMark from '@/components/brand/AppMark';
import LanguagePicker from '@/components/LanguagePicker';
import LegalFooter from '@/components/LegalFooter';
import SameEmailNotice from '@/components/SameEmailNotice';
import TrademarkNotice from '@/components/TrademarkNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { PLANS } from '@/lib/plans';
import { base44 } from '@/api/client';
import { t, useLocale } from '@/lib/i18n';

// T4: Stripe checkout is live on the twin. The trial and monthly
// buttons below call create-checkout on the server, which validates
// the plan, binds the workspace, checks the one-trial-per-email rule,
// creates the pending purchase, and returns Stripe's hosted checkout
// URL. No card details ever touch this page.
export default function Subscribe() {
  // Public page: re-render in the visitor's language when the picker
  // switches it (the header below carries the picker).
  useLocale();
  const [searchParams] = useSearchParams();
  const selected = searchParams.get('plan');
  // A missing or unknown ?plan= must never silently default to a plan —
  // a mistyped or stale link would subscribe the customer to Essentials
  // with no warning. Null means "no valid plan chosen yet".
  const planKey = selected === 'business' ? 'business'
    : selected === 'essentials' ? 'essentials' : null;
  const plan = planKey ? PLANS[planKey] : null;
  const returnTo = planKey ? `/subscribe?plan=${planKey}` : '/plans';
  const { isAuthenticated } = useAuth();
  const { status, record, isLoading, activeId } = useEntitlements();
  // The workspace this subscription will be connected to. A signed-in
  // customer with no business yet has no activeId — that used to show a dead
  // "Open workspace" link to "/", and "/" is behind SubscriptionAccessRoute,
  // which sends anyone without a paid/trial entitlement back to /plans, so
  // the customer looped Plans -> Subscribe -> Plans forever and could never
  // reach checkout. The workspace is therefore set up RIGHT HERE on this
  // page, and this page stays the checkout page: attaching a workspace does
  // not open the app and does not start a trial. Creating a first workspace
  // only writes a restricted "pending checkout" entitlement (see the
  // createBusiness function) — the full app stays locked until Stripe
  // confirms the trial or payment.
  const {
    businesses,
    isLoading: workspaceLoading,
    canCreate,
    switchTo,
    create: createBusiness,
  } = useBusiness();
  const [businessName, setBusinessName] = useState('');
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState(null);
  const [trialEligible, setTrialEligible] = useState(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);

  // The server decides whether this email gets a trial (one per email,
  // checked against TrialHistory and Stripe). Until it answers, both
  // buttons stay hidden — never show a trial that is not available.
  useEffect(() => {
    if (!isAuthenticated || !activeId) {
      setTrialEligible(null);
      return;
    }
    let mounted = true;
    base44.functions.invoke('check-trial-eligibility', { business_id: activeId })
      .then((response) => {
        if (mounted) setTrialEligible(response?.data?.trial_eligible === true);
      })
      .catch(() => {
        if (mounted) setTrialEligible(null);
      });
    return () => { mounted = false; };
  }, [isAuthenticated, activeId]);

  const startCheckout = async () => {
    if (checkoutBusy || !activeId || !planKey) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const response = await base44.functions.invoke('create-checkout', {
        plan: planKey,
        business_id: activeId,
      });
      const url = response?.data?.url;
      if (!url) throw new Error(t('subscribe.checkoutFailed'));
      window.location.assign(url);
    } catch (error) {
      setCheckoutError(error?.message || t('subscribe.checkoutFailed'));
      setCheckoutBusy(false);
    }
  };

  // Attach an existing workspace to this checkout, or create the customer's
  // first one. Either way the customer stays on /subscribe, where the trial
  // and monthly buttons will appear once subscriptions return. No navigation
  // to "/" happens here.
  const attachWorkspace = async (businessId) => {
    if (workspaceBusy) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage(null);
    try {
      await switchTo(businessId);
    } catch (error) {
      setWorkspaceMessage(error?.message || t('subscribe.openWorkspaceFailed'));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const setupWorkspace = async (event) => {
    event.preventDefault();
    const name = businessName.trim();
    if (workspaceBusy || !name) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage(null);
    try {
      await createBusiness({ name });
      setBusinessName('');
    } catch (error) {
      setWorkspaceMessage(error?.message || t('subscribe.setupWorkspaceFailed'));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const paidThrough = Date.parse(record?.period_ends_at || '');
  const hasExistingAccess =
    ['active', 'trialing', 'past_due'].includes(status) ||
    (status === 'canceled' && Number.isFinite(paidThrough) && paidThrough > Date.now());

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary px-4 py-4 text-primary-foreground sm:px-8">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <AppMark />
          <div className="flex items-center gap-3">
            <LanguagePicker tone="onPrimary" />
            <Link to="/plans" className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary-foreground/70 hover:text-primary-foreground">
              {t('subscribe.backToPlans')}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('subscribe.eyebrow')}</p>
        {!planKey ? (
          <>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{t('subscribe.invalidTitle')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('subscribe.invalidBody')}
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button asChild><Link to="/subscribe?plan=essentials">{t('subscribe.essentialsLink')}</Link></Button>
              <Button variant="outline" asChild><Link to="/subscribe?plan=business">{t('subscribe.businessLink')}</Link></Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              <Link to="/plans" className="font-medium text-primary underline underline-offset-4">{t('subscribe.comparePlans')}</Link>
            </p>
          </>
        ) : (
          <>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{t('subscribe.title', { planName: plan.name })}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('subscribe.pricePerMonth', { price: `$${plan.price.toFixed(2)}` })}
        </p>

        <SameEmailNotice className="mt-6" />

        <TrademarkNotice />

        {!isAuthenticated ? (
          <div className="mt-6 space-y-3 rounded-xl border border-border bg-card p-5">
            <p className="text-sm">{t('subscribe.createAccountFirst')}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild><Link to={`/register?returnTo=${encodeURIComponent(returnTo)}`}>{t('subscribe.createAccount')}</Link></Button>
              <Button variant="outline" asChild><Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>{t('subscribe.signIn')}</Link></Button>
            </div>
          </div>
        ) : isLoading || workspaceLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">{t('subscribe.loadingWorkspace')}</p>
        ) : hasExistingAccess ? (
          <div className="mt-6 rounded-xl border border-border bg-card p-5">
            {status === 'past_due' ? (
              <p className="text-sm">{t('subscribe.pastDue')}</p>
            ) : (
              <p className="text-sm">{t('subscribe.alreadyHasAccess')}</p>
            )}
            <Button className="mt-4" asChild><Link to="/upgrade">{t('subscribe.reviewPlanOptions')}</Link></Button>
          </div>
        ) : !activeId ? (
          <div className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-medium">{t('subscribe.openWorkspace')}</p>
            <p className="text-sm text-muted-foreground">
              {t('subscribe.chooseBusiness')}
            </p>
            {workspaceMessage && (
              <p role="alert" className="rounded-lg bg-secondary px-3 py-3 text-sm leading-relaxed">
                {workspaceMessage}
              </p>
            )}
            {businesses.length > 0 ? (
              <div className="space-y-2">
                {businesses.map((business) => (
                  <Button
                    key={business.id}
                    variant="outline"
                    className="w-full justify-start"
                    disabled={workspaceBusy}
                    onClick={() => void attachWorkspace(business.id)}
                  >
                    {workspaceBusy ? t('subscribe.opening') : t('subscribe.useWorkspace', { name: business.name || t('subscribe.thisWorkspace') })}
                  </Button>
                ))}
              </div>
            ) : canCreate ? (
              <form onSubmit={setupWorkspace} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="business-name">{t('subscribe.businessNameLabel')}</Label>
                  <Input
                    id="business-name"
                    type="text"
                    autoComplete="organization"
                    placeholder={t('subscribe.businessNamePlaceholder')}
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                    className="h-12"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={workspaceBusy || !businessName.trim()}>
                  {workspaceBusy ? t('subscribe.settingUp') : t('subscribe.setupWorkspace')}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('subscribe.noWorkspace')}
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('subscribe.noPaymentNote')}
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-medium">{t('subscribe.workspaceReady')}</p>
            {trialEligible === null ? (
              <p className="text-sm text-muted-foreground">{t('subscribe.checkingTrial')}</p>
            ) : trialEligible ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('subscribe.trialEligible', { price: `$${plan.price.toFixed(2)}` })}
                </p>
                <Button className="w-full min-h-11" type="button" disabled={checkoutBusy} onClick={startCheckout}>
                  {checkoutBusy ? t('subscribe.startingCheckout') : t('subscribe.startTrial', { planName: plan.name })}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('subscribe.noTrial', { price: `$${plan.price.toFixed(2)}` })}
                </p>
                <Button className="w-full min-h-11" type="button" disabled={checkoutBusy} onClick={startCheckout}>
                  {checkoutBusy ? t('subscribe.startingCheckout') : t('subscribe.subscribeButton', { planName: plan.name, price: `$${plan.price.toFixed(2)}` })}
                </Button>
              </>
            )}
            {checkoutError && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-3 text-sm leading-relaxed">
                {checkoutError}
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('subscribe.stripeNote')}
            </p>
          </div>
        )}

        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          {t('subscribe.noCardStored')}
        </p>
          </>
        )}

        <LegalFooter />
      </main>
    </div>
  );
}
