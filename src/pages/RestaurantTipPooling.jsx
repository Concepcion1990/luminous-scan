import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, Printer, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBusiness } from '@/hooks/useBusiness';
import { formatMoney } from '@/lib/inventory';
import { resolveDocStyle } from '@/lib/docStyle';
import {
  createTipReportPeriod,
  deleteTipReport,
  deleteTipReportPeriod,
  deleteTipRun,
  fetchTipYear,
  fetchTipsOverview,
  previewTipSplit,
  saveTipReport,
  saveTipRun,
  saveTipSettings,
  setTipRunPublished,
} from '@/lib/tipPooling';
import TipPoolingDoc from '@/components/print/TipPoolingDoc';
import { t } from '@/lib/i18n';

/**
 * Tip pooling + tip reporting records (plan release 373,
 * Nov 26, 2026): Business-only, Restaurant Corner, Team &
 * Place shelf. The owner sets the pool shape — by hours, by
 * role percentage, or by points — and the app splits the
 * pool from the schedule + clock hours already in it, shows
 * each person their share, and feeds the numbers into the
 * payroll preview. The records rider keeps the year record
 * — per person, per period, tips reported — with the 8%
 * arithmetic run into form-ready totals.
 *
 * OWNER-ONLY MONEY: the setup, the shares and the records
 * are the owner's numbers. A member who opens this page
 * sees only their own shares, and only for runs the owner
 * has published. The app calculates what the owner sets up
 * and never advises on tip law; the records assemble
 * totals and file nothing.
 */
