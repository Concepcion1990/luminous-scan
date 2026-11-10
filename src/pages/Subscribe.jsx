import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppMark from '@/components/brand/AppMark';
import LegalFooter from '@/components/LegalFooter';
import TrademarkNotice from '@/components/TrademarkNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/AuthContext';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { PLANS } from '@/lib/plans';
import { base44 } from '@/api/client';

// T4: Stripe checkout is live on the twin. The trial and monthly
// buttons below call create-checkout on the server, which validates
// the plan, binds the workspace, checks the one-trial-per-email rule,
// creates the pending purchase, and returns Stripe's hosted checkout
// URL. No card details ever touch this page.
export default function Subscribe() {
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
      if (!url) throw new Error('Checkout could not be started. Nothing was charged.');
      window.location.assign(url);
    } catch (error) {
      setCheckoutError(error?.message || 'Checkout could not be started. Nothing was charged.');
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
      setWorkspaceMessage(error?.message || 'That workspace could not be opened. Try again.');
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
      setWorkspaceMessage(error?.message || 'Your workspace could not be set up. Try again.');
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
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <AppMark />
          <Link to="/plans" className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary-foreground/70 hover:text-primary-foreground">
            Back to plans
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Subscription</p>
        {!planKey ? (
          <>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">That plan link isn&apos;t valid — choose a plan</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The link you followed does not name a plan we offer. Choose one below to continue — nothing has been subscribed.
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button asChild><Link to="/subscribe?plan=essentials">Essentials — $14.99/month</Link></Button>
              <Button variant="outline" asChild><Link to="/subscribe?plan=business">Business — $29.99/month</Link></Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              <Link to="/plans" className="font-medium text-primary underline underline-offset-4">Compare plans</Link>
            </p>
          </>
        ) : (
          <>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Subscribe to {plan.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          ${plan.price.toFixed(2)} per month, plus any applicable taxes.
        </p>

        <TrademarkNotice />

        {!isAuthenticated ? (
          <div className="mt-6 space-y-3 rounded-xl border border-border bg-card p-5">
            <p className="text-sm">First, create your account — with your email and a password. You will come straight back here to finish subscribing.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild><Link to={`/register?returnTo=${encodeURIComponent(returnTo)}`}>Create account</Link></Button>
              <Button variant="outline" asChild><Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link></Button>
            </div>
          </div>
        ) : isLoading || workspaceLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading your workspace…</p>
        ) : hasExistingAccess ? (
          <div className="mt-6 rounded-xl border border-border bg-card p-5">
            {status === 'past_due' ? (
              <p className="text-sm">Your payment is past due. You can update your payment method from the plan options page.</p>
            ) : (
              <p className="text-sm">This account already has subscription access. Plan changes must use the existing subscription flow.</p>
            )}
            <Button className="mt-4" asChild><Link to="/upgrade">Review plan options</Link></Button>
          </div>
        ) : !activeId ? (
          <div className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-medium">Open your workspace</p>
            <p className="text-sm text-muted-foreground">
              Choose the business this subscription will belong to. This only
              connects the subscription to your workspace — it does not open
              the app, start a trial, or charge anything.
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
                    {workspaceBusy ? 'Opening…' : `Use ${business.name || 'this workspace'}`}
                  </Button>
                ))}
              </div>
            ) : canCreate ? (
              <form onSubmit={setupWorkspace} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="business-name">Business name</Label>
                  <Input
                    id="business-name"
                    type="text"
                    autoComplete="organization"
                    placeholder="Your business"
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                    className="h-12"
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={workspaceBusy || !businessName.trim()}>
                  {workspaceBusy ? 'Setting up…' : 'Set up my workspace'}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                No workspace is available on this account yet. Contact Luminous StockHaven support for help.
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              No payment is being taken here, and no trial has started —
              choosing a workspace only connects the subscription to it.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-medium">Your workspace is ready.</p>
            {trialEligible === null ? (
              <p className="text-sm text-muted-foreground">Checking whether a free trial is available for your email…</p>
            ) : trialEligible ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Eligible new customers get one 7-day free trial. You will not be charged today —
                  your first payment of ${plan.price.toFixed(2)} is due when the trial ends, unless you cancel first.
                </p>
                <Button className="w-full min-h-11" type="button" disabled={checkoutBusy} onClick={startCheckout}>
                  {checkoutBusy ? 'Starting checkout…' : `Start 7-day free trial — ${plan.name}`}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  This email has subscribed before, so a new trial is not available — you will be charged ${plan.price.toFixed(2)} today.
                </p>
                <Button className="w-full min-h-11" type="button" disabled={checkoutBusy} onClick={startCheckout}>
                  {checkoutBusy ? 'Starting checkout…' : `Subscribe to ${plan.name} — $${plan.price.toFixed(2)}/month`}
                </Button>
              </>
            )}
            {checkoutError && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-3 text-sm leading-relaxed">
                {checkoutError}
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Checkout is handled securely by Stripe. You will see the exact total before you approve any charge.
            </p>
          </div>
        )}

        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          No card details are stored by Luminous StockHaven. Payments are processed by Stripe.
        </p>
          </>
        )}

        <LegalFooter />
      </main>
    </div>
  );
}
