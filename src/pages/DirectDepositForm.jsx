/**
 * Direct deposit authorization form — two honest modes
 * (Workforce phase; direct-deposit build, Nov 21, 2026).
 *
 * BLANK mode (no ?staff=): the owner's editable piece. The owner
 * can prepare a fresh blank form in the app — fill the employee,
 * bank and account lines — but the SIGNATURE line is never an
 * input: nobody signs for another person. The values are local
 * prep for printing only; nothing here is saved. Printing gives
 * the paper form a member fills and signs by hand.
 *
 * SEALED mode (?staff=<id>): the completed form a member filled
 * and signed in the app, exactly as the owner received it —
 * full bank numbers, the member's electronic signature in the
 * style they chose, the date they signed. Owner only: the server
 * refuses everyone else, and this page shows that refusal rather
 * than any part of the form. The owner can view, print and
 * download it (print → save as PDF); nobody can edit it. Under
 * the form, the masked history of any forms this one replaced.
 *
 * Rendered inside the app layout; the print stylesheet hides the
 * app chrome, so what prints is just the form.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatFullDate } from '@/lib/dates';
import { t } from '@/lib/i18n';
import { useBusiness } from '@/hooks/useBusiness';
import { getDirectDepositForm, signatureFontFamily } from '@/lib/workforce';

function Line({ label }) {
  return (
    <div className="mt-6">
      <div className="h-6 border-b border-stone-400" />
      <p className="mt-1 text-xs text-stone-600">{label}</p>
    </div>
  );
}

function ValueLine({ label, value }) {
  return (
    <div className="mt-6">
      <div className="flex h-6 items-end border-b border-stone-400 pb-0.5 text-sm font-medium">{value || ''}</div>
      <p className="mt-1 text-xs text-stone-600">{label}</p>
    </div>
  );
}

function InputLine({ label, value, onChange, inputMode }) {
  return (
    <div className="mt-6">
      <input
        className="h-6 w-full border-b border-stone-400 bg-transparent pb-0.5 text-sm font-medium text-stone-900 outline-none print:border-stone-400"
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="mt-1 text-xs text-stone-600">{label}</p>
    </div>
  );
}

function SignatureValue({ name, style }) {
  if (!name) return <div className="h-6 border-b border-stone-400" />;
  return (
    <div className="flex h-6 items-end border-b border-stone-400 pb-0.5">
      <span
        className="text-2xl leading-none text-stone-900"
        style={{
          fontFamily: signatureFontFamily(style),
          fontStyle: style === 'italic' ? 'italic' : 'normal',
          fontWeight: style === 'simple' ? 600 : 400,
        }}
      >
        {name}
      </span>
    </div>
  );
}

function BlankForm({ store }) {
  const [values, setValues] = useState({ employee: '', bank: '', routing: '', account: '', type: 'checking' });
  const set = (patch) => setValues((v) => ({ ...v, ...patch }));
  return (
    <div className="print-area rounded-xl border border-border bg-white p-6 text-stone-900 sm:p-8">
      <h1 className="font-heading text-xl font-semibold">{t('payroll.dd.formTitle')}</h1>
      {store && <p className="mt-1 text-sm text-stone-600">{store}</p>}
      <p className="mt-4 text-sm leading-relaxed">{t('payroll.dd.form.auth')}</p>
      <InputLine label={t('payroll.dd.form.employee')} value={values.employee} onChange={(v) => set({ employee: v })} />
      <InputLine label={t('payroll.dd.bankName')} value={values.bank} onChange={(v) => set({ bank: v })} />
      <div className="mt-6 flex gap-8 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="dd-blank-type"
            checked={values.type === 'checking'}
            onChange={() => set({ type: 'checking' })}
          />
          {t('payroll.dd.checking')}
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="dd-blank-type"
            checked={values.type === 'savings'}
            onChange={() => set({ type: 'savings' })}
          />
          {t('payroll.dd.savings')}
        </label>
      </div>
      <InputLine label={t('payroll.dd.routing')} value={values.routing} inputMode="numeric" onChange={(v) => set({ routing: v })} />
      <InputLine label={t('payroll.dd.account')} value={values.account} inputMode="numeric" onChange={(v) => set({ account: v })} />
      <div className="grid gap-6 sm:grid-cols-2">
        <Line label={t('payroll.dd.form.signature')} />
        <Line label={t('payroll.dd.form.date')} />
      </div>
    </div>
  );
}

function SealedForm({ store, staffId }) {
  const { activeId } = useBusiness();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  useEffect(() => {
    if (!activeId) return;
    let live = true;
    getDirectDepositForm(activeId, staffId)
      .then((data) => {
        if (live) setState({ loading: false, error: '', data });
      })
      .catch((error) => {
        if (live) setState({ loading: false, error: error.message || '', data: null });
      });
    return () => {
      live = false;
    };
  }, [activeId, staffId]);

  if (state.loading) return <p className="text-sm text-muted-foreground">{t('workforce.loading')}</p>;
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  const { data } = state;
  const form = data.form || {
    bank_name: data.details.bank_name,
    account_type: data.details.account_type,
    routing_number: data.details.routing_number,
    account_number: data.details.account_number,
    signature_name: data.details.signature_name || '',
    signature_style: data.details.signature_style || '',
    signed_at: data.details.signed_at || null,
    submitted_at: data.details.submitted_at || null,
  };
  const signedDate = form.signed_at ? formatFullDate(form.signed_at) : '';
  const fmtDate = (value) => (value ? formatFullDate(value) : '');

  return (
    <>
      <p className="no-print mb-3 rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
        {t('payroll.dd.form.ownerOnlyNote')}
      </p>
      <div className="print-area rounded-xl border border-border bg-white p-6 text-stone-900 sm:p-8">
        <h1 className="font-heading text-xl font-semibold">{t('payroll.dd.formTitle')}</h1>
        {store && <p className="mt-1 text-sm text-stone-600">{store}</p>}
        <p className="mt-4 text-sm leading-relaxed">{t('payroll.dd.form.auth')}</p>
        <ValueLine label={t('payroll.dd.form.employee')} value={data.member_name} />
        <ValueLine label={t('payroll.dd.bankName')} value={form.bank_name} />
        <div className="mt-6 flex gap-8 text-sm">
          <span>{form.account_type === 'checking' ? '☑' : '☐'} {t('payroll.dd.checking')}</span>
          <span>{form.account_type === 'savings' ? '☑' : '☐'} {t('payroll.dd.savings')}</span>
        </div>
        <ValueLine label={t('payroll.dd.routing')} value={form.routing_number} />
        <ValueLine label={t('payroll.dd.account')} value={form.account_number} />
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="mt-6">
            <SignatureValue name={form.signature_name} style={form.signature_style} />
            <p className="mt-1 text-xs text-stone-600">{t('payroll.dd.form.signature')}</p>
          </div>
          <ValueLine label={t('payroll.dd.form.date')} value={signedDate} />
        </div>
        {signedDate && (
          <p className="mt-6 text-xs text-stone-600">{t('payroll.dd.form.signedOn', { date: signedDate })}</p>
        )}
      </div>
      {(data.history || []).length > 0 && (
        <div className="no-print mt-4 rounded-xl border border-border bg-card p-4 sm:p-5">
          <h2 className="font-heading text-base font-semibold">{t('payroll.dd.form.historyTitle')}</h2>
          <ul className="mt-2 divide-y divide-border">
            {data.history.map((row, i) => (
              <li key={i} className="py-2 text-sm">
                <span className="font-medium">{row.bank_name} {row.account_masked}</span>
                <span className="block text-xs text-muted-foreground">
                  {t('payroll.dd.form.signedOn', { date: fmtDate(row.signed_at || row.submitted_at) })} ·{' '}
                  {t('payroll.dd.form.replacedOn', { date: fmtDate(row.superseded_at) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export default function DirectDepositForm() {
  const [params] = useSearchParams();
  const store = params.get('store') || '';
  const staffId = params.get('staff') || '';
  return (
    <div className="mx-auto max-w-2xl">
      <div className="no-print mb-4 flex items-center gap-3">
        <Button onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> {t('payroll.dd.form.print')}
        </Button>
        <Link to="/payroll" className="text-sm font-medium text-link underline underline-offset-2">
          {t('payroll.dd.form.back')}
        </Link>
      </div>
      {staffId ? <SealedForm store={store} staffId={staffId} /> : <BlankForm store={store} />}
    </div>
  );
}