export default function RestaurantTipPooling() {
  const { activeId, record, profile } = useBusiness();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState('');
  const [method, setMethod] = useState('hours');
  const [rolePcts, setRolePcts] = useState({});
  const [points, setPoints] = useState({});
  const [period, setPeriod] = useState({ start: '', end: '' });
  const [poolAmount, setPoolAmount] = useState('');
  const [preview, setPreview] = useState(null);
  const [printRunId, setPrintRunId] = useState(null);
  const [periodForm, setPeriodForm] = useState({ start: '', end: '', gross: '', method: 'hours' });
  const [reportForms, setReportForms] = useState({});
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [yearRecord, setYearRecord] = useState(null);
  const [saving, setSaving] = useState(false);
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const money = useCallback(
    (value) => formatMoney(value, record?.currency, 2),
    [record?.currency],
  );

  const load = useCallback(async () => {
    if (!activeId) return;
    const view = await fetchTipsOverview(activeId);
    setOverview(view);
    if (view.isOwner && view.settings) {
      setMethod(view.settings.method || 'hours');
      setRolePcts(view.settings.role_percentages || {});
      setPoints(view.settings.points || {});
    }
    setLoading(false);
  }, [activeId]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const fail = () => setError(t('tipPooling.saveFailed'));
  const done = async () => {
    setFlash(t('tipPooling.saved'));
    await load();
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await saveTipSettings(activeId, { method, role_percentages: rolePcts, points });
      await done();
    } catch { fail(); } finally { setSaving(false); }
  };

  const splitBody = () => ({
    period_start: period.start,
    period_end: period.end,
    pool_amount: poolAmount,
    method,
    settings: { method, role_percentages: rolePcts, points },
  });

  const doPreview = async () => {
    setSaving(true);
    try {
      setPreview(await previewTipSplit(activeId, splitBody()));
    } catch { fail(); } finally { setSaving(false); }
  };

  const doSaveRun = async () => {
    setSaving(true);
    try {
      await saveTipRun(activeId, splitBody());
      setPreview(null);
      await done();
    } catch { fail(); } finally { setSaving(false); }
  };

  const togglePublish = async (run) => {
    try {
      await setTipRunPublished(activeId, run.id, !run.published);
      await load();
    } catch { fail(); }
  };

  const removeRun = async (run) => {
    try {
      await deleteTipRun(activeId, run.id);
      await load();
    } catch { fail(); }
  };

  const createPeriod = async () => {
    setSaving(true);
    try {
      await createTipReportPeriod(activeId, {
        period_start: periodForm.start,
        period_end: periodForm.end,
        gross_receipts: periodForm.gross === '' ? 0 : periodForm.gross,
        allocation_method: periodForm.method,
      });
      await done();
    } catch { fail(); } finally { setSaving(false); }
  };

  const submitReport = async (periodId) => {
    const form = reportForms[periodId];
    if (!form?.staffId) return;
    setSaving(true);
    try {
      await saveTipReport(activeId, periodId, form.staffId, {
        tips_reported: form.tips,
        gross_receipts: form.gross === '' ? 0 : form.gross,
        hours: form.hours === '' ? undefined : form.hours,
        allocation_amount: form.allocation === '' ? null : form.allocation,
      });
      await done();
    } catch { fail(); } finally { setSaving(false); }
  };

  const loadYear = async () => {
    try {
      const data = await fetchTipYear(activeId, year);
      setYearRecord(data.record);
      setPrintRunId('year');
    } catch { fail(); }
  };

  if (loading) return <div className="mx-auto w-full max-w-5xl p-4 sm:p-6" />;
  const isOwner = Boolean(overview?.isOwner);
  const people = overview?.people || [];
  const roles = [...new Set(people.map((p) => p.role_name).filter(Boolean))];
  const runs = overview?.runs || [];
  const reportPeriods = overview?.reportPeriods || [];
  const printRun = runs.find((entry) => entry.run.id === printRunId);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="no-print">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Coins className="h-6 w-6" /> {t('tipPooling.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('tipPooling.subtitle')}</p>
        {isOwner ? <p className="mt-2 text-xs text-muted-foreground">{t('tipPooling.ownerOnlyNote')}</p> : null}
      </header>

      {flash ? <p className="no-print rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">{flash}</p> : null}
      {error ? <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}

      {!isOwner ? (
        <section className="no-print rounded-xl border border-border p-4">
          <h2 className="font-medium">{t('tipPooling.mySharesTitle')}</h2>
          {(overview?.mine || []).length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('tipPooling.mySharesEmpty')}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {(overview?.mine || []).map((share) => (
                <li key={share.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{t('tipPooling.periodLine', { start: String(share.period_start).slice(0, 10), end: String(share.period_end).slice(0, 10) })}</span>
                  <span>{money(share.share_amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <section className="no-print rounded-xl border border-border p-4">
            <h2 className="font-medium">{t('tipPooling.settingsTitle')}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {[
                ['hours', 'tipPooling.methodHours'],
                ['role', 'tipPooling.methodRole'],
                ['points', 'tipPooling.methodPoints'],
              ].map(([value, labelKey]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="tip-method" checked={method === value} onChange={() => setMethod(value)} />
                  {t(labelKey)}
                </label>
              ))}
            </div>
            {method === 'role' ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {roles.map((role) => (
                  <div key={role} className="space-y-1">
                    <Label>{t('tipPooling.rolePctLabel', { role })}</Label>
                    <Input
                      type="number" min="0" max="100" step="0.01"
                      value={rolePcts[role] ?? ''}
                      onChange={(e) => setRolePcts((cur) => ({ ...cur, [role]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            {method === 'points' ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {people.map((person) => (
                  <div key={person.id} className="space-y-1">
                    <Label>{t('tipPooling.pointsLabel', { name: person.full_name })}</Label>
                    <Input
                      type="number" min="0" step="0.01"
                      value={points[person.id] ?? ''}
                      onChange={(e) => setPoints((cur) => ({ ...cur, [person.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            <Button className="mt-3" size="sm" onClick={saveSettings} disabled={saving}>{t('tipPooling.saveSettings')}</Button>
          </section>

          <section className="no-print rounded-xl border border-border p-4">
            <h2 className="font-medium">{t('tipPooling.splitTitle')}</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t('tipPooling.periodStartLabel')}</Label>
                <Input type="date" value={period.start} onChange={(e) => setPeriod((cur) => ({ ...cur, start: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('tipPooling.periodEndLabel')}</Label>
                <Input type="date" value={period.end} onChange={(e) => setPeriod((cur) => ({ ...cur, end: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('tipPooling.poolAmountLabel')}</Label>
                <Input type="number" min="0" step="0.01" value={poolAmount} onChange={(e) => setPoolAmount(e.target.value)} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={doPreview} disabled={saving}>{t('tipPooling.previewButton')}</Button>
              <Button size="sm" variant="outline" onClick={doSaveRun} disabled={saving}>{t('tipPooling.saveRunButton')}</Button>
            </div>
            {preview ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">{t('tipPooling.colPerson')}</th>
                      <th className="py-1 pr-3 font-medium">{t('tipPooling.colRole')}</th>
                      <th className="py-1 pr-3 font-medium">{t('tipPooling.colHours')}</th>
                      <th className="py-1 font-medium">{t('tipPooling.colShare')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(preview.split?.shares || []).map((share) => (
                      <tr key={share.staff_member_id} className="border-t border-border">
                        <td className="py-1.5 pr-3 font-medium">{share.person_name}</td>
                        <td className="py-1.5 pr-3">{share.role_name}</td>
                        <td className="py-1.5 pr-3">{share.hours}</td>
                        <td className="py-1.5">{money(share.share_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.split && preview.split.totalWeight === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{t('tipPooling.unallocatedNote')}</p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="no-print rounded-xl border border-border p-4">
            <h2 className="font-medium">{t('tipPooling.runsTitle')}</h2>
            {runs.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('tipPooling.noRuns')}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {runs.map(({ run, shares }) => (
                  <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-sm last:border-0">
                    <span>
                      {t('tipPooling.periodLine', { start: run.period_start, end: run.period_end })}
                      {` · ${money(run.pool_amount)} · ${shares.length} ${t('tipPooling.colPerson')}`}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {run.published ? t('tipPooling.publishedLabel') : t('tipPooling.notPublishedLabel')}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <Button size="sm" variant="outline" onClick={() => togglePublish(run)}>
                        {run.published ? t('tipPooling.unpublishButton') : t('tipPooling.publishButton')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setPrintRunId(run.id); setYearRecord(null); }}>
                        <Printer className="mr-1.5 h-4 w-4" /> {t('tipPooling.printButton')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeRun(run)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="no-print rounded-xl border border-border p-4">
            <h2 className="font-medium">{t('tipPooling.recordsTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('tipPooling.recordsSubtitle')}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label>{t('tipPooling.periodStartLabel')}</Label>
                <Input type="date" value={periodForm.start} onChange={(e) => setPeriodForm((cur) => ({ ...cur, start: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('tipPooling.periodEndLabel')}</Label>
                <Input type="date" value={periodForm.end} onChange={(e) => setPeriodForm((cur) => ({ ...cur, end: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('tipPooling.grossReceiptsLabel')}</Label>
                <Input type="number" min="0" step="0.01" value={periodForm.gross} onChange={(e) => setPeriodForm((cur) => ({ ...cur, gross: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('tipPooling.allocMethodLabel')}</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                  value={periodForm.method}
                  onChange={(e) => setPeriodForm((cur) => ({ ...cur, method: e.target.value }))}
                >
                  <option value="gross_receipts">{t('tipPooling.allocGrossReceipts')}</option>
                  <option value="hours">{t('tipPooling.allocHours')}</option>
                  <option value="good_faith">{t('tipPooling.allocGoodFaith')}</option>
                </select>
              </div>
            </div>
            <Button className="mt-3" size="sm" onClick={createPeriod} disabled={saving}>{t('tipPooling.newPeriodButton')}</Button>

            {reportPeriods.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t('tipPooling.emptyRecords')}</p>
            ) : (
              <div className="mt-4 space-y-4">
                {reportPeriods.map(({ period: rp, reports, totals }) => {
                  const form = reportForms[rp.id] || { staffId: '', tips: '', gross: '', hours: '', allocation: '' };
                  const setForm = (patch) => setReportForms((cur) => ({ ...cur, [rp.id]: { ...form, ...patch } }));
                  return (
                    <div key={rp.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium">
                          {t('tipPooling.periodLine', { start: rp.period_start, end: rp.period_end })}
                        </p>
                        <Button size="sm" variant="ghost" onClick={async () => { try { await deleteTipReportPeriod(activeId, rp.id); await load(); } catch { fail(); } }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {`${t('tipPooling.grossReceiptsLabel')}: ${money(totals.gross_receipts)} · ${t('tipPooling.eightPercentLabel')}: ${money(totals.eight_percent)} · ${t('tipPooling.totalReportedLabel')}: ${money(totals.total_reported)} · ${t('tipPooling.shortfallLabel')}: ${money(totals.shortfall)} · ${t('tipPooling.totalAllocatedLabel')}: ${money(totals.total_allocated)}`}
                      </p>
                      <ul className="mt-2 space-y-1 text-sm">
                        {reports.map((report) => (
                          <li key={report.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span>{report.person_name}</span>
                            <span>{`${t('tipPooling.tipsReportedLabel')}: ${money(report.tips_reported)} · ${money(report.gross_receipts)} · ${report.hours} ${t('tipPooling.hoursLabel')}`}</span>
                            <Button size="sm" variant="ghost" onClick={async () => { try { await deleteTipReport(activeId, rp.id, report.staff_member_id); await load(); } catch { fail(); } }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 grid gap-3 sm:grid-cols-5">
                        <div className="space-y-1">
                          <Label>{t('tipPooling.colPerson')}</Label>
                          <select
                            className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
                            value={form.staffId}
                            onChange={(e) => setForm({ staffId: e.target.value })}
                          >
                            <option value="" />
                            {people.map((person) => (
                              <option key={person.id} value={person.id}>{person.full_name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label>{t('tipPooling.tipsReportedLabel')}</Label>
                          <Input type="number" min="0" step="0.01" value={form.tips} onChange={(e) => setForm({ tips: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label>{t('tipPooling.personGrossLabel')}</Label>
                          <Input type="number" min="0" step="0.01" value={form.gross} onChange={(e) => setForm({ gross: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label>{t('tipPooling.hoursLabel')}</Label>
                          <Input type="number" min="0" step="0.01" value={form.hours} onChange={(e) => setForm({ hours: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label>{t('tipPooling.allocationInputLabel')}</Label>
                          <Input type="number" min="0" step="0.01" value={form.allocation} onChange={(e) => setForm({ allocation: e.target.value })} />
                        </div>
                      </div>
                      <Button className="mt-2" size="sm" variant="outline" onClick={() => submitReport(rp.id)} disabled={saving}>
                        {t('tipPooling.saveReportButton')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>{t('tipPooling.yearTitle', { year })}</Label>
                <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
              <Button size="sm" variant="outline" onClick={loadYear}>{t('tipPooling.yearTitle', { year })}</Button>
              {yearRecord ? (
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <Printer className="mr-1.5 h-4 w-4" /> {t('tipPooling.printButton')}
                </Button>
              ) : null}
            </div>
            {yearRecord ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {`${t('tipPooling.grossReceiptsLabel')}: ${money(yearRecord.gross_receipts)} · ${t('tipPooling.eightPercentLabel')}: ${money(yearRecord.eight_percent)} · ${t('tipPooling.totalReportedLabel')}: ${money(yearRecord.total_reported)} · ${t('tipPooling.shortfallLabel')}: ${money(yearRecord.shortfall)} · ${t('tipPooling.totalAllocatedLabel')}: ${money(yearRecord.total_allocated)}`}
              </p>
            ) : null}
          </section>

          {printRun ? (
            <section>
              <TipPoolingDoc run={printRun.run} shares={printRun.shares} business={record} docStyle={docStyle} />
            </section>
          ) : null}
          {yearRecord && printRunId === 'year' ? (
            <section>
              <TipPoolingDoc yearRecord={yearRecord} business={record} docStyle={docStyle} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
