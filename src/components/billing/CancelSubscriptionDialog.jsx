import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { base44 } from '@/api/client';
import { CANCELLATION_GRACE_DAYS, CANCELLATION_WIPE_SENTENCE } from '@/lib/cancellationGrace';
import { t } from '@/lib/i18n';

const SUPPORT_CONTACT = 'theluminousbookshop@outlook.com';

/**
 * Plain-language versions of the backend cancel states (finding 14),
 * following ThankYou's RECONCILE_DETAILS pattern. The customer sees one
 * of these; the raw state string is kept only as a small "mention this
 * code to support" line. Nothing here changes the cancel mechanism.
 */
const CANCEL_ERROR_DETAILS = {
  get method_not_allowed() { return t('billing.cancelError.methodNotAllowed'); },
  get sign_in_required() { return t('billing.cancelError.signInRequired'); },
  get invalid_request() { return t('billing.cancelError.invalidRequest'); },
  get business_id_required() { return t('billing.cancelError.businessIdRequired'); },
  get subscription_owner_required() { return t('billing.cancelError.subscriptionOwnerRequired'); },
  get billing_records_need_review() { return t('billing.cancelError.billingRecordsNeedReview'); },
  get complimentary_access_protected() { return t('billing.cancelError.complimentaryAccessProtected'); },
  get no_verified_subscription_record() { return t('billing.cancelError.noVerifiedSubscriptionRecord'); },
  get purchase_contract_mismatch() { return t('billing.cancelError.purchaseContractMismatch'); },
  get stripe_not_configured() { return t('billing.cancelError.stripeNotConfigured'); },
  get subscription_paid_through_unverified() { return t('billing.cancelError.subscriptionPaidThroughUnverified'); },
  get already_ended() { return t('billing.cancelError.alreadyEnded'); },
  get subscription_event_history_incomplete() { return t('billing.cancelError.subscriptionEventHistoryIncomplete'); },
  get event_requires_review() { return t('billing.cancelError.eventRequiresReview'); },
  get subscription_cancellation_unavailable() { return t('billing.cancelError.subscriptionCancellationUnavailable'); },
};

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * The one "Unsubscribe" / "Cancel subscription" dialog, shared by Settings
 * and the Upgrade page. Unsubscribe and cancel are the SAME thing here.
 *
 * T4 (Nov 2026): confirming here really cancels at period end — the
 * server sets cancel_at_period_end on the Stripe subscription and only
 * records the cancellation after Stripe confirms it. Access and renewal
 * are unchanged until that confirmation lands. On failure the dialog
 * says the subscription was NOT canceled.
 *
 * What happens once Stripe is connected, in plain words (the policy,
 * shown before the customer confirms):
 * - Access continues in full until the paid-through date shown. A trial
 *   keeps trial access until the trial end. No extra free month is added.
 * - After the paid-through date, a 15-day read-only grace view: the
 *   customer can still log in and SEE their products, nothing else — no
 *   adding, editing, deleting, scanning, importing, exporting or
 *   migrating, no settings, no staff. After the 15 days, the account
 *   and all its information are permanently deleted and cannot be
 *   recovered — resubscribing starts fresh. (The wipe sweep runs
 *   daily on the server.)
 * - Canceling does NOT by itself issue a refund. Refunds follow the
 *   policy: within 3 days (72 hours) after the FIRST successful paid
 *   charge, via the official support contact.
 * - During the paid-through window, plan access is as normal: Essentials
 *   can import (no export); Business can import and export to CSV/Excel.
 *   During grace, nobody can export or migrate anything.
 *
 * The confirm step calls the `cancel-subscription` backend function,
 * which verifies cancel_at_period_end at Stripe before recording
 * anything. On failure the dialog shows the named error and the
 * support contact — it never pretends the cancellation worked.
 */
