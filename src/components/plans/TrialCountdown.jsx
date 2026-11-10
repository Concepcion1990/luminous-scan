import { CalendarClock } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import useEntitlements from '@/hooks/useEntitlements';
import { trialDaysLeft } from '@/lib/entitlements';
import { TRIAL_DAYS } from '@/lib/plans';
import { t } from '@/lib/i18n';

const shortDate = (value) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Bar({ value, note, filled }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5 text-ok" />
          {t('plans.freeTrialLabel')}
        </p>
        <p className="numeric text-lg font-semibold leading-none">{value}</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-ok" style={{ width: `${filled * 100}%` }} />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}

/** No trial running: the offer, with the countdown waiting to start. */
function Offer() {
  return (
    <Bar
      value={t('plans.trialOfferDays', { days: TRIAL_DAYS })}
      note={t('plans.trialOfferNote')}
      filled={0}
    />
  );
}

function Running() {
  const { record, isLoading } = useEntitlements();
  const days = trialDaysLeft(record);
  if (isLoading) return null;
  if (days == null) return <Offer />;

  const used = Math.min(TRIAL_DAYS, Math.max(0, TRIAL_DAYS - days));

  return (
    <Bar
      value={days === 0 ? t('plans.trialEnded') : days === 1 ? t('plans.oneDayLeft') : t('plans.daysLeftCount', { count: days, unit: t('plans.days') })}
      note={
        days === 0
          ? t('plans.trialEndedNote')
          : t('plans.trialRunningNote', { date: shortDate(record.trial_ends_at), used, total: TRIAL_DAYS })
      }
      filled={used / TRIAL_DAYS}
    />
  );
}

/** The trial countdown shown on the introduction and the comparison. */
export default function TrialCountdown() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Running /> : <Offer />;
}