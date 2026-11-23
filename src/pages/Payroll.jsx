/**
 * Payroll — the dedicated payroll page (Workforce phase).
 *
 * Hours flow in automatically from the time clock (breaks are
 * unpaid). The owner sets each person's pay and the tax/deduction
 * settings ONCE; every run applies them. Stubs are generated
 * unpushed: a manager can send stubs to staff, but only the OWNER
 * can send the manager's stub. The page also holds the cash drawer
 * (cash-up), direct deposit (details visible to the owner only)
 * and the owner-only IRS forms box.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, PenLine, Printer, Send, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useBusiness } from '@/hooks/useBusiness';
import { formatFullDate, formatShortDate } from '@/lib/dates';
import { getLocale, t } from '@/lib/i18n';
import {
  createCashUp,
  formatMoneyPlain,
  getDirectDeposit,
  getPayrollConfig,
  getPayrollContext,
  getPayrollRun,
  inviteDirectDeposit,
  listCashUps,
  listMyStubs,
  listPayProfiles,
  listPayrollRuns,
  listPeople,
  previewPayroll,
  pushStub,
  runPayroll,
  savePayProfile,
  savePayrollConfig,
  sendBackDirectDeposit,
  signatureFontFamily,
  submitDirectDeposit,
  updateMyPayrollDetails,
  updateWorkforceSettings,
} from '@/lib/workforce';

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const labelCls = 'font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground';
const DENOMS = [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01];

function Section({ title, children, help }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="font-heading text-base font-semibold">{title}</h2>
      {help && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{help}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function StubBreakdown({ stub }) {
  return (
    <div className="mt-2 rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
      <div className="grid gap-1 sm:grid-cols-2">
        <span>
          {t('payroll.hours.regular')}: {stub.regular_hours} · {t('payroll.hours.overtime')}: {stub.overtime_hours}
        </span>
        <span>
          {t('payroll.gross')}: {formatMoneyPlain(stub.gross)}
          {Number(stub.bonus) > 0 ? ` · ${t('payroll.bonus')}: ${formatMoneyPlain(stub.bonus)}` : ''}
          {Number(stub.tips) > 0 ? ` · ${t('payroll.tips')}: ${formatMoneyPlain(stub.tips)}` : ''}
        </span>
      </div>
      {(stub.deductions || []).length > 0 && (
        <ul className="mt-1">
          {stub.deductions.map((d, i) => (
            <li key={i} className="flex justify-between gap-4">
              <span>
                {d.name}
                {d.kind === 'percent' ? ` (${d.value}%)` : ''}
              </span>
              <span>-{formatMoneyPlain(d.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
        <span>{t('payroll.net')}</span>
        <span>{formatMoneyPlain(stub.net)}</span>
      </p>
    </div>
  );
}

function ProfilesSection({ businessId, profiles, canSetPay, reload }) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState({});
  const save = async (personId) => {
    const draft = drafts[personId];
    if (!draft) return;
    try {
      await savePayProfile(businessId, personId, draft);
      toast({ title: t('payroll.saved') });
      reload();
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    }
  };
  return (
    <Section title={t('payroll.people.title')} help={t('payroll.people.help')}>
      <ul className="divide-y divide-border">
        {profiles.map(({ person, profile }) => {
          const draft = drafts[person.id] || {
            pay_type: profile?.pay_type || 'hourly',
            hourly_rate: profile?.hourly_rate ?? '',
            annual_salary: profile?.annual_salary ?? '',
          };
          const set = (patch) => setDrafts((d) => ({ ...d, [person.id]: { ...draft, ...patch } }));
          return (
            <li key={person.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-end gap-3">
                <span className="min-w-36 font-medium">
                  {person.full_name}
                  <span className="block text-xs font-normal text-muted-foreground">{person.role_name}</span>
                </span>
                {canSetPay ? (
                  <>
                    <div>
                      <label className={labelCls}>{t('payroll.payType.hourly')} / {t('payroll.payType.salary')}</label>
                      <select className={inputCls} value={draft.pay_type} onChange={(e) => set({ pay_type: e.target.value })}>
                        <option value="hourly">{t('payroll.payType.hourly')}</option>
                        <option value="salary">{t('payroll.payType.salary')}</option>
                      </select>
                    </div>
                    {draft.pay_type === 'hourly' ? (
                      <div>
                        <label className={labelCls}>{t('payroll.hourlyRate')}</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={inputCls}
                          value={draft.hourly_rate}
                          onChange={(e) => set({ hourly_rate: e.target.value })}
                        />
                      </div>
                    ) : (
                      <div>
                        <label className={labelCls}>{t('payroll.annualSalary')}</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={inputCls}
                          value={draft.annual_salary}
                          onChange={(e) => set({ annual_salary: e.target.value })}
                        />
                      </div>
                    )}
                    <Button size="sm" onClick={() => save(person.id)}>
                      {t('payroll.save')}
                    </Button>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {profile
                      ? profile.pay_type === 'salary'
                        ? `${t('payroll.annualSalary')}: ${formatMoneyPlain(profile.annual_salary)}`
                        : `${t('payroll.hourlyRate')}: ${formatMoneyPlain(profile.hourly_rate)}`
                      : t('payroll.dd.none')}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function RunSection({ businessId, ctx, reloadRuns }) {
  const { toast } = useToast();
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const [period, setPeriod] = useState({ start: iso(new Date(today.getTime() - 13 * 86400000)), end: iso(today) });
  const [preview, setPreview] = useState(null);
  const [adjustments, setAdjustments] = useState({});
  const [busy, setBusy] = useState(false);

  const doPreview = async () => {
    setBusy(true);
    try {
      const data = await previewPayroll(businessId, period.start, period.end);
      setPreview(data);
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const doRun = async () => {
    setBusy(true);
    try {
      const result = await runPayroll(businessId, {
        period_start: period.start,
        period_end: period.end,
        adjustments,
      });
      toast({ title: t('payroll.runDone') });
      if (result.missing_profiles?.length) {
        toast({
          title: t('payroll.missingProfiles', { names: result.missing_profiles.join(', ') }),
          variant: 'destructive',
        });
      }
      reloadRuns();
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('payroll.title')} help={t('payroll.subtitle')}>
      <div className="flex max-w-xl flex-wrap items-end gap-3">
        <div>
          <label className={labelCls}>{t('payroll.period.start')}</label>
          <input
            type="date"
            className={inputCls}
            value={period.start}
            onChange={(e) => setPeriod((p) => ({ ...p, start: e.target.value }))}
          />
        </div>
        <div>
          <label className={labelCls}>{t('payroll.period.end')}</label>
          <input
            type="date"
            className={inputCls}
            value={period.end}
            onChange={(e) => setPeriod((p) => ({ ...p, end: e.target.value }))}
          />
        </div>
        <Button variant="outline" disabled={busy} onClick={doPreview}>
          {t('payroll.preview')}
        </Button>
        {ctx.is_owner && (
          <Button disabled={busy} onClick={doRun}>
            {t('payroll.run')}
          </Button>
        )}
      </div>
      {preview && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-medium"></th>
                <th className="py-1 pr-3 font-medium">{t('payroll.hours.regular')}</th>
                <th className="py-1 pr-3 font-medium">{t('payroll.hours.overtime')}</th>
                <th className="py-1 pr-3 font-medium">{t('payroll.hours.breaks')}</th>
                <th className="py-1 pr-3 font-medium">{t('payroll.bonus')}</th>
                <th className="py-1 pr-3 font-medium">{t('payroll.tips')}</th>
                <th className="py-1 pr-3 font-medium">{t('payroll.gross')}</th>
                <th className="py-1 font-medium">{t('payroll.net')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.people.map((row) => (
                <tr key={row.person.id} className="border-t border-border">
                  <td className="py-1.5 pr-3 font-medium">
                    {row.person.full_name}
                    {(row.missed_clock_outs || []).map((missed) => (
                      <span
                        key={missed.entry_id}
                        className="mt-0.5 block text-xs font-normal text-red-700 dark:text-red-300"
                      >
                        {t('workforce.entries.missedClockOut')} ·{' '}
                        {t('workforce.entries.missedDetail', {
                          start: new Intl.DateTimeFormat(getLocale(), {
                            hour: 'numeric',
                            minute: '2-digit',
                          }).format(new Date(missed.shift_start)),
                          end: new Intl.DateTimeFormat(getLocale(), {
                            hour: 'numeric',
                            minute: '2-digit',
                          }).format(new Date(missed.shift_end)),
                        })}
                      </span>
                    ))}
                  </td>
                  <td className="py-1.5 pr-3">{row.regular_hours}</td>
                  <td className="py-1.5 pr-3">{row.overtime_hours}</td>
                  <td className="py-1.5 pr-3">{row.break_minutes}</td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-20 rounded-md border border-input bg-background px-2 py-1"
                      value={adjustments[row.person.id]?.bonus ?? ''}
                      onChange={(e) =>
                        setAdjustments((a) => ({ ...a, [row.person.id]: { ...a[row.person.id], bonus: e.target.value } }))
                      }
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-20 rounded-md border border-input bg-background px-2 py-1"
                      value={adjustments[row.person.id]?.tips ?? ''}
                      onChange={(e) =>
                        setAdjustments((a) => ({ ...a, [row.person.id]: { ...a[row.person.id], tips: e.target.value } }))
                      }
                    />
                  </td>
                  <td className="py-1.5 pr-3">{row.gross === null ? '—' : formatMoneyPlain(row.gross)}</td>
                  <td className="py-1.5">{row.net === null ? '—' : formatMoneyPlain(row.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function RunsSection({ businessId, reloadKey }) {
  const { toast } = useToast();
  const [runs, setRuns] = useState([]);
  const [openRun, setOpenRun] = useState(null);
  const load = useCallback(async () => {
    const data = await listPayrollRuns(businessId);
    setRuns(data.runs ?? []);
  }, [businessId]);
  useEffect(() => {
    load().catch(() => {});
  }, [load, reloadKey]);

  const toggle = async (run) => {
    if (openRun?.run.id === run.id) {
      setOpenRun(null);
      return;
    }
    const data = await getPayrollRun(businessId, run.id);
    setOpenRun(data);
  };
  const push = async (stub) => {
    try {
      await pushStub(businessId, stub.id);
      toast({ title: t('payroll.stubs.pushDone') });
      const data = await getPayrollRun(businessId, openRun.run.id);
      setOpenRun(data);
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    }
  };

  return (
    <Section title={t('payroll.runs.title')}>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('payroll.runs.empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((run) => (
            <li key={run.id} className="py-2.5 text-sm">
              <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => toggle(run)}>
                {t('payroll.stubs.period', { start: formatShortDate(String(run.period_start).slice(0, 10)), end: formatShortDate(String(run.period_end).slice(0, 10)) })}
              </button>
              <span className="ml-2 text-xs text-muted-foreground">
                {t('payroll.runs.stubs', { count: run.stub_count ?? 0 })}
              </span>
              {openRun?.run.id === run.id && (
                <ul className="mt-2 space-y-2">
                  {openRun.stubs.map((stub) => (
                    <li key={stub.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-medium">{stub.person_name}</span>
                        <span>
                          {t('payroll.net')}: {formatMoneyPlain(stub.net)}
                        </span>
                        {stub.pushed ? (
                          <span className="rounded-full bg-ok/12 px-2 py-0.5 text-xs text-ok">
                            {t('payroll.stubs.pushed')}
                          </span>
                        ) : (
                          <>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t('payroll.stubs.notPushed')}</span>
                            <Button size="sm" variant="outline" onClick={() => push(stub)}>
                              <Send className="mr-1 h-3.5 w-3.5" /> {t('payroll.stubs.push')}
                            </Button>
                          </>
                        )}
                      </div>
                      <StubBreakdown stub={stub} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ConfigSection({ businessId, ctx }) {
  const { toast } = useToast();
  const [config, setConfig] = useState(null);
  useEffect(() => {
    getPayrollConfig(businessId)
      .then((data) => setConfig(data.config))
      .catch(() => setConfig(null));
  }, [businessId]);
  if (!config) return null;
  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const save = async () => {
    try {
      const data = await savePayrollConfig(businessId, config);
      setConfig(data.config);
      toast({ title: t('payroll.saved') });
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    }
  };
  const fields = [
    ['federal_pct', 'payroll.config.federal'],
    ['state_pct', 'payroll.config.state'],
    ['social_security_pct', 'payroll.config.ss'],
    ['medicare_pct', 'payroll.config.medicare'],
  ];
  return (
    <Section title={t('payroll.config.title')} help={t('payroll.config.help')}>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
        {fields.map(([key, labelKey]) => (
          <div key={key}>
            <label className={labelCls}>{t(labelKey)}</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              className={inputCls}
              disabled={!ctx.is_owner}
              value={config[key]}
              onChange={(e) => set({ [key]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {(config.custom_deductions || []).map((d, i) => (
          <div key={i} className="flex max-w-2xl flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1">
              <label className={labelCls}>{t('payroll.config.customName')}</label>
              <input
                className={inputCls}
                disabled={!ctx.is_owner}
                value={d.name}
                onChange={(e) =>
                  set({
                    custom_deductions: config.custom_deductions.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  })
                }
              />
            </div>
            <div>
              <label className={labelCls}>{t('payroll.config.customKind')}</label>
              <select
                className={inputCls}
                disabled={!ctx.is_owner}
                value={d.kind}
                onChange={(e) =>
                  set({
                    custom_deductions: config.custom_deductions.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)),
                  })
                }
              >
                <option value="percent">{t('payroll.config.customPercent')}</option>
                <option value="flat">{t('payroll.config.customFlat')}</option>
              </select>
            </div>
            <div className="w-28">
              <label className={labelCls}>{t('payroll.config.customValue')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                disabled={!ctx.is_owner}
                value={d.value}
                onChange={(e) =>
                  set({
                    custom_deductions: config.custom_deductions.map((x, j) =>
                      j === i ? { ...x, value: e.target.value } : x,
                    ),
                  })
                }
              />
            </div>
            {ctx.is_owner && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => set({ custom_deductions: config.custom_deductions.filter((_, j) => j !== i) })}
              >
                {t('payroll.config.removeCustom')}
              </Button>
            )}
          </div>
        ))}
      </div>
      {ctx.is_owner && (
        <div className="mt-3 flex gap-2">
          {(config.custom_deductions || []).length < 5 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                set({ custom_deductions: [...(config.custom_deductions || []), { name: '', kind: 'percent', value: 0 }] })
              }
            >
              {t('payroll.config.addCustom')}
            </Button>
          )}
          <Button size="sm" onClick={save}>
            {t('payroll.save')}
          </Button>
        </div>
      )}
    </Section>
  );
}

function CashUpSection({ businessId }) {
  const { toast } = useToast();
  const [list, setList] = useState([]);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    float_amount: '',
    cash_sales: '',
    cash_refunds: '',
    payouts: '',
    card_payments: '',
  });
  const [counts, setCounts] = useState({});
  const load = useCallback(async () => {
    const data = await listCashUps(businessId);
    setList(data.cash_ups ?? []);
  }, [businessId]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  const save = async () => {
    try {
      await createCashUp(businessId, { ...form, denominations: counts });
      toast({ title: t('payroll.cash.saved') });
      setCounts({});
      await load();
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    }
  };
  const moneyFields = [
    ['float_amount', 'payroll.cash.float'],
    ['cash_sales', 'payroll.cash.sales'],
    ['cash_refunds', 'payroll.cash.refunds'],
    ['payouts', 'payroll.cash.payouts'],
    ['card_payments', 'payroll.cash.card'],
  ];
  return (
    <Section title={t('payroll.cash.title')} help={t('payroll.cash.help')}>
      <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
        <div>
          <label className={labelCls}>{t('payroll.cash.date')}</label>
          <input
            type="date"
            className={inputCls}
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
        </div>
        {moneyFields.map(([key, labelKey]) => (
          <div key={key}>
            <label className={labelCls}>{t(labelKey)}</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className={inputCls}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <p className={`${labelCls} mt-4`}>{t('payroll.cash.denom')}</p>
      <div className="mt-1 flex max-w-2xl flex-wrap gap-2">
        {DENOMS.map((denom) => (
          <label key={denom} className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">{denom >= 1 ? `$${denom}` : `${Math.round(denom * 100)}¢`}</span>
            <input
              type="number"
              min="0"
              step="1"
              className="w-16 rounded-md border border-input bg-background px-2 py-1"
              value={counts[denom] ?? ''}
              onChange={(e) => setCounts((c) => ({ ...c, [denom]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <Button className="mt-3" onClick={save}>
        {t('payroll.cash.save')}
      </Button>
      {list.length > 0 ? (
        <ul className="mt-4 divide-y divide-border">
          {list.slice(0, 20).map((row) => (
            <li key={row.id} className="flex flex-wrap gap-x-4 gap-y-1 py-2 text-sm">
              <span className="font-medium">{formatShortDate(String(row.date).slice(0, 10))}</span>
              <span>
                {t('payroll.cash.counted')}: {formatMoneyPlain(row.counted_total)}
              </span>
              <span>
                {t('payroll.cash.expected')}: {formatMoneyPlain(row.expected_total)}
              </span>
              <span className={Number(row.over_short) !== 0 ? 'font-medium text-amber-700 dark:text-amber-300' : ''}>
                {t('payroll.cash.overShort')}: {formatMoneyPlain(row.over_short)}
              </span>
              <span className="text-xs text-muted-foreground">{row.counted_by_name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t('payroll.cash.empty')}</p>
      )}
    </Section>
  );
}

function MyProfileSection({ profile, businessId, reload }) {
  const { toast } = useToast();
  const isOwner = Boolean(profile.owner);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setName(profile.full_name || '');
    setAddress(profile.personal_address || '');
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await updateMyPayrollDetails(businessId, { full_name: name, personal_address: address });
      toast({ title: t('payroll.saved') });
      setEditing(false);
      reload();
    } catch (error) {
      toast({ title: error.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t('payroll.profile.title')}
      help={isOwner ? t('payroll.profile.ownerNote') : t('payroll.profile.note')}
    >
      {editing ? (
        <div className="grid max-w-xl gap-3 text-sm">
          <div>
            <label className={labelCls} htmlFor="my-details-name">{t('payroll.profile.name')}</label>
            <input
              id="my-details-name"
              className={`${inputCls} mt-1`}
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="my-details-address">{t('payroll.profile.address')}</label>
            <textarea
              id="my-details-address"
              className={`${inputCls} mt-1`}
              rows={3}
              value={address}
              maxLength={1000}
              onChange={(event) => setAddress(event.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>{t('payroll.save')}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              {t('payroll.profile.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <dl className="grid max-w-xl gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className={labelCls}>{t('payroll.profile.name')}</dt>
              <dd className="mt-0.5 font-medium">
                {profile.full_name ? profile.full_name : t('payroll.profile.noName')}
              </dd>
            </div>
            <div>
              <dt className={labelCls}>{t('payroll.profile.address')}</dt>
              <dd className="mt-0.5 whitespace-pre-line">
                {profile.personal_address ? profile.personal_address : t('payroll.profile.noAddress')}
              </dd>
            </div>
          </dl>
          {isOwner && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={startEdit}>
                <PenLine className="mr-1.5 h-3.5 w-3.5" /> {t('payroll.profile.edit')}
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function SignaturePreview({ name, style, className = '' }) {
  return (
    <span
      className={`inline-block text-2xl leading-tight text-stone-900 dark:text-stone-100 ${className}`}
      style={{
        fontFamily: signatureFontFamily(style),
        fontStyle: style === 'italic' ? 'italic' : 'normal',
        fontWeight: style === 'simple' ? 600 : 400,
      }}
    >
      {name}
    </span>
  );
}

function DirectDepositSection({ businessId, ctx, people, businessName }) {
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({
    bank_name: '',
    account_type: 'checking',
    routing_number: '',
    account_number: '',
    signature_name: '',
    signature_style: 'script',
  });
  const [fixing, setFixing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sendBackId, setSendBackId] = useState(null);
  const prefilledFor = useRef(null);
  const load = useCallback(async () => {
    const result = await getDirectDeposit(businessId);
    setData(result);
  }, [businessId]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  // Pre-fill the form from the member's standing details whenever
  // their state changes (first invite, a send-back, a fresh
  // signing) — never while they are mid-typing in the same state.
  useEffect(() => {
    const mine = data?.mine;
    if (!mine) return;
    const stamp = `${mine.status}:${mine.signed_at || ''}`;
    if (prefilledFor.current === stamp) return;
    prefilledFor.current = stamp;
    setForm((f) => ({
      ...f,
      bank_name: mine.bank_name || f.bank_name,
      account_type: mine.account_type || f.account_type,
      signature_name: mine.signature_name || mine.full_name || f.signature_name,
      signature_style: mine.signature_style || f.signature_style,
    }));
  }, [data]);
  if (!data) return null;
  const statusByPerson = Object.fromEntries((data.team || []).map((row) => [row.staff_member_id, row]));
  const mine = data.mine;
  const showForm = Boolean(
    mine && data.enabled && (mine.status !== 'submitted' || fixing),
  );
  const signedDate = mine?.signed_at ? formatFullDate(mine.signed_at) : '';

  const submit = async () => {
    setBusy(true);
    try {
      const result = await submitDirectDeposit(businessId, form);
      toast({ title: result?.corrected ? t('payroll.dd.correctedDone') : t('payroll.dd.submitDone') });
      setFixing(false);
      await load();
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const sendBack = async (person) => {
    setSendBackId(person.id);
    try {
      await sendBackDirectDeposit(businessId, person.id);
      toast({ title: t('payroll.dd.sendBackDone', { name: person.full_name }) });
      await load();
    } catch (error) {
      toast({ title: error.message || t('workforce.actionFailed'), variant: 'destructive' });
    } finally {
      setSendBackId(null);
    }
  };

  return (
    <Section title={t('payroll.dd.title')} help={t('payroll.dd.help')}>
      {ctx.is_owner && (
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={data.enabled}
            onChange={async (event) => {
              await updateWorkforceSettings(businessId, { dd_enabled: event.target.checked }).catch(() => {});
              await load();
            }}
          />
          <span className="font-medium">{t('payroll.dd.enable')}</span>
        </label>
      )}
      <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
        <p className="font-semibold">{t('payroll.dd.steps.title')}</p>
        <p className="mt-1 whitespace-pre-line">{t('payroll.dd.steps.body')}</p>
      </div>
      <div className="mt-3">
        <Link
          to={`/payroll/direct-deposit-form?store=${encodeURIComponent(businessName || '')}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-link underline underline-offset-2"
        >
          <Printer className="h-4 w-4" /> {t('payroll.dd.printForm')}
        </Link>
      </div>
      {ctx.is_owner && data.enabled && (
        <ul className="mt-3 divide-y divide-border">
          {people.map((person) => {
            const row = statusByPerson[person.id];
            return (
              <li key={person.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="font-medium">{person.full_name}</span>
                <span className="text-muted-foreground">
                  {!row
                    ? t('payroll.dd.none')
                    : row.status === 'submitted'
                      ? `${t('payroll.dd.submitted')} · ${row.bank_name} ${row.account_masked}${
                          row.submission_count > 1 ? ` · ${t('payroll.dd.corrected')}` : ''
                        }`
                      : row.status === 'correction_requested'
                        ? t('payroll.dd.correctionWaiting')
                        : t('payroll.dd.invited')}
                </span>
                {!row && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await inviteDirectDeposit(businessId, person.id).catch((error) =>
                        toast({ title: error.message, variant: 'destructive' }),
                      );
                      await load();
                    }}
                  >
                    {t('payroll.dd.invite')}
                  </Button>
                )}
                {row?.status === 'submitted' && (
                  <>
                    <Link
                      to={`/payroll/direct-deposit-form?staff=${encodeURIComponent(person.id)}&store=${encodeURIComponent(businessName || '')}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      <PenLine className="h-3.5 w-3.5" /> {t('payroll.dd.viewForm')}
                    </Link>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sendBackId === person.id}
                      onClick={() => sendBack(person)}
                    >
                      <Undo2 className="mr-1 h-3.5 w-3.5" /> {t('payroll.dd.sendBack')}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {mine?.status === 'correction_requested' && data.enabled && (
        <div className="mt-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm leading-relaxed">
          {t('payroll.dd.correctionNotice')}
        </div>
      )}
      {showForm && (
        <div className="mt-4 max-w-xl">
          <h3 className="text-sm font-semibold">{t('payroll.dd.mineTitle')}</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{t('payroll.dd.bankName')}</label>
              <input
                className={inputCls}
                value={form.bank_name}
                onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>{t('payroll.dd.accountType')}</label>
              <select
                className={inputCls}
                value={form.account_type}
                onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value }))}
              >
                <option value="checking">{t('payroll.dd.checking')}</option>
                <option value="savings">{t('payroll.dd.savings')}</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('payroll.dd.routing')}</label>
              <input
                className={inputCls}
                inputMode="numeric"
                placeholder={mine?.routing_masked || ''}
                value={form.routing_number}
                onChange={(e) => setForm((f) => ({ ...f, routing_number: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>{t('payroll.dd.account')}</label>
              <input
                className={inputCls}
                inputMode="numeric"
                placeholder={mine?.account_masked || ''}
                value={form.account_number}
                onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
              />
            </div>
          </div>
          <div className="mt-5 rounded-md border border-border p-3">
            <h4 className="text-sm font-semibold">{t('payroll.dd.signTitle')}</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('payroll.dd.signHelp')}</p>
            <p className="mt-2 text-sm leading-relaxed">{t('payroll.dd.form.auth')}</p>
            <div className="mt-3">
              <label className={labelCls}>{t('payroll.dd.signName')}</label>
              <input
                className={inputCls}
                value={form.signature_name}
                onChange={(e) => setForm((f) => ({ ...f, signature_name: e.target.value }))}
              />
            </div>
            <p className={`${labelCls} mt-3`}>{t('payroll.dd.signStyle')}</p>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {[
                ['script', 'payroll.dd.styleScript'],
                ['italic', 'payroll.dd.styleItalic'],
                ['simple', 'payroll.dd.styleSimple'],
              ].map(([style, labelKey]) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, signature_style: style }))}
                  className={`rounded-md border px-3 py-2 text-left ${
                    form.signature_style === style
                      ? 'border-primary ring-2 ring-ring'
                      : 'border-input hover:bg-muted'
                  }`}
                >
                  <span className="block overflow-hidden">
                    <SignaturePreview name={form.signature_name.trim() || mine?.full_name || ''} style={style} />
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{t(labelKey)}</span>
                </button>
              ))}
            </div>
          </div>
          <Button className="mt-3" disabled={busy} onClick={submit}>
            {t('payroll.dd.submit')}
          </Button>
        </div>
      )}
      {mine?.status === 'submitted' && !fixing && (
        <div className="mt-3 text-sm">
          <p className="text-muted-foreground">
            {t('payroll.dd.submitted')}: {mine.bank_name} {mine.account_masked}
          </p>
          {mine.signature_name && (
            <p className="mt-1 text-muted-foreground">
              {t('payroll.dd.signedAs', { name: mine.signature_name, date: signedDate })}
            </p>
          )}
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">{t('payroll.dd.fixHelp')}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setFixing(true)}>
            <PenLine className="mr-1 h-3.5 w-3.5" /> {t('payroll.dd.fixMistake')}
          </Button>
        </div>
      )}
    </Section>
  );
}

function IrsBox() {
  const links = [
    ['payroll.irs.w4', 'https://www.irs.gov/W4'],
    ['payroll.irs.w4pdf', 'https://www.irs.gov/pub/irs-pdf/fw4.pdf'],
    ['payroll.irs.w2', 'https://www.irs.gov/w2'],
    ['payroll.irs.ssa', 'https://www.ssa.gov/employer'],
    ['payroll.irs.hub', 'https://www.irs.gov/forms-instructions'],
  ];
  return (
    <Section title={t('payroll.irs.title')} help={t('payroll.irs.body')}>
      <ul className="space-y-2">
        {links.map(([labelKey, href]) => (
          <li key={href}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <Landmark className="h-4 w-4" /> {t(labelKey)}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('payroll.irs.stateNote')}</p>
    </Section>
  );
}

export default function Payroll() {
  const { activeId, record } = useBusiness();
  const [ctx, setCtx] = useState(null);
  const [people, setPeople] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [myStubs, setMyStubs] = useState([]);
  const [runsKey, setRunsKey] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!activeId) return;
    try {
      const [c, p, prof] = await Promise.all([
        getPayrollContext(activeId),
        listPeople(activeId),
        listPayProfiles(activeId),
      ]);
      setCtx(c);
      setPeople(p.people ?? []);
      setProfiles(prof.profiles ?? []);
      const stubs = await listMyStubs(activeId).catch(() => ({ stubs: [] }));
      setMyStubs(stubs.stubs ?? []);
    } catch {
      setError(t('workforce.loadError'));
    }
  }, [activeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!activeId || (!ctx && !error)) return <p className="text-sm text-muted-foreground">{t('workforce.loading')}</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  const management = ctx.level !== 'staff';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">{t('payroll.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('payroll.subtitle')}</p>
      </div>

      {ctx.me_profile && <MyProfileSection profile={ctx.me_profile} businessId={activeId} reload={load} />}

      {profiles.length > 0 && (
        <ProfilesSection businessId={activeId} profiles={profiles} canSetPay={Boolean(ctx.can_set_pay ?? ctx.is_owner)} reload={load} />
      )}

      {myStubs.length > 0 && (
        <Section title={t('payroll.stubs.mine')}>
          <ul className="space-y-2">
            {myStubs.map((stub) => (
              <li key={stub.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-medium">
                    {t('payroll.stubs.period', {
                      start: formatShortDate(String(stub.period_start).slice(0, 10)),
                      end: formatShortDate(String(stub.period_end).slice(0, 10)),
                    })}
                  </span>
                  <Link
                    to={`/payroll/stub/${encodeURIComponent(stub.id)}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <Printer className="h-3.5 w-3.5" /> {t('payroll.stubs.print')}
                  </Link>
                </div>
                <StubBreakdown stub={stub} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {management && (
        <>
          <RunSection businessId={activeId} ctx={ctx} reloadRuns={() => setRunsKey((k) => k + 1)} />
          <RunsSection businessId={activeId} reloadKey={runsKey} />
          <ConfigSection businessId={activeId} ctx={ctx} />
          <CashUpSection businessId={activeId} />
        </>
      )}

      <DirectDepositSection businessId={activeId} ctx={ctx} people={people} businessName={record?.name} />

      {ctx.show_irs_box && <IrsBox />}
    </div>
  );
}
