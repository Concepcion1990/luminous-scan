import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/client';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Loader2, LogOut, Monitor, Moon, RefreshCw, Save, Sun, Trash2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { useAuth } from '@/lib/AuthContext';
import { isPublisherOwner } from '@/lib/publisherAccess';
import CancelSubscriptionDialog from '@/components/billing/CancelSubscriptionDialog';
import { CANCELLATION_GRACE_PARAGRAPH } from '@/lib/cancellationGrace';
import { STOCKHAVEN_SUBSCRIPTION_POLICY as policy } from '@/lib/stockhavenSubscriptionPolicy';
import { STOCKHAVEN_TERMS_OF_SERVICE as terms } from '@/lib/stockhavenTermsOfService';
import { resolveBusiness, saveBusiness } from '@/lib/business';
import BusinessListCard from '@/components/business/BusinessListCard';
import IdentityCard from '@/components/business/IdentityCard';
import DetailsCard from '@/components/business/DetailsCard';
import SoftwareCard from '@/components/business/SoftwareCard';
import PlanSummaryCard from '@/components/plans/PlanSummaryCard';
import EssentialsCheckoutReadinessDiagnostic from '@/components/billing/EssentialsCheckoutReadinessDiagnostic';
import UpgradeDryRunPanel from '@/components/billing/UpgradeDryRunPanel';
import SettingsCard from '@/components/business/SettingsCard';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';

const VERIFIED_STRIPE_STATUS_LABELS = {
  ACTIVE: 'Active',
  CANCELED: 'Canceled',
  CANCELLED: 'Canceled',
  EXPIRED: 'Expired',
  ENDED: 'Ended',
  PAUSED: 'Paused',
  PAST_DUE: 'Payment past due',
  TRIALING: 'Trialing',
  PENDING: 'Pending',
};

