import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Download, FileDown, FileSpreadsheet, Files, Loader2, Lock, TriangleAlert } from 'lucide-react';
import { t } from '@/lib/i18n';
import StatCard from '@/components/StatCard';
import ReportControls from '@/components/reports/ReportControls';
import ReportTable from '@/components/reports/ReportTable';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { downloadCsv, fileSlug, fileStamp, toCsv } from '@/lib/csv';
import { formatMoney } from '@/lib/inventory';
import { apiDownload } from '@/api/client';
import {
  buildReport,
  loadReportSource,
  periodRange,
  reportColumns,
  reportDefinition,
  MOVEMENT_CAP,
  PERIODS,
  REPORT_TYPES,
} from '@/lib/reports';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';

const INITIAL = {
  reportId: 'stock',
  groupBy: 'location',
  period: '30',
  from: '',
  to: '',
  locationId: '',
  category: '',
};

export default function Reports() {
  const { profile, activeId } = useBusiness();
  const { toast } = useToast();
  // In-page entitlement guard: the route is PlanGate-locked too, but this
  // page must be safe on its own if it is ever rendered without the gate.
  const { can, isLoading: entitlementLoading } = useEntitlements();
  const [filters, setFilters] = useState(INITIAL);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!activeId) {
      setSource({ products: [], levels: [], locations: [], movements: [] });
      setLoading(false);
      return () => {
        alive = false;
      };
    }
    setLoading(true);
    loadReportSource(activeId)
      .then((data) => {
        if (alive) setSource(data);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeId]);

  const categories = useMemo(() => {
    const names = new Set();
    (source?.products ?? []).forEach((product) => {
      const name = (product.category || '').trim();
      if (name) names.add(name);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [source]);

  const report = useMemo(() => {
    if (!source) return null;
    const definition = reportDefinition(filters.reportId);
    const { from, to } = periodRange(filters.period, filters.from, filters.to);
    return buildReport({
      reportId: filters.reportId,
      groupBy: filters.groupBy,
      source,
      from: definition.snapshot ? '' : from,
      to: definition.snapshot ? '' : to,
      locationId: filters.locationId,
      category: filters.category,
    });
  }, [source, filters]);

  const periodCaption = useMemo(() => {
    if (!report || report.report.snapshot) return t('reports.asOfToday');
    if (filters.period === 'custom') {
      if (!filters.from && !filters.to) return t('reports.anyDate');
      return t('reports.periodRange', {
        from: filters.from || t('reports.earliest'),
        to: filters.to || t('reports.today'),
      });
    }
    return PERIODS.find((preset) => preset.id === filters.period)?.label || '';
  }, [report, filters]);

  const runExport = () => {
    if (!report || !report.rows.length) return;
    const csv = toCsv(reportColumns(report.valueLabel), report.rows);
    const filename = `${fileSlug(profile.name) || 'business'}-${report.report.id}-${fileStamp()}.csv`;
    downloadCsv(filename, csv);
    toast({
      title: t('reports.exported'),
      description: t('reports.exportedRows', {
        count: report.rows.length,
        s: report.rows.length === 1 ? '' : 's',
        filename,
      }),
    });
  };

  const downloadExcel = async () => {
    if (!report || !report.rows.length) return;
    const { downloadSheets } = await import('@/lib/xlsx');
    const filename = downloadSheets(
      [{ name: report.report.label, columns: reportColumns(report.valueLabel), rows: report.rows }],
      `${fileSlug(profile.name) || 'business'}-${report.report.id}-${fileStamp()}.xlsx`
    );
    toast({
      title: t('reports.exported'),
      description: t('reports.exportedRows', {
        count: report.rows.length,
        s: report.rows.length === 1 ? '' : 's',
        filename,
      }),
    });
  };

  // This report as a server-built PDF (T5): the same rows the
  // server report endpoint counted, so the PDF matches the page and
  // the export. Business-only, enforced server-side.
  const downloadPdf = async () => {
    if (!report || !activeId) return;
    const { from, to } = periodRange(filters.period, filters.from, filters.to);
    const params = new URLSearchParams({
      type: filters.reportId,
      groupBy: filters.groupBy,
      from: report.report.snapshot ? '' : from,
      to: report.report.snapshot ? '' : to,
      locationId: filters.locationId,
      category: filters.category,
    });
    try {
      const { blob, filename } = await apiDownload(
        `/api/businesses/${activeId}/print/report?${params.toString()}`,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({ title: t('reports.exported'), description: t('reports.savedAs', { filename }) });
    } catch {
      toast({
        title: t('reports.exportFailed'),
        description: t('reports.exportFailedDesc'),
        variant: 'destructive',
      });
    }
  };

  // Every report in one workbook, one sheet each, keeping the filters on screen.
  const downloadAll = async () => {
    if (!source) return;
    const { downloadSheets } = await import('@/lib/xlsx');
    const { from, to } = periodRange(filters.period, filters.from, filters.to);
    const sheets = REPORT_TYPES.map((definition) => {
      const built = buildReport({
        reportId: definition.id,
        groupBy: definition.groups.includes(filters.groupBy) ? filters.groupBy : definition.defaultGroup,
        source,
        from: definition.snapshot ? '' : from,
        to: definition.snapshot ? '' : to,
        locationId: filters.locationId,
        category: filters.category,
      });
      return {
        name: definition.label,
        columns: reportColumns(built.valueLabel),
        rows: built.rows,
      };
    });

    const rows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    if (!rows) {
      toast({
        title: t('reports.nothingToDownload'),
        description: t('reports.nothingToDownloadDesc'),
        variant: 'destructive',
      });
      return;
    }

    const filename = downloadSheets(
      sheets,
      `${fileSlug(profile.name) || 'business'}-all-reports-${fileStamp()}.xlsx`
    );
    toast({
      title: t('reports.allExported'),
      description: t('reports.allExportedDesc', {
        sheets: sheets.length,
        rows,
        s: rows === 1 ? '' : 's',
        filename,
      }),
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('reports.eyebrow', { name: profile.name })}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('reports.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('reports.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={downloadPdf} disabled={!report?.rows.length}>
            <FileDown className="mr-1.5 h-4 w-4" />
            {t('reports.downloadPdf')}
          </Button>
          <Button variant="outline" onClick={downloadExcel} disabled={!report?.rows.length}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            {t('reports.downloadExcel')}
          </Button>
          <Button variant="outline" onClick={runExport} disabled={!report?.rows.length}>
            <Download className="mr-1.5 h-4 w-4" />
            {t('reports.downloadCsv')}
          </Button>
          <Button onClick={downloadAll} disabled={!source || loading}>
            <Files className="mr-1.5 h-4 w-4" />
            {t('reports.downloadAll')}
          </Button>
        </div>
      </div>

      <ReportControls
        value={filters}
        onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
        locations={source?.locations ?? []}
        categories={categories}
      />

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('reports.readingRecords')}
        </p>
      )}

      {!entitlementLoading && !can('reports') && (
        <div className="mx-auto max-w-xl py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">{t('reports.lockedTitle')}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t('reports.lockedDesc')}
          </p>
          <Button asChild className="mt-5">
            <Link to="/upgrade">{t('reports.seeBusiness')}</Link>
          </Button>
        </div>
      )}

      {!loading && report && !entitlementLoading && can('reports') && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={report.valueLabel}
              value={formatMoney(report.totals.value, profile.currency, 2)}
              hint={periodCaption}
            />
            <StatCard
              label={t('reports.units')}
              value={report.totals.units}
              unit="units"
              hint={t('reports.groupsInView', {
                count: report.rows.length,
                s: report.rows.length === 1 ? '' : 's',
              })}
            />
            <StatCard
              label={report.report.snapshot ? t('reports.stockRecords') : t('reports.movements')}
              value={report.totals.count}
              hint={
                report.report.snapshot ? t('reports.stockRecordsHint') : t('reports.movementsHint')
              }
            />
            <StatCard
              label={t('reports.biggest', { group: report.groupLabel.toLowerCase() })}
              value={report.top ? report.top.units : 0}
              unit="units"
              hint={
                report.top
                  ? `${report.top.label} · ${formatMoney(report.top.value, profile.currency, 2)}`
                  : t('reports.nothingToRank')
              }
            />
          </div>

          <ReportTable report={report} currency={profile.currency} />

          {!!report.missing?.units && (
            <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <span>
                {t('reports.missingMoney', {
                  units: report.missing.units.toLocaleString(),
                  us: report.missing.units === 1 ? '' : 's',
                  label: report.missing.label,
                })}
              </span>
            </p>
          )}

          {source?.movementsCapped && (
            <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <span>
                {t('reports.movementsCapped', { cap: MOVEMENT_CAP.toLocaleString() })}
              </span>
            </p>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
            <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>{t('reports.footnote')}</p>
          </div>
        </>
      )}

      {!loading && !activeId && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          {t('reports.createBusinessFirst')}
        </p>
      )}
    </div>
  );
}