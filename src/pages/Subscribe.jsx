import { useState } from 'react';
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

// Payments are switching to Stripe: no checkout is offered on this page
// while the switch is under way. The workspace setup below still works —
// attaching a workspace here does not open the app, start a trial, or
// charge anything — so a customer can be ready the moment subscriptions
// return. There is deliberately no call to create-checkout here: that
// function is a fail-closed stub until the Stripe build lands.
const PAYMENTS_SWITCHING_NOTICE =
  "We're switching payments to Stripe — subscriptions will be back soon.";

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
              <p className="text-sm">Your payment is past due. Payment updates will return once Stripe payments are live — for help, email theluminousbookshop@outlook.com. The plan options page explains more.</p>
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
                No workspace is available on this account yet. Contact Luminous Stockhaven support for help.
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {PAYMENTS_SWITCHING_NOTICE} No payment is being taken here, and
              no trial has started.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-medium">{PAYMENTS_SWITCHING_NOTICE}</p>
            <p className="text-sm text-muted-foreground">
              Your workspace is ready. When subscriptions return, eligible new
              customers get one 7-day free trial per account, checked by the
              server before checkout. A monthly subscription starts paid
              billing immediately and does not include a trial. No payment is
              being taken while subscriptions are paused.
            </p>
          </div>
        )}

        <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
          No card details are stored by Luminous Stockhaven. No payment is being taken while subscriptions are paused for the switch to Stripe.
        </p>
          </>
        )}

        <LegalFooter />
      </main>
    </div>
  );
}
