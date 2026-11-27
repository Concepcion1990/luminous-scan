import { useCallback, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoney } from '@/lib/inventory';
import { fetchLaborWatch, saveLaborWatchSettings } from '@/lib/laborWarnings';
import { weekdayLabel } from '@/lib/workforce';
import LaborWatchDoc from '@/components/print/LaborWatchDoc';
import { t } from '@/lib/i18n';

/**
 * The labor watch panel (plan release 374, Nov 26, 2026):
 * one panel, two faces. In the general workforce tools
 * (both plans) it shows the owner's watch numbers and the
 * warnings — from the schedule being built and from hours
 * already worked. On the Restaurant Corner's Labor target
 * page (Business-only, showTarget) it also shows the
 * projected labor cost and labor % against the owner's
 * target, and prints the week as a Studio document.
 *
 * Every threshold is owner-set: a blank field means that
 * watch is off. The app watches the owner's numbers; it
 * does not legislate, and a warning never blocks a save.
 */
export function warningText(warning) {
  const name = warning.person_name || '';
  switch (warning.code) {
    case 'overtime_over':
    case 'clock_overtime_over':
      return t('laborWatch.warningOvertimeOver', { name, hours: warning.hours, limit: warning.limit });
    case 'overtime_near':
    case 'clock_overtime_near':
      return t('laborWatch.warningOvertimeNear', { name, hours: warning.hours, limit: warning.limit });
    case 'break':
      return t('laborWatch.warningBreak', { name, hours: warning.hours, limit: warning.limit, day: weekdayLabel(warning.weekday) });
    case 'window':
      return t('laborWatch.warningWindow', { name, day: weekdayLabel(warning.weekday), start: warning.start || '', end: warning.end || '' });
    case 'clock_break':
      return t('laborWatch.warningClockBreak', { name, hours: warning.hours, date: warning.date || '', minutes: warning.minutes });
    default:
      return name;
  }
}

const FIELDS = [
  ['overtime_hours', 'laborWatch.overtimeLabel', 'number'],
  ['warn_within_hours', 'laborWatch.warnWithinLabel', 'number'],
  ['break_after_hours', 'laborWatch.breakAfterLabel', 'number'],
  ['break_minutes', 'laborWatch.breakMinutesLabel', 'number'],
  ['window_start', 'laborWatch.windowStartLabel', 'time'],
  ['window_end', 'laborWatch.windowEndLabel', 'time'],
];

