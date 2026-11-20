import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { GraduationCap, Loader2 } from 'lucide-react';
import { apiRequest } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import AppMark from '@/components/brand/AppMark';
import LegalFooter from '@/components/LegalFooter';
import PolicyDocumentView from '@/components/business/PolicyDocumentView';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/**
 * The one-time staff welcome (owner's idea, Nov 19, 2026).
 *
 * Every person the owner hires — manager, viewer, clerk, any
 * role — lands here at their FIRST sign-in, before anything
 * else, and never again: "seen" is recorded server-side, per
 * member, so it cannot reappear on another device either.
 *
 * The page is three layers, in a fixed order:
 *   1. "Welcome to Luminous StockHaven" — permanent app copy.
 *      That line is the app itself; no owner can edit or remove
 *      it, and it is not part of the script below.
 *   2. The welcome script — the owner's own words for their
 *      store, written in the Staff area, with {name} and {store}
 *      filled in for the person reading. A store that has not
 *      written one (or saved it empty) gets the app's standard
 *      script, translated like everything else. Owner-written
 *      words render as written — custom content, like the
 *      business name itself.
 *   3. The business's own documents (Nov 19, 2026): the owner's
 *      Store Policies and Terms & Conditions, when the owner has
 *      written or uploaded them — shown here ONCE, at this first
 *      start, and living read-only in the member's Settings from
 *      then on. A showing, not a signing: no agree-checkbox, no
 *      attestation, and the continue/skip doors below behave
 *      exactly as they always have. A business with nothing
 *      written shows nothing extra.
 *   4. "Start my training" — app copy, the door into Training.
 */
// Set the moment a member finishes the welcome (either door),
// with the destination they chose. Module-level on purpose:
// finish() refreshes the session, the app shell briefly
// unmounts behind its loading spinner, and this page REMOUNTS —
// component state (busy) resets and the original instance's
// navigate call dies with it, so the nothing-pending guard
// fired on the remount and sent "Start my training" home
// instead of to Training (harness catch, Nov 19, 2026). The
// module flag survives the remount, and whichever instance is
// mounted when the refreshed user lands completes the journey
// (the effect in the component). A full page reload clears it,
// and by then the server-side flag has landed, so a direct
// revisit still bounces home exactly as intended.
let welcomeFinishInFlight = false;
let welcomeFinishDestination = null;

export default function StaffWelcome() {
  const { user, checkUserAuth } = useAuth();
  const { profile, activeId } = useBusiness();
  const { member } = useStaffAccess();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [policies, setPolicies] = useState(null);

  // The business's own documents, shown once here (see the
  // header note). A failed read simply shows nothing extra —
  // the welcome is a greeting, not a gate, and the documents
  // live in the member's Settings either way.
  useEffect(() => {
    if (!activeId || !user?.staff_welcome_pending) return;
    let mounted = true;
    apiRequest(`/api/businesses/${encodeURIComponent(activeId)}/policies`)
      .then((state) => {
        if (mounted) setPolicies(state);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [activeId, user?.staff_welcome_pending]);

  // Whichever instance is mounted when the refreshed user lands
  // (pending flipped false) completes the journey — the instance
  // that started finish() may have been unmounted by the auth
  // spinner, and its navigate call dies with it.
  useEffect(() => {
    if (user && !user.staff_welcome_pending && welcomeFinishInFlight && welcomeFinishDestination) {
      const destination = welcomeFinishDestination;
      welcomeFinishInFlight = false;
      welcomeFinishDestination = null;
      navigate(destination, { replace: true });
    }
  }, [user, navigate]);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('layout.checkingAccess')}
      </div>
    );
  }
  // Nothing pending (the owner herself, or a member who already
  // saw it): this page has nothing to show them. While a finish
  // is in flight, the guard stays down — finish() refreshes the
  // user (pending flips false) and then navigates to the
  // member's chosen destination.
  if (!user.staff_welcome_pending && !busy && !welcomeFinishInFlight) return <Navigate to="/" replace />;

  const fullName = member?.full_name || '';
  const firstName =
    fullName.trim().split(/\s+/)[0] ||
    String(user.email || '').split('@')[0] ||
    '';
  const storeName = profile?.name || '';

  const custom = String(profile?.staff_welcome_script || '').trim();
  const script = custom
    ? custom
    : [
        t('staffWelcome.defaultGreeting', { name: '{name}' }),
        t('staffWelcome.defaultStoreLine', { store: '{store}' }),
        t('staffWelcome.defaultTrainingLine'),
        t('staffWelcome.defaultGladLine'),
      ].join('\n');
  const paragraphs = script
    .split('\n')
    .map((line) => line.split('{name}').join(firstName).split('{store}').join(storeName))
    .filter((line) => line.trim().length > 0);

  const finish = async (destination) => {
    welcomeFinishInFlight = true;
    welcomeFinishDestination = destination;
    setBusy(true);
    try {
      await apiRequest('/api/auth/staff-welcome/seen', { method: 'POST', body: {} });
    } catch {
      // The welcome is a greeting, not a gate: if recording it
      // fails, the member still lands where they were headed
      // (and may simply see the welcome once more next time).
    }
    await checkUserAuth().catch(() => {});
    navigate(destination, { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-5 py-10 text-center">
        <AppMark />
        <h1 className="mt-8 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('staffWelcome.title')}
        </h1>
        <div className="mt-6 space-y-3">
          {paragraphs.map((line, index) => (
            <p
              key={index}
              className={
                index === 0
                  ? 'text-xl font-medium'
                  : 'text-base leading-relaxed text-muted-foreground'
              }
            >
              {line}
            </p>
          ))}
        </div>
        {policies && (policies.policies.kind !== 'empty' || policies.terms.kind !== 'empty') ? (
          <div className="mt-9 w-full space-y-5 rounded-xl border border-border bg-card p-5 text-left">
            <p className="text-sm font-medium">{t('staffWelcome.policiesIntro')}</p>
            <PolicyDocumentView
              businessId={activeId}
              docKind="policies"
              doc={policies.policies}
              headingKey="settings.policies.storePolicies"
            />
            <PolicyDocumentView
              businessId={activeId}
              docKind="terms"
              doc={policies.terms}
              headingKey="settings.policies.termsConditions"
            />
          </div>
        ) : null}
        <Button
          size="lg"
          className="mt-9 min-h-12 px-6"
          disabled={busy}
          onClick={() => finish('/training')}
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <GraduationCap className="mr-2 h-5 w-5" aria-hidden="true" />
          )}
          {t('staffWelcome.start')}
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={() => finish('/')}
          className="mt-4 text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('staffWelcome.skip')}
        </button>
      </main>
      <LegalFooter className="pb-6" />
    </div>
  );
}
