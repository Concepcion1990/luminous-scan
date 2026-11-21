/**
 * A member's own pay stub as a clean document (direct-deposit
 * build's payroll finishing pieces, Nov 21, 2026): the Print /
 * download door on each of the member's stubs in Payroll lands
 * here. The data comes from the existing my-stubs read — pushed
 * stubs, the member's own only, enforced server-side — so this
 * page can only ever render a stub that is truly theirs. Print
 * gives the paper copy; print → save as PDF is the download.
 * Rendered inside the app layout; the print stylesheet hides the
 * app chrome, so what prints is just the stub.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { useBusiness } from '@/hooks/useBusiness';
import { formatMoneyPlain, listMyStubs } from '@/lib/workforce';

export default function PayStubPrint() {
  const { stubId } = useParams();
  const { activeId, record } = useBusiness();
  const [state, setState] = useState({ loading: true, stub: null });
  useEffect(() => {
    if (!activeId) return;
    let live = true;
    listMyStubs(activeId)
      .then((data) => {
        if (!live) return;
        const stub = (data.stubs ?? []).find((s) => s.id === stubId) || null;
        setState({ loading: false, stub });
      })
      .catch(() => {
        if (live) setState({ loading: false, stub: null });
      });
    return () => {
      live = false;
    };
  }, [activeId, stubId]);

  if (state.loading) return <p className="text-sm text-muted-foreground">{t('workforce.loading')}</p>;
  const stub = state.stub;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="no-print mb-4 flex items-center gap-3">
        <Button onClick={() => window.print()} disabled={!stub}>
          <Printer className="mr-2 h-4 w-4" /> {t('payroll.dd.form.print')}
        </Button>
        <Link to="/payroll" className="text-sm font-medium text-link underline underline-offset-2">
          {t('payroll.dd.form.back')}
        </Link>
      </div>
      {!stub ? (
        <p className="text-sm text-muted-foreground">{t('payroll.stubs.empty')}</p>
      ) : (
        <div className="print-area rounded-xl border border-border bg-white p-6 text-stone-900 sm:p-8">
          <h1 className="font-heading text-xl font-semibold">{t('payroll.stubs.title')}</h1>
          {record?.name && <p className="mt-1 text-sm text-stone-600">{record.name}</p>}
          <p className="mt-3 text-sm font-medium">{stub.person_name}</p>
          <p className="text-sm text-stone-600">
            {t('payroll.stubs.period', {
              start: String(stub.period_start).slice(0, 10),
              end: String(stub.period_end).slice(0, 10),
            })}
          </p>
          <div className="mt-5 space-y-1.5 text-sm leading-relaxed">
            <p>
              {t('payroll.hours.regular')}: {stub.regular_hours} · {t('payroll.hours.overtime')}: {stub.overtime_hours}
            </p>
            <p>
              {t('payroll.gross')}: {formatMoneyPlain(stub.gross)}
              {Number(stub.bonus) > 0 ? ` · ${t('payroll.bonus')}: ${formatMoneyPlain(stub.bonus)}` : ''}
              {Number(stub.tips) > 0 ? ` · ${t('payroll.tips')}: ${formatMoneyPlain(stub.tips)}` : ''}
            </p>
            {(stub.deductions || []).length > 0 && (
              <>
                <p className="pt-2 font-semibold">{t('payroll.deductions')}</p>
                <ul>
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
              </>
            )}
            <p className="flex justify-between border-t border-stone-300 pt-2 font-semibold">
              <span>{t('payroll.net')}</span>
              <span>{formatMoneyPlain(stub.net)}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
