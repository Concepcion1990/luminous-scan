import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Download, FileSpreadsheet, Plus } from 'lucide-react';
import AlertRuleCard from '@/components/alerts/AlertRuleCard';
import AlertRuleDialog from '@/components/alerts/AlertRuleDialog';
import PlanGate from '@/components/plan/PlanGate';
import StatCard from '@/components/StatCard';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { base44 } from '@/api/client';
import { evaluateRule, loadAlertSource, ALERT_PRESETS } from '@/lib/alerts';
import { downloadCsv, fileSlug, fileStamp, toCsv } from '@/lib/csv';
import { scoped, withBusiness } from '@/lib/scoped';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import { t } from '@/lib/i18n';

// The columns for both download formats — CSV and Excel carry the same rows.
// Labels are getters so they resolve in the active locale at export time,
// not the locale active when this module was first imported (see Layout.jsx).
const ALERT_EXPORT_COLUMNS = [
  { get label() { return t('alerts.exportAlert'); }, value: (row) => row.alert },
  { get label() { return t('alerts.exportProduct'); }, value: (row) => row.product },
  { get label() { return t('alerts.exportDetail'); }, value: (row) => row.detail },
];

export default function Alerts() {
  const { profile, activeId } = useBusiness();
  const { toast } = useToast();
  // In-page mirror of the route-level PlanGate (App.jsx): the page is safe
  // on its own if it is ever rendered without the route gate. While the
  // entitlement is still loading the plan is unknown, so nothing is locked
  // yet — the same fail-open-while-loading shape PlanGate itself uses.
  const { can, isLoading: entitlementLoading } = useEntitlements();
  const [rules, setRules] = useState([]);
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    if (!activeId) {
      setRules([]);
      setSource(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [rulePage, alertSource] = await Promise.all([
      base44.entities.AlertRule.filter(scoped({}, activeId), { sort: 'name', limit: 200 }),
      loadAlertSource(activeId, 180),
    ]);
    setRules(rulePage.items ?? []);
    setSource(alertSource);
    setLoading(false);
  }, [activeId]);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(() => {
    const names = new Set();
    (source?.products ?? []).forEach((product) => {
      const name = (product.category || '').trim();
      if (name) names.add(name);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [source]);

  const evaluations = useMemo(
    () => rules.map((rule) => ({ rule, ...evaluateRule(rule, source) })),
    [rules, source]
  );

  const watching = evaluations.filter((entry) => entry.rule.active !== false);
  const flagged = watching.reduce((sum, entry) => sum + entry.count, 0);
  const tripping = watching.filter((entry) => entry.count > 0).length;
  // One product can trip several alerts, so the unique count is its own figure.
  const distinct = new Set();
  watching.forEach((entry) => entry.items.forEach((item) => distinct.add(item.key)));
  const distinctFlagged = distinct.size;

  const save = async (values) => {
    try {
      if (dialog?.id) await base44.entities.AlertRule.update(dialog.id, values);
      else await base44.entities.AlertRule.create(withBusiness(values, activeId));
      setDialog(null);
      await load();
      toast({ title: dialog?.id ? t('alerts.updated') : t('alerts.created') });
    } catch (error) {
      toast({
        title: t('alerts.saveFailed'),
        description: error?.message || t('alerts.tryAgain'),
        variant: 'destructive',
      });
    }
  };

  const addPreset = async (preset) => {
    try {
      await base44.entities.AlertRule.create(
        withBusiness({ ...preset, active: true, location_id: '', category: '' }, activeId)
      );
      await load();
    } catch (error) {
      toast({
        title: t('alerts.addFailed'),
        description: error?.message || t('alerts.tryAgain'),
        variant: 'destructive',
      });
    }
  };

  const toggle = async (rule) => {
    try {
      await base44.entities.AlertRule.update(rule.id, { active: rule.active === false });
      await load();
    } catch (error) {
      toast({
        title: t('alerts.toggleFailed'),
        description: error?.message || t('alerts.tryAgain'),
        variant: 'destructive',
      });
    }
  };

  const remove = async (rule) => {
    if (!window.confirm(t('alerts.deleteConfirm', { name: rule.name }))) return;
    try {
      await base44.entities.AlertRule.delete(rule.id);
      await load();
      toast({ title: t('alerts.deleted') });
    } catch (error) {
      toast({
        title: t('alerts.deleteFailed'),
        description: error?.message || t('alerts.tryAgain'),
        variant: 'destructive',
      });
    }
  };

  const exportLines = () => {
    const lines = [];
    watching.forEach((entry) => {
      entry.items.forEach((item) => {
        lines.push({ alert: entry.rule.name, product: item.title, detail: item.detail });
      });
    });
    return lines;
  };

  const runExport = () => {
    if (!flagged) return;
    const lines = exportLines();
    const csv = toCsv(ALERT_EXPORT_COLUMNS, lines);
    const filename = `${fileSlug(profile.name) || 'business'}-alerts-${fileStamp()}.csv`;
    downloadCsv(filename, csv);
    toast({ title: t('alerts.exported'), description: t('alerts.exportedDescription', { count: lines.length }) });
  };

  // Same CSV + Excel choice as Reports — Alerts used to offer only the CSV.
  const downloadExcel = async () => {
    if (!flagged) return;
    try {
      const lines = exportLines();
      const { downloadSheets } = await import('@/lib/xlsx');
      const filename = downloadSheets(
        [{ name: t('alerts.sheetName'), columns: ALERT_EXPORT_COLUMNS, rows: lines }],
        `${fileSlug(profile.name) || 'business'}-alerts-${fileStamp()}.xlsx`
      );
      toast({
        title: t('alerts.exported'),
        description: t('alerts.exportedExcelDescription', { count: lines.length, filename }),
      });
    } catch {
      toast({
        title: t('alerts.exportFailed'),
        description: t('alerts.exportBuildFailed'),
        variant: 'destructive',
      });
    }
  };

  if (!entitlementLoading && !can('alerts')) return <PlanGate feature="alerts" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('alerts.eyebrow', { name: profile.name })}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('alerts.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('alerts.intro')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadExcel} disabled={!flagged}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            {t('alerts.downloadExcel')}
          </Button>
          <Button variant="outline" onClick={runExport} disabled={!flagged}>
            <Download className="mr-1.5 h-4 w-4" />
            {t('alerts.downloadCsv')}
          </Button>
          <Button onClick={() => setDialog({})} disabled={!activeId}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('alerts.newAlert')}
          </Button>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">{t('alerts.checkingStock')}</p>
      )}

      {!loading && !activeId && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          {t('alerts.createBusinessFirst')}
        </p>
      )}

      {!loading && activeId && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t('alerts.watching')} value={watching.length} hint={t('alerts.activeAlertsHint')} />
            <StatCard
              label={t('alerts.flaggedProducts')}
              value={distinctFlagged}
              tone={distinctFlagged ? 'warn' : 'default'}
              hint={t('alerts.flaggedHint', { count: flagged, s: flagged === 1 ? '' : 'es' })}
            />
            <StatCard
              label={t('alerts.trippingNow')}
              value={tripping}
              tone={tripping ? 'warn' : 'ok'}
              hint={t('alerts.quietHint', { count: watching.length - tripping })}
            />
            <StatCard
              label={t('alerts.alertsSetUp')}
              value={rules.length}
              hint={t('alerts.includingPaused')}
            />
          </div>

          {rules.length === 0 ? (
            <section className="rounded-xl border border-border bg-card p-6 text-center">
              <BellRing className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{t('alerts.noAlertsYet')}</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                {t('alerts.noAlertsHint')}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {ALERT_PRESETS.map((preset) => (
                  <Button key={preset.kind} size="sm" variant="outline" onClick={() => addPreset(preset)}>
                    {preset.name}
                  </Button>
                ))}
              </div>
            </section>
          ) : (
            <div className="space-y-3">
              {evaluations.map((entry) => (
                <AlertRuleCard
                  key={entry.rule.id}
                  rule={entry.rule}
                  items={entry.items}
                  onEdit={(rule) => setDialog(rule)}
                  onDelete={remove}
                  onToggle={toggle}
                />
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {t('alerts.footerNote')}
          </p>
        </>
      )}

      <AlertRuleDialog
        open={Boolean(dialog)}
        rule={dialog?.id ? dialog : null}
        locations={source?.locations ?? []}
        categories={categories}
        onClose={() => setDialog(null)}
        onSave={save}
      />
    </div>
  );
}