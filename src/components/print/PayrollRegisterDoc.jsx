import { t } from '@/lib/i18n';
import { formatBusinessDate } from '@/lib/dates';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import DocHeader from './DocHeader';

/**
 * The payroll register (the prints build, Nov 25, 2026): the
 * pay-period preview from the Payroll page on one Studio sheet
 * for the wage file — every person, their hours, gross,
 * deductions and net, with the period totals. It prints the
 * preview the viewer already ran; the door lives beside the
 * preview itself, so it follows the Payroll page's own gating.
 */

const TH = 'border-b border-black pb-1 text-left font-mono text-[6.5pt] uppercase tracking-wide';
const TD = 'py-1 align-top text-[9pt]';

const hours = (value) => (value == null ? '—' : String(Math.round(Number(value) * 100) / 100));

export default function PayrollRegisterDoc({ period, rows = [], business, docStyle }) {
  const subtitle = period
    ? t('payroll.stubs.period', {
        start: formatBusinessDate(period.start, business),
        end: formatBusinessDate(period.end, business),
      })
    : '';
  const totals = rows.reduce(
    (sum, row) => ({
      gross: sum.gross + (Number(row.gross) || 0),
      deductions: sum.deductions + (Number(row.deductions) || 0),
      net: sum.net + (Number(row.net) || 0),
    }),
    { gross: 0, deductions: 0, net: 0 },
  );
  const money = (value) => formatMoney(value, business?.currency || 'USD', 2);
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
        <DecoHeader style={docStyle} className="mb-2" />
        <DocHeader business={business} title={t('print.payrollRegisterTitle')} subtitle={subtitle} style={docStyle} />
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[22%]`}>{t('training.team.person')}</th>
              <th className={TH}>{t('payroll.hours.regular')}</th>
              <th className={TH}>{t('payroll.hours.overtime')}</th>
              <th className={TH}>{t('payroll.hours.breaks')}</th>
              <th className={TH}>{t('payroll.gross')}</th>
              <th className={TH}>{t('payroll.deductions')}</th>
              <th className={TH}>{t('payroll.net')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="border-b border-black/15">
                <td className={`${TD} font-semibold`}>{row.name}</td>
                <td className={TD}>{hours(row.regular_hours)}</td>
                <td className={TD}>{hours(row.overtime_hours)}</td>
                <td className={TD}>{row.break_minutes == null ? '—' : row.break_minutes}</td>
                <td className={TD}>{money(row.gross)}</td>
                <td className={TD}>{money(row.deductions)}</td>
                <td className={TD}>{money(row.net)}</td>
              </tr>
            ))}
            <tr>
              <td className={`${TD} font-semibold`} colSpan={4}>{t('ops.invoices.colTotal')}</td>
              <td className={`${TD} font-semibold`}>{money(totals.gross)}</td>
              <td className={`${TD} font-semibold`}>{money(totals.deductions)}</td>
              <td className={`${TD} font-semibold`}>{money(totals.net)}</td>
            </tr>
          </tbody>
        </table>
        <DecoFooter style={docStyle} />
        <PrintedAt />
    </div>
  );
}