export default function CancelSubscriptionDialog({
  open,
  onOpenChange,
  planLabel,
  status,
  periodEndsAt,
  trialEndsAt = null,
  businessId,
  onCanceled,
}) {
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const alreadyCanceled = status === 'canceled';
  const periodLabel = formatDate(periodEndsAt);
  const trialEndLabel = formatDate(trialEndsAt);
  const confirmedEndLabel = formatDate(result?.access_until);
  const graceEndLabel = formatDate(result?.grace_ends_at);

  const reset = () => {
    setPhase('idle');
    setError(null);
    setResult(null);
  };

  const handleOpenChange = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const confirmCancel = async () => {
    if (phase === 'confirming' || !businessId) return;
    setPhase('confirming');
    setError(null);
    try {
      const response = await base44.functions.invoke('cancel-subscription', {
        action: 'cancel_subscription',
        business_id: businessId,
      });
      const data = response?.data ?? {};
      if (data.state === 'cancellation_recorded' || data.state === 'already_canceled') {
        setResult(data);
        setPhase('done');
        if (typeof onCanceled === 'function') onCanceled(data);
        return;
      }
      const state = typeof data.state === 'string' && data.state.length > 0
        ? data.state : 'subscription_cancellation_unavailable';
      throw new Error(state);
    } catch (invokeError) {
      const state = invokeError?.response?.data?.state ||
        (typeof invokeError?.message === 'string' && invokeError.message.length > 0
          ? invokeError.message : 'subscription_cancellation_unavailable');
      setError(state);
      setPhase('error');
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('billing.cancel.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('billing.cancel.description', { plan: planLabel || t('billing.cancel.yourPlan') })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {phase === 'done' && result ? (
          <div role="status" className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
            <p className="font-semibold">{t('billing.cancel.doneTitle')}</p>
            <p className="text-muted-foreground">
              {confirmedEndLabel
                ? t('billing.cancel.doneWithEnd', { endDate: confirmedEndLabel, graceDays: CANCELLATION_GRACE_DAYS, gracePart: graceEndLabel ? t('billing.cancel.graceEndsOn', { date: graceEndLabel }) : CANCELLATION_WIPE_SENTENCE })
                : t('billing.cancel.doneNoEnd', { wipeSentence: CANCELLATION_WIPE_SENTENCE })}
            </p>
            {result.refund_window_open ? (
              <p className="text-muted-foreground">
                {t('billing.cancel.refundWindowOpen', { contact: SUPPORT_CONTACT })}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {t('billing.cancel.refundWindowClosed', { contact: SUPPORT_CONTACT })}
              </p>
            )}
          </div>
        ) : phase === 'error' ? (
          <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
            <p className="font-semibold">{t('billing.cancel.notCanceledTitle')}</p>
            <p className="text-muted-foreground">
              {CANCEL_ERROR_DETAILS[error] || CANCEL_ERROR_DETAILS.subscription_cancellation_unavailable}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('billing.cancel.contactCode', { contact: SUPPORT_CONTACT, code: error })}
            </p>
          </div>
        ) : alreadyCanceled ? (
          <div role="status" className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
            <p className="font-semibold">{t('billing.cancel.alreadyCanceledTitle')}</p>
            <p className="text-muted-foreground">
              {periodLabel
                ? t('billing.cancel.alreadyCanceledWithEnd', { date: periodLabel, graceDays: CANCELLATION_GRACE_DAYS, wipeSentence: CANCELLATION_WIPE_SENTENCE })
                : t('billing.cancel.alreadyCanceledNoEnd')}
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              {t('billing.cancel.appStoreNote')}
            </p>
            {status === 'trialing' && (
              <p className="text-muted-foreground">
                {trialEndLabel || periodLabel
                  ? t('billing.cancel.trialNote', { date: trialEndLabel || periodLabel })
                  : t('billing.cancel.trialNoteNoDate')}
              </p>
            )}
            <ul className="list-disc space-y-2 pl-5 leading-relaxed">
              <li>
                <strong>{t('billing.cancel.keepAccessUntil', { date: periodLabel || t('billing.cancel.endOfPaidPeriod') })}</strong>{' '}
                {t('billing.cancel.keepAccessRest')}
              </li>
              <li>
                <strong>{t('billing.cancel.gracePeriodTitle', { graceDays: CANCELLATION_GRACE_DAYS })}</strong>{' '}
                {t('billing.cancel.gracePeriodRest')}
              </li>
              <li>
                <strong>{CANCELLATION_WIPE_SENTENCE}</strong>{' '}
                {t('billing.cancel.resubscribeFresh')}
              </li>
              <li>
                <strong>{t('billing.cancel.refundsSeparate')}</strong> {t('billing.cancel.refundsRest', { contact: SUPPORT_CONTACT })}
              </li>
              <li>
                <strong>{t('billing.cancel.oneTrialTitle')}</strong> {t('billing.cancel.oneTrialRest')}
              </li>
            </ul>
          </div>
        )}

        <AlertDialogFooter>
          {phase === 'done' ? (
            <Button type="button" onClick={() => handleOpenChange(false)}>
              {t('billing.cancel.done')}
            </Button>
          ) : (
            <>
              <AlertDialogCancel disabled={phase === 'confirming'}>
                {t('billing.cancel.keepOrClose')}
              </AlertDialogCancel>
              {!alreadyCanceled && phase !== 'error' && (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={phase === 'confirming' || !businessId}
                  onClick={confirmCancel}
                >
                  {phase === 'confirming' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {t('billing.cancel.canceling')}
                    </>
                  ) : (
                    t('billing.cancel.confirm')
                  )}
                </Button>
              )}
              {phase === 'error' && (
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  {t('billing.cancel.close')}
                </Button>
              )}
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
