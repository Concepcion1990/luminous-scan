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

// The columns for both download formats — CSV and Excel carry the same rows.
const ALERT_EXPORT_COLUMNS = [
  { label: 'Alert', value: (row) => row.alert },
  { label: 'Product', value: (row) => row.product },
  { label: 'Detail', value: (row) => row.detail },
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
      toast({ title: dialog?.id ? 'Alert updated' : 'Alert created' });
    } catch (error) {
      toast({
        title: 'Could not save the alert',
        description: error?.message || 'Try again.',
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
        title: 'Could not add the alert',
        description: error?.message || 'Try again.',
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
        title: 'Could not change the alert',
        description: error?.message || 'Try again.',
        variant: 'destructive',
      });
    }
  };

  const remove = async (rule) => {
    if (!window.confirm(`Delete the alert “${rule.name}”?`)) return;
    try {
      await base44.entities.AlertRule.delete(rule.id);
      await load();
      toast({ title: 'Alert deleted' });
    } catch (error) {
      toast({
        title: 'Could not delete the alert',
        description: error?.message || 'Try again.',
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
    toast({ title: 'Alert list exported', description: `${lines.length} flagged products` });
  };

  // Same CSV + Excel choice as Reports — Alerts used to offer only the CSV.
  const downloadExcel = async () => {
    if (!flagged) return;
    try {
      const lines = exportLines();
      const { downloadSheets } = await import('@/lib/xlsx');
      const filename = downloadSheets(
        [{ name: 'Alerts', columns: ALERT_EXPORT_COLUMNS, rows: lines }],
        `${fileSlug(profile.name) || 'business'}-alerts-${fileStamp()}.xlsx`
      );
      toast({
        title: 'Alert list exported',
        description: `${lines.length} flagged products saved as ${filename}`,
      });
    } catch {
      toast({
        title: 'Export failed',
        description: 'Could not build the file. Try again.',
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
            {profile.name} · Alerts
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Alerts</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Watch the things that cost you money: stock running low, shelves empty, stock that never
            moves or is never scanned, and products about to expire. Each alert can watch any number of
            locations, one category, or everything.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadExcel} disabled={!flagged}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            Download Excel
          </Button>
          <Button variant="outline" onClick={runExport} disabled={!flagged}>
            <Download className="mr-1.5 h-4 w-4" />
            Download CSV
          </Button>
          <Button onClick={() => setDialog({})} disabled={!activeId}>
            <Plus className="mr-1.5 h-4 w-4" />
            New alert
          </Button>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">Checking your stock…</p>
      )}

      {!loading && !activeId && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          Create a business first — alerts are watched per business.
        </p>
      )}

      {!loading && activeId && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Watching" value={watching.length} hint="Active alerts" />
            <StatCard
              label="Flagged products"
              value={distinctFlagged}
              tone={distinctFlagged ? 'warn' : 'default'}
              hint={`${flagged} match${flagged === 1 ? '' : 'es'} across every active alert`}
            />
            <StatCard
              label="Tripping now"
              value={tripping}
              tone={tripping ? 'warn' : 'ok'}
              hint={`${watching.length - tripping} quiet`}
            />
            <StatCard
              label="Alerts set up"
              value={rules.length}
              hint="Including paused ones"
            />
          </div>

          {rules.length === 0 ? (
            <section className="rounded-xl border border-border bg-card p-6 text-center">
              <BellRing className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No alerts set up yet.</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                Start with one of these, then tune the numbers and narrow them to a location or category.
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
            Alerts are checked whenever this page loads, so they always reflect the stock on the shelf
            right now. They stay inside the app — nothing is emailed or pushed.
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