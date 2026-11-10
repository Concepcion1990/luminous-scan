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

const SUPPORT_CONTACT = 'theluminousbookshop@outlook.com';

/**
 * Plain-language versions of the backend cancel states (finding 14),
 * following ThankYou's RECONCILE_DETAILS pattern. The customer sees one
 * of these; the raw state string is kept only as a small "mention this
 * code to support" line. Nothing here changes the cancel mechanism.
 */
const CANCEL_ERROR_DETAILS = {
  method_not_allowed: 'Something went wrong on our side. Nothing was changed — please try again, or contact support.',
  sign_in_required: 'You need to be signed in to cancel. Please sign in and try again.',
  invalid_request: 'We could not work out which subscription to cancel. Nothing was changed — please try again, or contact support.',
  business_id_required: 'We could not work out which subscription to cancel. Nothing was changed — please try again, or contact support.',
  subscription_owner_required: 'Only the business owner can cancel this subscription. Nothing was changed.',
  billing_records_need_review: 'Your billing records need a review before this can be canceled. Nothing was changed — please contact support.',
  complimentary_access_protected: 'This workspace has complimentary access, so there is no paid subscription to cancel. Nothing was changed.',
  no_verified_subscription_record: 'We could not find a verified subscription for this business. Nothing was changed — please contact support.',
  purchase_contract_mismatch: 'The billing record does not match this business, so we cannot cancel it here. Nothing was changed — please contact support.',
  stripe_not_configured: 'Payments could not be reached. Nothing has changed — please try again, or contact support.',
  subscription_paid_through_unverified: 'We could not confirm your paid-through date. Nothing was changed — please try again, or contact support.',
  already_ended: 'This subscription has already ended, so there is nothing more to cancel.',
  subscription_event_history_incomplete: 'Your billing history needs a review before this can be canceled. Nothing was changed — please contact support.',
  event_requires_review: 'Your billing history needs a review before this can be canceled. Nothing was changed — please contact support.',
  subscription_cancellation_unavailable: 'The cancellation could not be completed. Nothing was changed — your subscription and access are exactly as they were. Please try again, or contact support.',
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
          <AlertDialogTitle>Cancel subscription</AlertDialogTitle>
          <AlertDialogDescription>
            Unsubscribe from {planLabel || 'your plan'}. Canceling stops
            future renewals at the end of your paid period — it never ends
            your access at once.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {phase === 'done' && result ? (
          <div role="status" className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
            <p className="font-semibold">Your subscription is canceled.</p>
            <p className="text-muted-foreground">
              {confirmedEndLabel
                ? `You keep full access until ${confirmedEndLabel}. After that date you have a ${CANCELLATION_GRACE_DAYS}-day read-only grace period — you can still log in and see your products, but you cannot add, edit, delete, scan, import, export or change anything. ${graceEndLabel ? `After the 15-day grace period ends on ${graceEndLabel}, your account and all its information are permanently deleted and cannot be recovered.` : CANCELLATION_WIPE_SENTENCE}`
                : `You keep full access until the end of your paid period. After that, a 15-day read-only grace period applies. ${CANCELLATION_WIPE_SENTENCE}`}
            </p>
            {result.refund_window_open ? (
              <p className="text-muted-foreground">
                You canceled within 3 days of your first paid charge, so you may be eligible
                for a refund of that first payment. Canceling does not issue the refund
                itself — request it through {SUPPORT_CONTACT}.
              </p>
            ) : (
              <p className="text-muted-foreground">
                Canceling does not by itself issue a refund. Refunds apply only within
                3 days of the first successful paid charge, requested through {SUPPORT_CONTACT}.
              </p>
            )}
          </div>
        ) : phase === 'error' ? (
          <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
            <p className="font-semibold">Your subscription was NOT canceled.</p>
            <p className="text-muted-foreground">
              {CANCEL_ERROR_DETAILS[error] || CANCEL_ERROR_DETAILS.subscription_cancellation_unavailable}
            </p>
            <p className="text-xs text-muted-foreground">
              If you contact {SUPPORT_CONTACT}, mention this code: {error}
            </p>
          </div>
        ) : alreadyCanceled ? (
          <div role="status" className="space-y-2 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
            <p className="font-semibold">This subscription is already canceled.</p>
            <p className="text-muted-foreground">
              {periodLabel
                ? `It ends on ${periodLabel}. You keep full access until then. After that date you have a ${CANCELLATION_GRACE_DAYS}-day read-only grace period to see your products. ${CANCELLATION_WIPE_SENTENCE}`
                : 'It ends at the end of the current paid period. You keep full access until then.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              If you ever subscribe through Google Play or the Apple App Store,
              you may need to cancel it through that store's subscription settings.
              This dialog cannot stop app-store billing. Uninstalling the app or deleting
              your StockHaven account does not cancel a store subscription.
            </p>
            {status === 'trialing' && (
              <p className="text-muted-foreground">
                {trialEndLabel || periodLabel
                  ? `Cancelling during your trial keeps your full 7 days — access ends on ${trialEndLabel || periodLabel}, and you will not be charged.`
                  : 'Cancelling during your trial keeps your full 7 days, and you will not be charged.'}
              </p>
            )}
            <ul className="list-disc space-y-2 pl-5 leading-relaxed">
              <li>
                <strong>You keep full access until {periodLabel || 'the end of your paid period'}.</strong>{' '}
                Canceling stops future renewals only — it never ends your access at once,
                and no extra free month is added.
              </li>
              <li>
                <strong>After that date, a {CANCELLATION_GRACE_DAYS}-day read-only grace period.</strong>{' '}
                You can still log in and see your products, so you can look at what you had
                and write it down. Everything else is blocked: no adding, editing, deleting,
                scanning, importing, exporting or migrating, no settings, no staff.
              </li>
              <li>
                <strong>{CANCELLATION_WIPE_SENTENCE}</strong>{' '}
                Resubscribing starts fresh.
              </li>
              <li>
                <strong>Refunds are separate.</strong> Canceling does not by itself issue a
                refund. A refund of the first payment applies only if you cancel within
                3 days (72 hours) of the first successful paid charge, requested through{' '}
                {SUPPORT_CONTACT}.
              </li>
              <li>
                <strong>One free trial.</strong> Canceling a trial or subscription does not
                grant another trial; returning customers must choose a paid subscription.
              </li>
            </ul>
          </div>
        )}

        <AlertDialogFooter>
          {phase === 'done' ? (
            <Button type="button" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <AlertDialogCancel disabled={phase === 'confirming'}>
                Keep Subscription / Close
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
                      Canceling…
                    </>
                  ) : (
                    'Confirm Cancellation'
                  )}
                </Button>
              )}
              {phase === 'error' && (
                <Button type="button" onClick={() => handleOpenChange(false)}>
                  Close
                </Button>
              )}
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
