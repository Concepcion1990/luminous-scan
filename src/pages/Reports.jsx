import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Download, FileSpreadsheet, Files, Loader2, Lock, TriangleAlert } from 'lucide-react';
import StatCard from '@/components/StatCard';
import ReportControls from '@/components/reports/ReportControls';
import ReportTable from '@/components/reports/ReportTable';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { downloadCsv, fileSlug, fileStamp, toCsv } from '@/lib/csv';
import { formatMoney } from '@/lib/inventory';
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
    if (!report || report.report.snapshot) return 'As of today';
    if (filters.period === 'custom') {
      if (!filters.from && !filters.to) return 'Any date';
      return `${filters.from || 'earliest'} → ${filters.to || 'today'}`;
    }
    return PERIODS.find((preset) => preset.id === filters.period)?.label || '';
  }, [report, filters]);

  const runExport = () => {
    if (!report || !report.rows.length) return;
    const csv = toCsv(reportColumns(report.valueLabel), report.rows);
    const filename = `${fileSlug(profile.name) || 'business'}-${report.report.id}-${fileStamp()}.csv`;
    downloadCsv(filename, csv);
    toast({
      title: 'Report exported',
      description: `${report.rows.length} row${report.rows.length === 1 ? '' : 's'} saved as ${filename}`,
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
      title: 'Report exported',
      description: `${report.rows.length} row${report.rows.length === 1 ? '' : 's'} saved as ${filename}`,
    });
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
        title: 'Nothing to download',
        description: 'No records match these filters yet.',
        variant: 'destructive',
      });
      return;
    }

    const filename = downloadSheets(
      sheets,
      `${fileSlug(profile.name) || 'business'}-all-reports-${fileStamp()}.xlsx`
    );
    toast({
      title: 'All reports exported',
      description: `${sheets.length} sheets, ${rows} row${rows === 1 ? '' : 's'} saved as ${filename}`,
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {profile.name} · Reports
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Reports</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Pick what to look at, how to group it and over what period. Every figure is counted from your
            own stock and movement records, and the table can be downloaded as a file.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={downloadExcel} disabled={!report?.rows.length}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            Download Excel
          </Button>
          <Button variant="outline" onClick={runExport} disabled={!report?.rows.length}>
            <Download className="mr-1.5 h-4 w-4" />
            Download CSV
          </Button>
          <Button onClick={downloadAll} disabled={!source || loading}>
            <Files className="mr-1.5 h-4 w-4" />
            Download All
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
          <Loader2 className="h-4 w-4 animate-spin" /> Reading your records…
        </p>
      )}

      {!entitlementLoading && !can('reports') && (
        <div className="mx-auto max-w-xl py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">Advanced reports is a Business feature</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Your workspace is on the Essentials plan. Business adds advanced reports, stock
            valuation, unlimited products and staff, suppliers, purchasing, exports and bundles.
          </p>
          <Button asChild className="mt-5">
            <Link to="/upgrade">See what Business includes</Link>
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
              label="Units"
              value={report.totals.units}
              unit="units"
              hint={`${report.rows.length} group${report.rows.length === 1 ? '' : 's'} in this view`}
            />
            <StatCard
              label={report.report.snapshot ? 'Stock records' : 'Movements'}
              value={report.totals.count}
              hint={report.report.snapshot ? 'Location records holding stock' : 'Ledger entries counted'}
            />
            <StatCard
              label={`Biggest ${report.groupLabel.toLowerCase()}`}
              value={report.top ? report.top.units : 0}
              unit="units"
              hint={
                report.top
                  ? `${report.top.label} · ${formatMoney(report.top.value, profile.currency, 2)}`
                  : 'Nothing to rank yet'
              }
            />
          </div>

          <ReportTable report={report} currency={profile.currency} />

          {!!report.missing?.units && (
            <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <span>
                {report.missing.units.toLocaleString()} unit
                {report.missing.units === 1 ? '' : 's'} in this view have no {report.missing.label}{' '}
                recorded. Missing money is never treated as zero — they are left out of the figures
                rather than counted as free. Add the figure on those products and the totals fill in.
              </span>
            </p>
          )}

          {source?.movementsCapped && (
            <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <span>
                Only the newest {MOVEMENT_CAP.toLocaleString()} ledger entries were read, so movements
                older than these are not in the totals. Narrow the period to see exact figures for a
                window.
              </span>
            </p>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
            <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Sales use each product’s current retail price, receipts use the cost recorded when the stock
              arrived, and losses use the current unit cost. Missing money is never treated as zero —
              leave a figure blank until it is known. A report is a view, not a document: nothing is
              written to your records when you run one.
            </p>
          </div>
        </>
      )}

      {!loading && !activeId && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          Create a business first — reports are counted per business.
        </p>
      )}
    </div>
  );
}