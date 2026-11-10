import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock3, ShieldCheck } from 'lucide-react';
import LegalFooter from '@/components/LegalFooter';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { reconcileSubscriptionAccess } from '@/lib/entitlements';
import {
  nextAutoRecovery,
} from '@/lib/thankYouReconcileRetry';

/**
 * Stripe's return URL is exactly "/ThankYou" (see App.jsx).
 *
 * On arrival with ?session_id=..., the page asks the server to
 * re-verify the checkout against Stripe (reconcile) — the server
 * re-reads the session, subscription, and first invoice from Stripe
 * and grants only from that verified evidence. The browser never
 * grants access itself.
 *
 * Automatic recovery (src/lib/thankYouReconcileRetry.js): inside a
 * 5-minute window, keep retrying with backoff (10→15→20→25→30s, max
 * 20 attempts) after any failure time might fix. A manual "Check
 * again" button stays available throughout. While unverified, the
 * app is NOT unlocked and the page says so plainly. Success takes
 * the customer directly inside the paid plan — no "verification
 * pending" window as the end state.
 */
const SUCCESS_STATES = new Set(['granted', 'already_active']);

const UNVERIFIED_DETAILS = {
  not_verified: 'Stripe has not finished setting up this checkout yet. Your payment is safe — nothing has been charged twice. We will keep checking.',
  trial_not_eligible: 'This email has already used its one free trial, so a trial could not be started. Contact support if you think this is a mistake.',
  no_pending_checkout_to_reconcile: 'We could not find a pending checkout for this workspace.',
  default: 'Your purchase is not verified yet. We will keep checking — do not start another checkout.',
};

export default function ThankYou() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const { activeId } = useBusiness();
  const [phase, setPhase] = useState(sessionId ? 'checking' : 'no-session');
  const [detail, setDetail] = useState(null);
  const [result, setResult] = useState(null);
  const startedAtRef = useRef(Date.now());
  const attemptsRef = useRef(0);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const attempt = useCallback(async () => {
    if (!sessionId) return;
    attemptsRef.current += 1;
    try {
      const data = await reconcileSubscriptionAccess(activeId, sessionId);
      if (!mountedRef.current) return;
      const state = data?.state;
      if (SUCCESS_STATES.has(state)) {
        setResult(data);
        setPhase('granted');
        return;
      }
      setDetail(UNVERIFIED_DETAILS[state] || UNVERIFIED_DETAILS.default);
      const next = nextAutoRecovery({
        state,
        startedAtMs: startedAtRef.current,
        attempts: attemptsRef.current,
      });
      if (next.retry) {
        setPhase('checking');
        timerRef.current = setTimeout(() => void attempt(), next.delayMs);
      } else {
        setPhase('pending');
      }
    } catch {
      if (!mountedRef.current) return;
      setDetail(UNVERIFIED_DETAILS.default);
      const next = nextAutoRecovery({
        state: 'not_verified',
        startedAtMs: startedAtRef.current,
        attempts: attemptsRef.current,
      });
      if (next.retry) {
        setPhase('checking');
        timerRef.current = setTimeout(() => void attempt(), next.delayMs);
      } else {
        setPhase('pending');
      }
    }
  }, [sessionId, activeId]);

  useEffect(() => {
    mountedRef.current = true;
    if (sessionId) {
      startedAtRef.current = Date.now();
      attemptsRef.current = 0;
      void attempt();
    }
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [sessionId, attempt]);

  const checkAgain = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase('checking');
    setDetail(null);
    void attempt();
  };

  return (
    <main className="flex min-h-screen flex-col px-6">
      <section className="m-auto max-w-md space-y-4 py-10 text-center">
        {phase === 'granted' ? (
          <>
            <div className="flex justify-center">
              <CheckCircle2 className="h-9 w-9 text-primary" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-semibold">You&apos;re in — welcome to your plan.</h1>
            <p className="text-muted-foreground">
              {result?.status === 'trialing'
                ? `Your 7-day free trial is running${result?.trial_ends_at ? ` until ${new Date(result.trial_ends_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}. You will not be charged until the trial ends.`
                : 'Your subscription is active. You can start using the app now.'}
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button asChild>
                <Link to="/">Open your plan</Link>
              </Button>
            </div>
          </>
        ) : phase === 'no-session' ? (
          <>
            <div className="flex justify-center">
              <Clock3 className="h-9 w-9 text-primary" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-semibold">No checkout to verify here.</h1>
            <p className="text-muted-foreground">
              This page confirms a Stripe checkout. If you were subscribing, start from the plans page — nothing has been charged.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link to="/plans" className="inline-block rounded-md bg-primary px-5 py-2 text-primary-foreground">
                Back to plans
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-center">
              <Clock3 className="h-9 w-9 text-primary" aria-hidden="true" />
            </div>
            <h1 className="text-3xl font-semibold">
              {phase === 'checking' ? 'Taking you to your plan…' : 'Your purchase is not verified yet.'}
            </h1>
            <p className="text-muted-foreground">
              {phase === 'checking'
                ? 'We are confirming your subscription with Stripe. This usually takes a few seconds — please keep this page open.'
                : detail || UNVERIFIED_DETAILS.default}
            </p>
            <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Your plan is determined by server-verified provider records.
              The app is not unlocked until the purchase is verified.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button type="button" variant="outline" onClick={checkAgain} disabled={phase === 'checking'}>
                Check again
              </Button>
              <Link to="/plans" className="inline-block rounded-md bg-primary px-5 py-2 text-primary-foreground">
                Back to plans
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">
              Do not start another checkout to try again — that would create a second subscription.
            </p>
          </>
        )}
      </section>

      <LegalFooter />
    </main>
  );
}
