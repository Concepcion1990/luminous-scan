import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { PackageOpen, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import InspectionPacketDoc from '@/components/print/InspectionPacketDoc';
import { scoped } from '@/lib/scoped';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * The inspection-ready packet (plan release 370, Nov 26,
 * 2026): pick the inspector's date range and one tap prints
 * every log in it — temperature logs, the cooling /
 * reheating / sanitizer logs, and the waste log — as one
 * Studio document in the business's saved style and
 * language. PREVIEW = PRINT: what stands on this page is
 * the paper the inspector gets.
 */
export default function RestaurantInspectionPacket() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState({ tempLogs: [], safetyLogs: [], wasteEntries: [], pestVisits: [], calibrationLogs: [] });
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    (async () => {
      const [tempPage, safetyPage, wastePage, pestPage, calPage] = await Promise.all([
        base44.entities.TempLog.filter(scoped({}, activeId), { sort: '-created_date', limit: 1000 }),
        base44.entities.SafetyLog.filter(scoped({}, activeId), { sort: '-created_date', limit: 1000 }),
        base44.entities.WasteEntry.filter(scoped({}, activeId), { sort: '-created_date', limit: 1000 }),
        base44.entities.PestVisit.filter(scoped({}, activeId), { sort: '-created_date', limit: 1000 }),
        base44.entities.CalibrationLog.filter(scoped({}, activeId), { sort: '-created_date', limit: 1000 }),
      ]);
      setRows({
        tempLogs: tempPage.items ?? [],
        safetyLogs: safetyPage.items ?? [],
        wasteEntries: wastePage.items ?? [],
        pestVisits: pestPage.items ?? [],
        calibrationLogs: calPage.items ?? [],
      });
      setLoading(false);
    })();
  }, [activeId]);

  const inRange = (row) => {
    if (!row.created_date) return false;
    const day = new Date(row.created_date);
    if (!Number.isFinite(day.getTime())) return false;
    const fromDay = new Date(`${from}T00:00:00`);
    const toDay = new Date(`${to}T23:59:59.999`);
    return day >= fromDay && day <= toDay;
  };
  const inVisitRange = (row) => {
    // A pest visit is dated by its visit date when it has
    // one (the day the company came), else by when it was
    // logged — the G-B logs join the packet (Nov 26, 2026).
    const day = String(row.visit_date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day >= from && day <= to;
    return inRange(row);
  };
  const packet = {
    tempLogs: rows.tempLogs.filter(inRange),
    safetyLogs: rows.safetyLogs.filter(inRange),
    wasteEntries: rows.wasteEntries.filter(inRange),
    pestVisits: rows.pestVisits.filter(inVisitRange),
    calibrationLogs: rows.calibrationLogs.filter(inRange),
  };
  const total = packet.tempLogs.length + packet.safetyLogs.length + packet.wasteEntries.length
    + packet.pestVisits.length + packet.calibrationLogs.length;

  const printPacket = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 50);
  };

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/inspection" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('foodSafety.packet.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('foodSafety.packet.subtitle')}</p>
        </div>
        {total > 0 && (
          <Button onClick={printPacket}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('print.printButton')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>{t('foodSafety.packet.fromLabel')}</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>{t('foodSafety.packet.toLabel')}</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <p className="pb-2 text-sm text-muted-foreground">
          {t('foodSafety.packet.count', { count: total })}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <PackageOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{t('foodSafety.packet.empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <InspectionPacketDoc
            tempLogs={packet.tempLogs}
            safetyLogs={packet.safetyLogs}
            wasteEntries={packet.wasteEntries}
            pestVisits={packet.pestVisits}
            calibrationLogs={packet.calibrationLogs}
            business={record}
            docStyle={docStyle}
            fromLabel={from}
            toLabel={to}
          />
        </div>
      )}

      {printing && total > 0 && (
        <div className="print-area hidden print:block">
          <InspectionPacketDoc
            tempLogs={packet.tempLogs}
            safetyLogs={packet.safetyLogs}
            wasteEntries={packet.wasteEntries}
            pestVisits={packet.pestVisits}
            calibrationLogs={packet.calibrationLogs}
            business={record}
            docStyle={docStyle}
            fromLabel={from}
            toLabel={to}
          />
        </div>
      )}
    </div>
  );
}
