/**
 * Direct deposit authorization form — the printable paper version
 * (Workforce phase). The owner prints it, the team member fills it
 * in and signs it, and the signed form (with a voided check) is
 * what verifies the bank numbers. Rendered inside the app layout;
 * the print stylesheet hides the app chrome, so what prints is
 * just the form.
 */
import { Link, useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

function Line({ label }) {
  return (
    <div className="mt-6">
      <div className="h-6 border-b border-neutral-400" />
      <p className="mt-1 text-xs text-neutral-600">{label}</p>
    </div>
  );
}

export default function DirectDepositForm() {
  const [params] = useSearchParams();
  const store = params.get('store') || '';
  return (
    <div className="mx-auto max-w-2xl">
      <div className="no-print mb-4 flex items-center gap-3">
        <Button onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> {t('payroll.dd.form.print')}
        </Button>
        <Link to="/payroll" className="text-sm font-medium text-primary underline underline-offset-2">
          {t('payroll.dd.form.back')}
        </Link>
      </div>
      <div className="print-area rounded-xl border border-border bg-white p-6 text-neutral-900 sm:p-8">
        <h1 className="font-heading text-xl font-semibold">{t('payroll.dd.formTitle')}</h1>
        {store && <p className="mt-1 text-sm text-neutral-600">{store}</p>}
        <p className="mt-4 text-sm leading-relaxed">{t('payroll.dd.form.auth')}</p>
        <Line label={t('payroll.dd.form.employee')} />
        <Line label={t('payroll.dd.bankName')} />
        <div className="mt-6 flex gap-8 text-sm">
          <span>☐ {t('payroll.dd.checking')}</span>
          <span>☐ {t('payroll.dd.savings')}</span>
        </div>
        <Line label={t('payroll.dd.routing')} />
        <Line label={t('payroll.dd.account')} />
        <div className="grid gap-6 sm:grid-cols-2">
          <Line label={t('payroll.dd.form.signature')} />
          <Line label={t('payroll.dd.form.date')} />
        </div>
      </div>
    </div>
  );
}
