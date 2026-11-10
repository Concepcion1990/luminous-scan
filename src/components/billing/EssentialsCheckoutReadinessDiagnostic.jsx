import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { base44 } from '@/api/client';
import { Button } from '@/components/ui/button';

/** Owner-only parent; never opens checkout or changes a plan. */
const messages = {
  ready:
    'Stripe checkout is ready — keys, webhook verification, and attestations are all confirmed.',
  complimentary_owner_must_not_become_a_test_paying_customer:
    'Your complimentary Business workspace is protected. It must not become a paying Essentials test account.',
  stripe_checkout_environment_incomplete:
    'Stripe checkout credentials, webhook verification or the app return address could not all be confirmed. No checkout may start.',
  owner_has_subscription_or_trial_history:
    'This owner has prior subscription or trial evidence. A second checkout must not be created.',
  owner_introductory_trial_already_used:
    'An introductory trial has already been used or reserved. No repeat trial may start.',
  owner_trial_eligibility_unverified:
    'One-time trial eligibility is not verified for this owner. Checkout remains blocked.',
  provider_test_mode_and_atomic_fulfillment_not_yet_verified:
    'Account records are readable, but safe Stripe test-mode containment and paid-renewal fulfillment are not verified. Checkout remains blocked.',
  selected_business_entitlement_not_unique:
    'Existing plan information is missing or ambiguous. No checkout may start.',
  account_billing_history_incomplete:
    'Account billing history could not be read completely. No checkout may start.',
  billing_history_incomplete:
    'The complete owner history could not be verified. No checkout may start.',
  account_ownership_or_history_mismatch:
    'Account ownership or billing records need review before any subscription can be started.',
  approved_monthly_checkout_catalog_unverified:
    'The approved $14.99/month server checkout definition needs verification.',
  read_only_checkout_audit_unavailable:
    'The read-only server check was unavailable. No payment or account change occurred.',
};

export default function EssentialsCheckoutReadinessDiagnostic({ businessId }) {
  const [status, setStatus] = useState(null);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setStatus(null); }, [businessId]);
  const inspect = async () => {
    if (!businessId) return;
    const number = ++generation.current;
    setStatus({ businessId, state: 'loading' });
    try {
      const res = await base44.functions.invoke('inspect-essentials-checkout-readiness', {
        action: 'inspect_essentials_checkout_readiness', business_id: businessId,
      });
      if (number !== generation.current) return;
      setStatus({ businessId, state: res?.data?.state || 'unavailable' });
    } catch {
      if (number === generation.current)
        setStatus({ businessId, state: 'unavailable' });
    }
  };
  const shown = status?.businessId === businessId ? status : null;
  return (
    <section className="rounded-xl border border-border bg-card p-4 text-sm sm:p-5" aria-label="Actual Essentials checkout readiness">
      <h3 className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        Essentials checkout — real account safety check
      </h3>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        Inspect actual subscription and trial records without buying anything.
        Your complimentary Business account and your pajama sample remain unchanged.
        This does not open Stripe checkout, charge a card, or change a plan.
      </p>
      <Button type="button" variant="outline" className="mt-3 min-h-11"
        onClick={() => void inspect()} disabled={!businessId || shown?.state === 'loading'}>
        {shown?.state === 'loading' ? 'Checking account records…' : 'Inspect checkout readiness (no charge)'}
      </Button>
      {shown && shown.state !== 'loading' && (
        <p role="status" aria-live="polite"
          className="mt-3 rounded-lg border border-border bg-secondary/50 p-3 leading-relaxed">
          {messages[shown.state] || ('The read-only check could not establish readiness (' + shown.state + '). Nothing changed.')}
        </p>
      )}
    </section>
  );
}
