import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { base44 } from '@/api/client';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/** Owner-only parent; never opens checkout or changes a plan. */
// T6.3: getters, not import-time t() calls — the readiness wording
// follows the live locale instead of freezing at module load.
const messages = {
  get ready() { return t('billing.readiness.ready'); },
  get complimentary_owner_must_not_become_a_test_paying_customer() {
    return t('billing.readiness.complimentaryProtected');
  },
  get stripe_checkout_environment_incomplete() {
    return t('billing.readiness.environmentIncomplete');
  },
  get owner_has_subscription_or_trial_history() {
    return t('billing.readiness.ownerHasHistory');
  },
  get owner_introductory_trial_already_used() {
    return t('billing.readiness.trialAlreadyUsed');
  },
  get owner_trial_eligibility_unverified() {
    return t('billing.readiness.trialEligibilityUnverified');
  },
  get provider_test_mode_and_atomic_fulfillment_not_yet_verified() {
    return t('billing.readiness.testModeUnverified');
  },
  get selected_business_entitlement_not_unique() {
    return t('billing.readiness.entitlementNotUnique');
  },
  get account_billing_history_incomplete() {
    return t('billing.readiness.accountBillingIncomplete');
  },
  get billing_history_incomplete() {
    return t('billing.readiness.billingHistoryIncomplete');
  },
  get account_ownership_or_history_mismatch() {
    return t('billing.readiness.ownershipMismatch');
  },
  get approved_monthly_checkout_catalog_unverified() {
    return t('billing.readiness.catalogUnverified');
  },
  get read_only_checkout_audit_unavailable() {
    return t('billing.readiness.auditUnavailable');
  },
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
    <section className="rounded-xl border border-border bg-card p-4 text-sm sm:p-5" aria-label={t('billing.readiness.ariaLabel')}>
      <h3 className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('billing.readiness.title')}
      </h3>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        {t('billing.readiness.body')}
      </p>
      <Button type="button" variant="outline" className="mt-3 min-h-11"
        onClick={() => void inspect()} disabled={!businessId || shown?.state === 'loading'}>
        {shown?.state === 'loading' ? t('billing.readiness.checking') : t('billing.readiness.inspect')}
      </Button>
      {shown && shown.state !== 'loading' && (
        <p role="status" aria-live="polite"
          className="mt-3 rounded-lg border border-border bg-secondary/50 p-3 leading-relaxed">
          {messages[shown.state] || t('billing.readiness.unknown', { state: shown.state })}
        </p>
      )}
    </section>
  );
}
