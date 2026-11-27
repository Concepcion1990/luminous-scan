import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, ClipboardCheck, Plus } from 'lucide-react';
import SafetyLogDialog from '@/components/restaurant/SafetyLogDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { formatDateTime } from '@/lib/dates';
import { SAFETY_LOG_KINDS } from '@/lib/foodSafety';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * Cooling, reheating and sanitizer logs (plan release 370,
 * Nov 26, 2026): the temperature log's siblings, in the same
 * shape — what was checked, the reading, in or out of range,
 * who took it and when, and the corrective action under any
 * reading that missed. Anyone on the team can log a check.
 */
export default function RestaurantSafetyLogs() {
  const { activeId } = useBusiness();
  const [logs, setLogs] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const [kindFilter, setKindFilter] = useState('all');

  useEffect(() => {
    (async () => {
      const [logPage, locPage] = await Promise.all([
        base44.entities.SafetyLog.filter(scoped({}, activeId), { sort: '-created_date', limit: 300 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setLogs(logPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const shown = kindFilter === 'all' ? logs : logs.filter((log) => log.kind === kindFilter);

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/safety-logs" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('foodSafety.logs.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('foodSafety.logs.subtitle')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('foodSafety.logs.newButton')}
        </Button>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {['all', ...SAFETY_LOG_KINDS].map((k) => (
          <Button
            key={k}
            variant={kindFilter === k ? 'default' : 'outline'}
            size="sm"
            onClick={() => setKindFilter(k)}
          >
            {k === 'all' ? t('foodSafety.logs.allKinds') : t(`foodSafety.logs.kind.${k}`)}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <ClipboardCheck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('foodSafety.logs.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('foodSafety.logs.emptyBody')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2 font-medium">{t('ops.tempLogs.colWhen')}</th>
                <th className="px-3 py-2 font-medium">{t('foodSafety.packet.colKind')}</th>
                <th className="px-3 py-2 font-medium">{t('foodSafety.logs.colItem')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('ops.tempLogs.colReading')}</th>
                <th className="px-3 py-2 font-medium">{t('ops.tempLogs.colRange')}</th>
                <th className="px-3 py-2 font-medium">{t('ops.tempLogs.colBy')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((log) => (
                <tr key={log.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">{log.created_date ? formatDateTime(log.created_date) : ''}</td>
                  <td className="px-3 py-2">{t(`foodSafety.logs.kind.${log.kind}`)}</td>
                  <td className="px-3 py-2">
                    {log.subject_name}
                    {log.location_name ? <span className="block text-xs text-muted-foreground">{log.location_name}</span> : null}
                    {log.corrective_action ? (
                      <span className="block text-xs text-muted-foreground">
                        {t('ops.tempLogs.correctivePrefix')}: {log.corrective_action}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {log.reading}{log.unit === 'ppm' ? ' ppm' : `°${log.unit || 'F'}`}
                  </td>
                  <td className="px-3 py-2">
                    {log.in_range ? (
                      <span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">{t('ops.tempLogs.inRange')}</span>
                    ) : (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{t('ops.tempLogs.outOfRange')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{log.user_name || log.created_by || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SafetyLogDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        locations={locations}
        onSaved={(text) => {
          setFlash(text);
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}