function verifiedDateLabel(dateValue) {
  if (typeof dateValue !== 'string') return '';
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

const APPEARANCE_OPTIONS = [
  { value: 'light', label: 'Light', description: 'White background and warm tan header.', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Almost-black background and warm tan header.', icon: Moon },
  { value: 'system', label: 'Automatic', description: 'Follow this device’s appearance setting.', icon: Monitor },
];

export default function Settings() {
  const { user, record, profile, isLoading, activeId } = useBusiness();
  const { plan, status: entitlementStatus, record: entitlementRecord, refetch: refetchEntitlement } = useEntitlements();
  const isOwner = Boolean(user?.id && record?.created_by_id === user.id);
  // The "Billing status" card is a working diagnostic for the
  // publisher only. Customers must never see it: every customer is the
  // owner of their own workspace, so workspace ownership alone does not
  // distinguish them — only the publisher identity does.
  const canShowBillingStatus = isOwner && isPublisherOwner(user, record);
  // Only the business owner can cancel its subscription, and only while
  // there is a live paid or trial subscription to cancel. The
  // complimentary (grandfathered) workspace is never cancellable.
  const canCancel = isOwner && ['active', 'trialing', 'past_due'].includes(entitlementStatus);
  const cancelEndsOn = (() => {
    if (entitlementStatus !== 'canceled' || !entitlementRecord?.period_ends_at) return null;
    const date = new Date(entitlementRecord.period_ends_at);
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;
  })();
  // Trial end comes from trial_ends_at, not period_ends_at: the trial-cancel
  // line must name the trial end date (finding 11).
  const trialEndsOn = (() => {
    if (entitlementStatus !== 'trialing' || !entitlementRecord?.trial_ends_at) return null;
    const date = new Date(entitlementRecord.trial_ends_at);
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : null;
  })();
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [themeReady, setThemeReady] = useState(false);

  // Keep the choice unselected until the saved device preference has loaded.
  useEffect(() => {
    setThemeReady(true);
  }, []);

  // Keep billing diagnostics available to the publisher in Base44 Builder Preview,
  // but never expose them in a customer-facing published build.
  const isBase44BuilderPreview = (() => {
    if (import.meta.env.DEV) return true;
    if (typeof window === 'undefined') return false;
    const { hostname, pathname, ancestorOrigins } = window.location;
    const builderAncestors = Array.from(ancestorOrigins || []);
    return (hostname === 'app.base44.com' && pathname.startsWith('/apps/')) ||
      builderAncestors.includes('https://app.base44.com');
  })();
  const canShowPrivateBillingDiagnostics = Boolean(
    user?.id && record?.created_by_id === user.id && isBase44BuilderPreview
  );
  const [values, setValues] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [formFor, setFormFor] = useState(null);
  const [syncedName, setSyncedName] = useState('');
  const [deletionStatus, setDeletionStatus] = useState(null);
  const [deletionLoading, setDeletionLoading] = useState(true);
  const [deletionStatusError, setDeletionStatusError] = useState('');
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [cancellationOpen, setCancellationOpen] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState({ state: 'loading', businessId: null });
  const [subscriptionStatusRefresh, setSubscriptionStatusRefresh] = useState(0);
  const [deletionConfirmation, setDeletionConfirmation] = useState('');
  const [deletionSubmitting, setDeletionSubmitting] = useState(false);
  const [deletionError, setDeletionError] = useState('');

  // A different business starts from its own saved values.
  useEffect(() => {
    if (isLoading) return;
    setValues((current) => (current && formFor === activeId ? current : { ...profile }));
    setFormFor(activeId);
  }, [isLoading, activeId, profile, formFor]);

  // A rename made elsewhere (the sidebar) follows the form unless it was edited here.
  useEffect(() => {
    if (!values || profile.name === syncedName) return;
    setValues((current) => (current.name === syncedName ? { ...current, name: profile.name } : current));
    setSyncedName(profile.name);
  }, [profile.name, syncedName, values]);

  // Each lookup is scoped to the selected owner-owned business on the server.
  // A failed/unverified lookup is NOT proof that billing has stopped.
  useEffect(() => {
    let mounted = true;
    setSubscriptionStatus({ state: 'loading', businessId: activeId });
    if (!activeId) {
      setSubscriptionStatus({ state: 'unavailable', businessId: activeId });
      return () => { mounted = false; };
    }

    const load = async () => {
      try {
        const response = await base44.functions.invoke('get-subscription-status', {
          business_id: activeId,
        });
        const result = response?.data;
        if (!mounted) return;
        if (
          result?.state === 'verified' &&
          result.provider === 'stripe' &&
          Object.hasOwn(VERIFIED_STRIPE_STATUS_LABELS, result.billing_status)
        ) {
          setSubscriptionStatus({ ...result, businessId: activeId });
        } else {
          setSubscriptionStatus({ state: 'unavailable', businessId: activeId });
        }
      } catch {
        if (mounted) {
          setSubscriptionStatus({ state: 'unavailable', businessId: activeId });
        }
      }
    };

    load();
    return () => { mounted = false; };
  }, [activeId, subscriptionStatusRefresh]);

  // The endpoint verifies auth and reads only the current user's request.
  // Account deletion itself is NOT performed by this Settings page.
  useEffect(() => {
    let mounted = true;

    const loadDeletionStatus = async () => {
      try {
        const response = await base44.functions.invoke('request-account-deletion', { action: 'status' });
        if (mounted) {
          setDeletionStatus(response.data ?? null);
          setDeletionStatusError('');
        }
      } catch {
        if (mounted) {
          setDeletionStatusError('Unable to check existing requests right now. You can still try submitting a request.');
        }
      } finally {
        if (mounted) setDeletionLoading(false);
      }
    };

    loadDeletionStatus();
    return () => { mounted = false; };
  }, []);

  const submitDeletionRequest = async () => {
    if (deletionSubmitting || deletionConfirmation !== 'DELETE') return;

    setDeletionSubmitting(true);
    setDeletionError('');
    try {
      const response = await base44.functions.invoke('request-account-deletion', {
        action: 'request',
        confirmation: 'DELETE',
      });
      const result = response.data;
      if (!result?.success || !['requested', 'under_review'].includes(result.status)) {
        throw new Error('We could not confirm your deletion request. Please try again.');
      }

      setDeletionStatus({
        pending: true,
        status: result.status,
        requested_at: result.requested_at,
      });
      setDeletionStatusError('');
      setDeletionConfirmation('');
      setDeletionOpen(false);
      toast({
        title: 'Account deletion request received',
        description: 'Your account and data have not been deleted.',
      });
    } catch (error) {
      setDeletionError(
        error?.response?.data?.error ||
        error?.message ||
        'Unable to submit your request. Please try again.'
      );
    } finally {
      setDeletionSubmitting(false);
    }
  };

  const uploadLogo = async (file) => {
    setError('');
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadPublicFile({ file });
      setValues((current) => ({ ...current, logo_url: file_url }));
    } catch {
      setError('Could not upload that image. Try a smaller PNG or JPG.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!values.name.trim()) {
      setError('Add your business name.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await saveBusiness(record, values);
      await queryClient.invalidateQueries({ queryKey: ['workspace'] });
      setSaved(true);
      toast({ title: 'Business settings saved' });
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err?.message || 'Could not save your settings.');
    } finally {
      setSaving(false);
    }
  };

  if (!values) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Business</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your shop's name, look, contact details and regional preferences.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => logout()}>
            <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Log out
          </Button>
          <Button onClick={save} disabled={saving || uploading}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="mr-1.5 h-4 w-4" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <BusinessListCard
        onRenamed={(businessId, name) => {
          if (businessId !== activeId) return;
          setValues((current) => (current ? { ...current, name } : current));
          setSyncedName(name);
        }}
      />

      <IdentityCard
        values={values}
        onChange={setValues}
        onLogoSelected={uploadLogo}
        uploading={uploading}
      />

      <DetailsCard values={values} onChange={setValues} />

      <PlanSummaryCard />

      {canShowPrivateBillingDiagnostics && (
        <EssentialsCheckoutReadinessDiagnostic businessId={activeId} />
      )}
      {canShowPrivateBillingDiagnostics && <UpgradeDryRunPanel />}

      <SettingsCard
        title="Subscription & Cancellation"
        description="Review your subscription cancellation terms before making changes to your account."
      >
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
          Review the{' '}
          <Link to="/terms-of-service" className="font-medium text-primary underline underline-offset-4">
            Luminous Stockhaven Terms of Service
          </Link>
          , the{' '}
          <Link to="/subscription-policy" className="font-medium text-primary underline underline-offset-4">
            Subscription, Cancellation &amp; Refund Policy
          </Link>
          {' '}and the{' '}
          <Link to="/privacy-policy" className="font-medium text-primary underline underline-offset-4">
            Privacy Policy
          </Link>
          . {policyEffectiveLine} Reading them makes no
          changes to your account or subscription.
        </p>
        <div className="space-y-3 text-sm text-foreground">
          {canShowBillingStatus && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-3" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Billing status</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 lg:min-h-0"
                disabled={!activeId || (subscriptionStatus.businessId === activeId && subscriptionStatus.state === 'loading')}
                onClick={() => setSubscriptionStatusRefresh((count) => count + 1)}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Refresh status
              </Button>
            </div>
            {subscriptionStatus.businessId !== activeId || subscriptionStatus.state === 'loading' ? (
              <p className="mt-2 text-sm text-muted-foreground">Checking Stripe subscription status…</p>
            ) : subscriptionStatus.state === 'verified' ? (
              <>
                <p className="mt-2 text-sm font-medium text-foreground">
                  Stripe reports: {VERIFIED_STRIPE_STATUS_LABELS[subscriptionStatus.billing_status]}
                </p>
                {verifiedDateLabel(subscriptionStatus.checked_at) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Verified {verifiedDateLabel(subscriptionStatus.checked_at)}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  This read-only result does not confirm a paid-through date or submit a cancellation request.
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm font-medium text-foreground">Live billing status unavailable</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  We could not verify a current Stripe subscription for this business. This does
                  not mean your subscription is canceled, inactive, or free of future charges.
                </p>
              </>
            )}
          </div>
          )}

          <h3 className="font-semibold">Cancellation Terms &amp; Conditions</h3>
          <p className="text-muted-foreground">
            These are the terms for paid Luminous Stockhaven subscriptions.
            Website subscription billing is switching to Stripe — new
            subscriptions and payment changes will be available once Stripe
            payments are live.
            You can cancel your subscription yourself at any time using the
            Cancel Subscription button below — no staff approval is needed.
            Cancellation and refund requests can also be handled through the
            official customer support contact, theluminousbookshop@outlook.com.
          </p>
          <ul className="list-disc space-y-2 pl-5 leading-relaxed">
            <li>
              <strong>Cancel without approval:</strong> You may cancel your subscription
              yourself at any time. No staff approval is required.
              Future renewals stop only after the billing provider confirms cancellation.
            </li>
            <li>
              <strong>Remaining access:</strong> If you have already paid for a billing period,
              you may retain access until that verified paid-through date. Earlier termination
              requires appropriate provider confirmation and any applicable refund handling.
              Free-trial access ends according to the provider-confirmed trial termination date.
            </li>
            <li>
              <strong>One free trial:</strong> The seven-day trial can be used only once per
              eligible customer. Canceling a trial or subscription does not grant another trial;
              returning customers must choose a paid subscription.
            </li>
            <li>
              <strong>Payment method and automatic renewal:</strong> For paid trials,
              the seven-day trial requires a payment method at signup. Unless canceled
              within the applicable trial cancellation deadline, the selected monthly plan
              will be charged automatically after the trial. The price, first billing date,
              and provider-specific cancellation deadline must be shown during signup.
              Trial billing will be through Stripe once Stripe payments are live.
            </li>
            <li>
              <strong>Google Play and Apple App Store subscriptions (if you ever subscribe through a store):</strong> If you ever subscribe
              through Google Play or the Apple App Store, your subscription
              is billed and managed by that store. You may need to cancel it directly in
              the subscriptions section of the same Google or Apple account used to subscribe.
              Canceling a separate website subscription, uninstalling this app, or requesting
              Luminous Stockhaven account deletion does not automatically cancel a store-billed
              subscription. Check your purchase receipt to confirm who bills you.
              <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <a href="https://support.google.com/googleplay/answer/7018481" target="_blank" rel="noopener noreferrer"
                   className="underline underline-offset-2 hover:text-foreground">
                  Google Play cancellation instructions
                </a>
                <a href="https://support.apple.com/en-us/118428" target="_blank" rel="noopener noreferrer"
                   className="underline underline-offset-2 hover:text-foreground">
                  Apple cancellation instructions
                </a>
              </span>
            </li>
            <li>
              <strong>After your paid period ends — 15-day grace, then deletion:</strong>{' '}
              {CANCELLATION_GRACE_PARAGRAPH}
            </li>
          </ul>
          {entitlementStatus === 'past_due' && (
            <div role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3">
              <h3 className="font-semibold">Payment past due — payment updates return with Stripe</h3>
              <p className="mt-1 text-muted-foreground">
                Your last payment did not go through. Payment updates will be available once Stripe payments are live.
                If you are unsure what to do, contact support
                at theluminousbookshop@outlook.com.
              </p>
            </div>
          )}
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Subscription cancellation and account deletion are separate decisions.
            No subscription will be canceled or account deleted by viewing these terms.
          </p>
          {canCancel && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => setCancellationOpen(true)}
            >
              <CreditCard className="h-4 w-4" aria-hidden="true" />
              Cancel Subscription
            </Button>
          )}
          {entitlementStatus === 'trialing' && trialEndsOn && (
            <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              Cancelling during your trial keeps your full 7 days — access ends on {trialEndsOn}, and you will not be charged.
            </p>
          )}
          {cancelEndsOn && (
            <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              This subscription is canceled and ends on {cancelEndsOn}. You keep full access until then.
            </p>
          )}
          <CancelSubscriptionDialog
            open={cancellationOpen}
            onOpenChange={setCancellationOpen}
            planLabel={plan?.name}
            status={entitlementStatus}
            periodEndsAt={entitlementRecord?.period_ends_at}
            trialEndsAt={entitlementRecord?.trial_ends_at}
            businessId={activeId}
            onCanceled={() => {
              refetchEntitlement();
              setSubscriptionStatusRefresh((count) => count + 1);
            }}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Appearance"
        description="Choose the look of Luminous Stockhaven on this device. Changes apply immediately across the app."
      >
        <fieldset disabled={!themeReady}>
          <legend className="sr-only">Choose an appearance</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {APPEARANCE_OPTIONS.map(({ value, label, description, icon: Icon }) => (
              <label
                key={value}
                className={[
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                  'focus-within:ring-2 focus-within:ring-ring',
                  themeReady && theme === value
                    ? 'border-ring bg-secondary'
                    : 'border-border hover:bg-muted',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="stockhaven-appearance"
                  value={value}
                  checked={themeReady && theme === value}
                  onChange={() => setTheme(value)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#B99B6A]"
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {label}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">
          Your selection is remembered in this browser or app. It does not change business records
          or require saving the form above.
        </p>
      </SettingsCard>

      <SettingsCard
        title="Delete Account"
        description="Request removal of your Luminous Stockhaven sign-in account."
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Submitting a request does not immediately delete your account, businesses, or inventory.
          Requests are reviewed separately before deletion can be completed. This request does
          not cancel a Stripe subscription or stop future billing; subscription cancellation must
          be handled separately through the billing provider.
        </p>

        {deletionStatus?.pending ? (
          <div role="status" className="rounded-lg border border-border bg-secondary px-4 py-3 text-sm">
            <p className="font-medium text-foreground">
              {deletionStatus.status === 'under_review'
                ? 'Your account deletion request is under review.'
                : 'Your account deletion request has been received.'}
            </p>
            <p className="mt-1 text-muted-foreground">
              Your account and data have not been deleted by this request. Billing has not been canceled.
            </p>
          </div>
        ) : (
          <>
            {deletionLoading && (
              <p role="status" className="text-xs text-muted-foreground">
                Checking for an existing deletion request…
              </p>
            )}
            {deletionStatusError && (
              <p role="status" className="text-xs text-muted-foreground">{deletionStatusError}</p>
            )}
            <AlertDialog
              open={deletionOpen}
              onOpenChange={(open) => {
                if (deletionSubmitting) return;
                setDeletionOpen(open);
                if (!open) {
                  setDeletionConfirmation('');
                  setDeletionError('');
                }
              }}
            >
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10"
                  disabled={deletionLoading}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Request Account Deletion
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
                <AlertDialogHeader>
                  <AlertDialogTitle>Request Account Deletion</AlertDialogTitle>
                  <AlertDialogDescription>
                    This requests a review of account deletion. It does not immediately remove
                    your login or inventory, and it does not cancel any Stripe subscription.
                    Type DELETE to confirm you want to submit the request.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2 py-2">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {plan?.key === 'business'
                      ? 'Export your inventory first if you need to keep your records.'
                      : 'Essentials has no export — write down anything you need before requesting deletion.'}
                  </p>
                  <label htmlFor="confirm-account-deletion" className="text-sm font-medium text-foreground">
                    Enter DELETE to confirm
                  </label>
                  <input
                    id="confirm-account-deletion"
                    type="text"
                    value={deletionConfirmation}
                    onChange={(event) => setDeletionConfirmation(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(deletionError)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={deletionSubmitting}
                  />
                  {deletionError && (
                    <p role="alert" className="text-sm text-destructive">{deletionError}</p>
                  )}
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deletionSubmitting}>Keep Account</AlertDialogCancel>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={deletionConfirmation !== 'DELETE' || deletionSubmitting}
                    onClick={submitDeletionRequest}
                  >
                    {deletionSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    {deletionSubmitting ? 'Submitting…' : 'Submit Deletion Request'}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SettingsCard>

      <SoftwareCard />

      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          These settings belong to this business only. Each business you own keeps its own products,
          locations, suppliers and purchase orders — use the business switcher to move between them.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setValues(resolveBusiness(record))}
        >
          Reset to saved values
        </Button>
      </div>
    </div>
  );
}