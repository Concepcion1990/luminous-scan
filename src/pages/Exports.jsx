import { Link } from 'react-router-dom';
import { FileDown, Lock, ShieldAlert } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useBusiness } from '@/hooks/useBusiness';
import { EXPORTS } from '@/lib/exportData';
import ExportCard from '@/components/exports/ExportCard';
import BackupCard from '@/components/exports/BackupCard';
import { Button } from '@/components/ui/button';
import useEntitlements from '@/hooks/useEntitlements';

export default function Exports() {
  const { profile, activeId } = useBusiness();
  // In-page entitlement guard: the route is PlanGate-locked too, but this
  // page must be safe on its own if it is ever rendered without the gate.
  const { can, isLoading: entitlementLoading } = useEntitlements();
  const locked = !entitlementLoading && !can('exports');

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('exports.eyebrow')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('exports.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t('exports.subtitleStart')}{' '}
          <span className="font-medium text-foreground">{profile.name}</span>
          {t('exports.subtitleRest')}
        </p>
      </div>

      {!activeId && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          {t('exports.createBusinessFirst')}
        </p>
      )}

      {locked && (
        <div className="mx-auto max-w-xl py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">{t('exports.lockedTitle')}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t('exports.lockedDesc')}
          </p>
          <Button asChild className="mt-5">
            <Link to="/upgrade">{t('exports.seeBusiness')}</Link>
          </Button>
        </div>
      )}

      {!locked && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {EXPORTS.map((dataset) => (
              <ExportCard
                key={dataset.id}
                dataset={dataset}
                businessId={activeId}
                businessName={profile.name}
                profile={profile}
              />
            ))}
          </div>

          <BackupCard businessId={activeId} businessName={profile.name} profile={profile} />
        </>
      )}

      <div className="rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground sm:p-5">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <FileDown className="h-3.5 w-3.5" /> {t('exports.whatTheseAre')}
        </p>
        <p className="mt-2">{t('exports.about1')}</p>
        <p className="mt-2">{t('exports.about2')}</p>
        <p className="mt-2">{t('exports.about3')}</p>
        <p className="mt-2">{t('exports.about4')}</p>
        <p className="mt-2">{t('exports.about5')}</p>
      </div>
    </div>
  );
}