export default function LaborWatchPanel({ businessId, business, docStyle, showTarget = false }) {
  const [view, setView] = useState(null);
  const [form, setForm] = useState({});
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    const data = await fetchLaborWatch(businessId);
    setView(data);
    if (data.settings) {
      const next = {};
      for (const key of [...FIELDS.map(([k]) => k), 'labor_target_pct', 'expected_sales']) {
        next[key] = data.settings[key] === null || data.settings[key] === undefined ? '' : String(data.settings[key]);
      }
      setForm(next);
    }
  }, [businessId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  if (!view) return null;
  const isOwner = Boolean(view.isOwner);
  const targetFace = Boolean(showTarget && view.hasLaborTarget);
  const week = view.week || { people: [], warnings: [], totals: {} };
  const allWarnings = [...(week.warnings || []), ...(view.clockWarnings || [])];
  const money = (value) => formatMoney(value, business?.currency, 2);

  const save = async () => {
    setSaving(true);
    try {
      const body = {};
      for (const [key] of FIELDS) body[key] = form[key] === '' || form[key] === undefined ? null : form[key];
      if (targetFace) {
        body.labor_target_pct = form.labor_target_pct === '' ? null : form.labor_target_pct;
        body.expected_sales = form.expected_sales === '' ? null : form.expected_sales;
      }
      await saveLaborWatchSettings(businessId, body);
      setFlash(t('laborWatch.saved'));
      setError('');
      await load();
    } catch { setError(t('laborWatch.saveFailed')); } finally { setSaving(false); }
  };

  const printWeek = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 50);
  };

  return (
    <div className="space-y-4">
      {flash ? <p className="no-print rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">{flash}</p> : null}
      {error ? <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}

      {isOwner ? (
        <section className="no-print rounded-xl border border-border p-4">
          <h3 className="font-medium">{t('laborWatch.settingsTitle')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('laborWatch.ownerOnlyNote')}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {FIELDS.map(([key, labelKey, type]) => (
              <div key={key} className="space-y-1">
                <Label>{t(labelKey)}</Label>
                <Input
                  type={type} min="0" step="0.01"
                  value={form[key] ?? ''}
                  onChange={(e) => setForm((cur) => ({ ...cur, [key]: e.target.value }))}
                />
              </div>
            ))}
            {targetFace ? (
              <>
                <div className="space-y-1">
                  <Label>{t('laborWatch.targetLabel')}</Label>
                  <Input type="number" min="0" step="0.01" value={form.labor_target_pct ?? ''} onChange={(e) => setForm((cur) => ({ ...cur, labor_target_pct: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>{t('laborWatch.expectedSalesLabel')}</Label>
                  <Input type="number" min="0" step="0.01" value={form.expected_sales ?? ''} onChange={(e) => setForm((cur) => ({ ...cur, expected_sales: e.target.value }))} />
                </div>
              </>
            ) : null}
          </div>
          <Button className="mt-3" size="sm" onClick={save} disabled={saving}>{t('laborWatch.saveSettings')}</Button>
        </section>
      ) : null}

      {targetFace ? (
        <section className="no-print rounded-xl border border-border p-4">
          <h3 className="font-medium">{t('laborWatch.targetTitle')}</h3>
          {week.totals.labor_pct !== null && week.totals.labor_pct !== undefined ? (
            <p className="mt-2 text-sm">
              {`${t('laborWatch.laborPctLabel')}: ${week.totals.labor_pct}% · ${t('laborWatch.totalCostLabel')}: ${money(week.totals.projected_cost)}`}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t('laborWatch.noTargetNote')}</p>
          )}
          {week.totals.over_target === true ? (
            <p className="mt-1 text-sm font-medium">{t('laborWatch.overTarget', { pct: week.totals.variance_pct })}</p>
          ) : null}
          {week.totals.over_target === false ? (
            <p className="mt-1 text-sm">{t('laborWatch.underTarget', { pct: Math.abs(week.totals.variance_pct) })}</p>
          ) : null}
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={printWeek}>
              <Printer className="mr-1.5 h-4 w-4" /> {t('tipPooling.printButton')}
            </Button>
          </div>
        </section>
      ) : null}

      <section className="no-print rounded-xl border border-border p-4">
        <h3 className="font-medium">{t('laborWatch.weekTitle')}</h3>
        {(week.people || []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('laborWatch.emptyPeople')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">{t('laborWatch.colPerson')}</th>
                  <th className="py-1 pr-3 font-medium">{t('laborWatch.colHours')}</th>
                  {targetFace ? <th className="py-1 font-medium">{t('laborWatch.projectedCostLabel')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {week.people.map((person) => (
                  <tr key={person.staff_member_id} className="border-t border-border">
                    <td className="py-1.5 pr-3 font-medium">{person.person_name}</td>
                    <td className="py-1.5 pr-3">{person.scheduled_hours}</td>
                    {targetFace ? <td className="py-1.5">{money(person.projected_cost)}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm text-muted-foreground">
              {`${t('laborWatch.totalHoursLabel')}: ${week.totals.scheduled_hours ?? 0}`}
              {targetFace ? ` · ${t('laborWatch.totalCostLabel')}: ${money(week.totals.projected_cost)}` : ''}
            </p>
          </div>
        )}
      </section>

      <section className="no-print rounded-xl border border-border p-4">
        <h3 className="font-medium">{t('laborWatch.warningsTitle')}</h3>
        {(week.warnings || []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('laborWatch.noWarnings')}</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {week.warnings.map((warning, i) => (
              <li key={i} className="rounded-md bg-amber-100 px-3 py-2 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{warningText(warning)}</li>
            ))}
          </ul>
        )}
        <h4 className="mt-4 font-medium">{t('laborWatch.clockTitle')}</h4>
        {(view.clockWarnings || []).length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t('laborWatch.noWarnings')}</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            {view.clockWarnings.map((warning, i) => (
              <li key={i} className="rounded-md bg-amber-100 px-3 py-2 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{warningText(warning)}</li>
            ))}
          </ul>
        )}
      </section>

      {printing && targetFace ? (
        <div className="print-area hidden print:block">
          <LaborWatchDoc
            week={week}
            warnings={allWarnings.map((w) => ({ text: warningText(w) }))}
            business={business}
            docStyle={docStyle}
          />
        </div>
      ) : null}
    </div>
  );
}
