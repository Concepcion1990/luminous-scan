import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44, apiRequest } from '@/api/client';
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
import { applyBrandColor } from '@/lib/brandTheme';
import BusinessListCard from '@/components/business/BusinessListCard';
import IdentityCard from '@/components/business/IdentityCard';
import DetailsCard from '@/components/business/DetailsCard';
import SoftwareCard from '@/components/business/SoftwareCard';
import PlanSummaryCard from '@/components/plans/PlanSummaryCard';
import SecurityCard from '@/components/business/SecurityCard';
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
import { t, deleteConfirmWord, matchesDeleteConfirm } from '@/lib/i18n';

const VERIFIED_STRIPE_STATUS_LABELS = {
  ACTIVE: 'settings.billingStatus.active',
  CANCELED: 'settings.billingStatus.canceled',
  CANCELLED: 'settings.billingStatus.canceled',
  EXPIRED: 'settings.billingStatus.expired',
  ENDED: 'settings.billingStatus.ended',
  PAUSED: 'settings.billingStatus.paused',
  PAST_DUE: 'settings.billingStatus.pastDue',
  TRIALING: 'settings.billingStatus.trialing',
  PENDING: 'settings.billingStatus.pending',
};

function verifiedDateLabel(dateValue) {
  if (typeof dateValue !== 'string') return '';
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

const APPEARANCE_OPTIONS = [
  { value: 'light', labelKey: 'settings.appearance.light', descriptionKey: 'settings.appearance.lightDesc', icon: Sun },
  { value: 'dark', labelKey: 'settings.appearance.dark', descriptionKey: 'settings.appearance.darkDesc', icon: Moon },
  { value: 'system', labelKey: 'settings.appearance.automatic', descriptionKey: 'settings.appearance.automaticDesc', icon: Monitor },
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
          setDeletionStatusError(t('settings.deletion.checkError'));
        }
      } finally {
        if (mounted) setDeletionLoading(false);
      }
    };

    loadDeletionStatus();
    return () => { mounted = false; };
  }, []);

  // The Delete Account confirmation word is the CURRENT language's own
  // word (settings.deleteConfirmWord): DELETE in English, ELIMINAR in
  // Spanish, SUPPRIMER in French… The prompts below show it and the
  // typed text is matched against it — never the literal 'DELETE'
  // outside English.
  const confirmWord = deleteConfirmWord();

  const submitDeletionRequest = async () => {
    if (deletionSubmitting || !matchesDeleteConfirm(deletionConfirmation)) return;

    setDeletionSubmitting(true);
    setDeletionError('');
    try {
      const response = await base44.functions.invoke('request-account-deletion', {
        action: 'request',
        // The function's expected token stays the literal 'DELETE';
        // the localized typed-word gate above is the user-facing check.
        confirmation: 'DELETE',
      });
      const result = response.data;
      if (!result?.success || !['requested', 'under_review'].includes(result.status)) {
        throw new Error(t('settings.deletion.confirmError'));
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
        title: t('settings.deletion.receivedTitle'),
        description: t('settings.deletion.receivedDesc'),
      });
    } catch (error) {
      setDeletionError(
        error?.response?.data?.error ||
        error?.message ||
        t('settings.deletion.submitError')
      );
    } finally {
      setDeletionSubmitting(false);
    }
  };

  // T6: the brand color applies the moment it is picked. Before T6
  // the picker only saved a value nothing ever read, so picking a
  // color changed nothing in the app — this preview is the fix, and
  // Layout applies the saved color on every page load.
  useEffect(() => {
    if (values?.brand_color) applyBrandColor(values.brand_color);
  }, [values?.brand_color]);

  const uploadLogo = async (file) => {
    setError('');
    // T6: the twin has no Base44 file host — the logo goes to the
    // twin's own endpoint as a data URL and is stored on the business
    // record (no third-party host, nothing leaves the twin's database).
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError(t('settings.logo.typeError'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(t('settings.logo.sizeError'));
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(t('settings.logo.readError')));
        reader.readAsDataURL(file);
      });
      const { logo_url } = await apiRequest(
        `/api/businesses/${encodeURIComponent(activeId)}/logo`,
        { method: 'POST', body: { dataUrl } },
      );
      setValues((current) => ({ ...current, logo_url }));
    } catch (err) {
      setError(err?.message || t('settings.logo.uploadError'));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!values.name.trim()) {
      setError(t('settings.save.nameError'));
      return;
    }
    setError('');
    setSaving(true);
    try {
      await saveBusiness(record, values);
      await queryClient.invalidateQueries({ queryKey: ['workspace'] });
      setSaved(true);
      toast({ title: t('settings.save.savedToast') });
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err?.message || t('settings.save.error'));
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
      ? t('settings.policy.effectiveBoth', { date: terms.effectiveDate })
      : t('settings.policy.effectiveSplit', { termsDate: terms.effectiveDate, policyDate: policy.effectiveDate });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('settings.eyebrow')}</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('settings.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('settings.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => logout()}>
            <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('settings.logout')}
          </Button>
          <Button onClick={save} disabled={saving || uploading}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : saved ? (
              <Check className="mr-1.5 h-4 w-4" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            {saving ? t('settings.save.saving') : saved ? t('settings.save.saved') : t('settings.save.save')}
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

      <SecurityCard />

      {canShowPrivateBillingDiagnostics && (
        <EssentialsCheckoutReadinessDiagnostic businessId={activeId} />
      )}
      {canShowPrivateBillingDiagnostics && <UpgradeDryRunPanel />}

      <SettingsCard
        title={t('settings.subscription.title')}
        description={t('settings.subscription.description')}
      >
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
          {t('settings.review.the')}{' '}
          <Link to="/terms-of-service" className="font-medium text-primary underline underline-offset-4">
            {t('settings.review.termsLink')}
          </Link>
          {t('settings.review.commaThe')}{' '}
          <Link to="/subscription-policy" className="font-medium text-primary underline underline-offset-4">
            {t('settings.review.policyLink')}
          </Link>
          {' '}{t('settings.review.andThe')}{' '}
          <Link to="/privacy-policy" className="font-medium text-primary underline underline-offset-4">
            {t('settings.review.privacyLink')}
          </Link>
          {t('settings.review.tail', { line: policyEffectiveLine })}
        </p>
        <div className="space-y-3 text-sm text-foreground">
          {canShowBillingStatus && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-3" role="status" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{t('settings.billing.title')}</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11 lg:min-h-0"
                disabled={!activeId || (subscriptionStatus.businessId === activeId && subscriptionStatus.state === 'loading')}
                onClick={() => setSubscriptionStatusRefresh((count) => count + 1)}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {t('settings.billing.refresh')}
              </Button>
            </div>
            {subscriptionStatus.businessId !== activeId || subscriptionStatus.state === 'loading' ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('settings.billing.checking')}</p>
            ) : subscriptionStatus.state === 'verified' ? (
              <>
                <p className="mt-2 text-sm font-medium text-foreground">
                  {t('settings.billing.stripeReports', { status: t(VERIFIED_STRIPE_STATUS_LABELS[subscriptionStatus.billing_status]) })}
                </p>
                {verifiedDateLabel(subscriptionStatus.checked_at) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('settings.billing.verified', { date: verifiedDateLabel(subscriptionStatus.checked_at) })}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.billing.readOnlyNote')}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm font-medium text-foreground">{t('settings.billing.unavailable')}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.billing.unavailableDetail')}
                </p>
              </>
            )}
          </div>
          )}

          <h3 className="font-semibold">{t('settings.cancelTerms.title')}</h3>
          <p className="text-muted-foreground">
            {t('settings.cancelTerms.intro')}
          </p>
          <ul className="list-disc space-y-2 pl-5 leading-relaxed">
            <li>
              <strong>{t('settings.cancelTerms.noApprovalTitle')}</strong> {t('settings.cancelTerms.noApprovalBody')}
            </li>
            <li>
              <strong>{t('settings.cancelTerms.remainingTitle')}</strong> {t('settings.cancelTerms.remainingBody')}
            </li>
            <li>
              <strong>{t('settings.cancelTerms.trialTitle')}</strong> {t('settings.cancelTerms.trialBody')}
            </li>
            <li>
              <strong>{t('settings.cancelTerms.paymentTitle')}</strong> {t('settings.cancelTerms.paymentBody')}
            </li>
            <li>
              <strong>{t('settings.cancelTerms.storesTitle')}</strong> {t('settings.cancelTerms.storesBody')}
              <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <a href="https://support.google.com/googleplay/answer/7018481" target="_blank" rel="noopener noreferrer"
                   className="underline underline-offset-2 hover:text-foreground">
                  {t('settings.cancelTerms.googlePlayLink')}
                </a>
                <a href="https://support.apple.com/en-us/118428" target="_blank" rel="noopener noreferrer"
                   className="underline underline-offset-2 hover:text-foreground">
                  {t('settings.cancelTerms.appleLink')}
                </a>
              </span>
            </li>
            <li>
              <strong>{t('settings.cancelTerms.graceTitle')}</strong>{' '}
              {CANCELLATION_GRACE_PARAGRAPH}
            </li>
          </ul>
          {entitlementStatus === 'past_due' && (
            <div role="status" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3">
              <h3 className="font-semibold">{t('settings.pastDue.title')}</h3>
              <p className="mt-1 text-muted-foreground">
                {t('settings.pastDue.body')}
              </p>
              <Button type="button" variant="outline" className="mt-3 min-h-11" asChild>
                <Link to="/upgrade">{t('settings.pastDue.updateButton')}</Link>
              </Button>
            </div>
          )}
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t('settings.separateDecisions')}
          </p>
          {canCancel && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 border-destructive text-destructive hover:bg-destructive/10"
              onClick={() => setCancellationOpen(true)}
            >
              <CreditCard className="h-4 w-4" aria-hidden="true" />
              {t('settings.cancelSubscription')}
            </Button>
          )}
          {entitlementStatus === 'trialing' && trialEndsOn && (
            <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              {t('settings.trial.cancelKeeps', { date: trialEndsOn })}
            </p>
          )}
          {cancelEndsOn && (
            <p role="status" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              {t('settings.canceled.endsOn', { date: cancelEndsOn })}
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
        title={t('settings.appearance.title')}
        description={t('settings.appearance.description')}
      >
        <fieldset disabled={!themeReady}>
          <legend className="sr-only">{t('settings.appearance.legend')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {APPEARANCE_OPTIONS.map(({ value, labelKey, descriptionKey, icon: Icon }) => (
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
                    {t(labelKey)}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{t(descriptionKey)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">
          {t('settings.appearance.remembered')}
        </p>
      </SettingsCard>

      <SettingsCard
        title={t('settings.delete.title')}
        description={t('settings.delete.description')}
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('settings.delete.intro')}
        </p>

        {deletionStatus?.pending ? (
          <div role="status" className="rounded-lg border border-border bg-secondary px-4 py-3 text-sm">
            <p className="font-medium text-foreground">
              {deletionStatus.status === 'under_review'
                ? t('settings.delete.underReview')
                : t('settings.delete.received')}
            </p>
            <p className="mt-1 text-muted-foreground">
              {t('settings.delete.notDeleted')}
            </p>
          </div>
        ) : (
          <>
            {deletionLoading && (
              <p role="status" className="text-xs text-muted-foreground">
                {t('settings.delete.checking')}
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
                  {t('settings.delete.requestButton')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('settings.delete.dialogTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('settings.delete.dialogDescription', { word: confirmWord })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2 py-2">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {plan?.key === 'business'
                      ? t('settings.delete.exportFirst')
                      : t('settings.delete.noExport')}
                  </p>
                  <label htmlFor="confirm-account-deletion" className="text-sm font-medium text-foreground">
                    {t('settings.delete.enterDelete', { word: confirmWord })}
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
                  <AlertDialogCancel disabled={deletionSubmitting}>{t('settings.delete.keepAccount')}</AlertDialogCancel>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={!matchesDeleteConfirm(deletionConfirmation) || deletionSubmitting}
                    onClick={submitDeletionRequest}
                  >
                    {deletionSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    {deletionSubmitting ? t('settings.delete.submitting') : t('settings.delete.submit')}
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
          {t('settings.footer.note')}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => setValues(resolveBusiness(record))}
        >
          {t('settings.footer.reset')}
        </Button>
      </div>
    </div>
  );
}