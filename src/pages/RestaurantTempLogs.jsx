import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, Plus, Thermometer } from 'lucide-react';
import TempLogDialog from '@/components/restaurant/TempLogDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { formatDateTime } from '@/lib/dates';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * Temperature logs (release 361, Nov 23, 2026): every
 * reading, who took it and when, and whether it sat inside
 * the unit's safe range. An out-of-range reading carries the
 * corrective action taken. Anyone on the team can log a
 * reading.
 */
export default function RestaurantTempLogs() {
  const { activeId } = useBusiness();
  const [logs, setLogs] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    (async () => {
      const [logPage, locPage] = await Promise.all([
        base44.entities.TempLog.filter(scoped({}, activeId), { sort: '-created_date', limit: 300 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setLogs(logPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/temp-logs" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('ops.tempLogs.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('ops.tempLogs.subtitle')}</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('ops.tempLogs.newButton')}
        </Button>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <Thermometer className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('ops.tempLogs.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('ops.tempLogs.emptyBody')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2 font-medium">{t('ops.tempLogs.colWhen')}</th>
                <th className="px-3 py-2 font-medium">{t('ops.tempLogs.colUnit')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('ops.tempLogs.colReading')}</th>
                <th className="px-3 py-2 font-medium">{t('ops.tempLogs.colRange')}</th>
                <th className="px-3 py-2 font-medium">{t('ops.tempLogs.colBy')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">{log.created_date ? formatDateTime(log.created_date) : ''}</td>
                  <td className="px-3 py-2">
                    {log.unit_name}
                    {log.location_name ? <span className="block text-xs text-muted-foreground">{log.location_name}</span> : null}
                    {log.corrective_action ? (
                      <span className="block text-xs text-muted-foreground">
                        {t('ops.tempLogs.correctivePrefix')}: {log.corrective_action}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {log.temperature}°{log.scale || 'F'}
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

      <TempLogDialog
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
