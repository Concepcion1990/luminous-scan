import { Link } from 'react-router-dom';
import { ArrowRight, Check, Clock3, Smartphone } from 'lucide-react';
import useEntitlements from '@/hooks/useEntitlements';
import { trialDaysLeft, trialWarningDetails } from '@/lib/entitlements';
import { trialInAppNotice } from '@/lib/trialNotices';
import { formatPrice } from '@/lib/plans';
import { t } from '@/lib/i18n';

const STATUS_LABEL = {
  trialing: t('plans.status.trialing'),
  active: t('plans.status.active'),
  past_due: t('plans.status.pastDue'),
  canceled: t('plans.status.canceled'),
  grandfathered: t('plans.status.grandfathered'),
  // A missing record resolves to pending_checkout in resolveEntitlement
  // (entitlements.js) — never to grandfathered, which would read "Full
  // access" on an Essentials-priced card (Finding 33).
  pending_checkout: t('plans.status.pendingCheckout'),
};

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The plan this business is on, always reachable after onboarding. */
export default function PlanSummaryCard() {
  const { plan, record, isEssentials, isLoading } = useEntitlements();
  const days = trialDaysLeft(record);
  const status = record?.status || 'pending_checkout';
  const notice = trialWarningDetails(record);
  const warningStage = notice?.warningStage;
  const isPrelaunch = notice?.kind === 'prelaunch';
  // Concepcion's three in-app notices (5 days, 3 days, 24 hours) come
  // from trialInAppNotice; the pre-launch preview keeps its own banner.
  const inAppNotice = trialInAppNotice(record);
  const showTrialBanner = isPrelaunch ? Boolean(warningStage) : Boolean(inAppNotice);

  // While the entitlement row is still loading the plan is unknown: the
  // resolved fallback is Essentials, so a Business login would briefly show
  // the Essentials name, price and feature list. Say so instead of guessing.
  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {t('plans.eyebrow')}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t('plans.loadingPlan')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('plans.eyebrow')}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{plan.name}</h2>
          <p className="mt-0.5 flex items-baseline gap-1.5 text-sm text-muted-foreground">
            <span className="numeric">{formatPrice(plan.price)}</span>
            <span className="font-mono text-[10px] uppercase tracking-wide">{t('plans.perMonth')}</span>
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {status === 'grandfathered'
              ? t('plans.priceNoteGrandfathered')
              : t('plans.priceNoteStandard')}
          </p>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
          {isPrelaunch ? t('plans.complimentaryPrelaunch') : STATUS_LABEL[status] || status}
        </span>
      </div>

      {showTrialBanner && (
        <div role="status" className="mt-3 flex gap-2 rounded-lg border border-border bg-secondary px-3 py-3 text-sm">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              {isPrelaunch
                ? (warningStage === 'one-day'
                  ? t('plans.prelaunchCheckinOneDay')
                  : t('plans.prelaunchCheckinThreeDays'))
                : inAppNotice.message}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {isPrelaunch ? (
                <>
                  {t('plans.prelaunchCheckinBody', { date: formatDate(notice.endsAt) })}
                </>
              ) : (
                <>
                  {t('plans.trialEndReminder', { date: formatDate(record.trial_ends_at) })}
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {days != null && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('plans.trialEnds', { date: formatDate(record.trial_ends_at), leftText: days === 0 ? t('plans.endsToday') : t('plans.daysLeftCount', { count: days, unit: days === 1 ? t('plans.day') : t('plans.days') }) })}
        </p>
      )}
      {isPrelaunch && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('plans.prelaunchLine', { count: notice.daysLeft, unit: notice.daysLeft === 1 ? t('plans.day') : t('plans.days'), date: formatDate(notice.endsAt) })}
        </p>
      )}

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {plan.includes.map((line) => (
          <li key={line} className="flex gap-1.5 text-xs leading-snug text-muted-foreground">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {isEssentials
          ? t('plans.mobileIncludedEssentials')
          : t('plans.mobileIncludedBusiness')}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <Link to="/plans" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">
          {t('plans.compareAllPlans')} <ArrowRight className="h-3 w-3" />
        </Link>
        <Link to="/upgrade" className="underline underline-offset-2 hover:text-foreground">
          {t('plans.planAndLimits')}
        </Link>
      </div>
    </div>
  );
}