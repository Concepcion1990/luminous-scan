import { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import LaborWatchPanel from '@/components/LaborWatchPanel';
import { t } from '@/lib/i18n';

/**
 * Labor target (plan release 374, Nov 26, 2026):
 * Business-only, Restaurant Corner, Team & Place shelf.
 * While the owner builds the week, the projected labor
 * cost and labor % show live against their target, riding
 * the schedule and pay rates already in the app. The
 * warnings on this page are the general engine's (both
 * plans, in the workforce tools); the target framing on
 * this page is the restaurant face. Every number is the
 * owner's — their target, their expected sales, their
 * watch lines; the app watches and legislates nothing.
 */
export default function RestaurantLaborTarget() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="no-print">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Gauge className="h-6 w-6" /> {t('nav.laborTarget')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('laborWatch.subtitle')}</p>
      </header>
      {activeId ? (
        <LaborWatchPanel businessId={activeId} business={record} docStyle={docStyle} showTarget />
      ) : null}
    </div>
  );
}
