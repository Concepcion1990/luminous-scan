import { Link } from 'react-router-dom';
import { ArrowRight, Loader2, Lock } from 'lucide-react';
import useEntitlements from '@/hooks/useEntitlements';
import { FEATURES } from '@/lib/plans';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/**
 * The one door for Business-only modules: a typed URL, a bookmark or a stale
 * link lands here instead of on the page. Navigation hides the same items.
 */
export default function PlanGate({ feature, children }) {
  const { can, isLoading, plan } = useEntitlements();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('plan.gate.checking')}
      </div>
    );
  }

  if (can(feature)) return children;

  const label = FEATURES[feature] || t('plan.gate.moduleFallback');

  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Lock className="h-5 w-5 text-muted-foreground" />
      </div>
      <h1 className="mt-4 text-xl font-semibold">{t('plan.gate.businessFeature', { feature: label })}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {t('plan.gate.body', { plan: plan.name, feature: label.toLowerCase() })}
      </p>
      <Button asChild className="mt-5">
        <Link to="/upgrade">
          {t('plan.gate.seeBusiness')} <ArrowRight className="ml-1.5 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}