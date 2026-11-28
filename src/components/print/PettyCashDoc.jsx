import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/inventory';
import { pettyTotals } from '@/lib/pettyCash';
import { t } from '@/lib/i18n';

/**
 * Petty cash & bank deposits on paper (plan Part 7,
 * owner-ruled addition G-A — the Print Rule): ONE
 * Document Style Studio document carrying BOTH logs —
 * PREVIEW = PRINT. The paper carries each log's full
 * shape, the same columns the planner-book form is built
 * from: for the tin — date, amount, what for, receipt
 * back in, initials; for the bank run — date, amount,
 * the bag, initials. Owner-only money: this paper only
 * ever prints from the owner's own read.
 */
export default function PettyCashDoc({ petty = [], deposits = [], business, docStyle }) {
  const totals = pettyTotals(petty, deposits);
  const money = (v) => formatMoney(v, business?.currency, 2);
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
      <DecoHeader style={docStyle} className="mb-2" />
      <DocHeader business={business} logoUrl={business?.logo_url || ''} title={t('petty.title')} subtitle={t('petty.help')} fields={[]} />

      <h3 className="mt-3 text-[10pt] font-semibold">{t('petty.cashTitle')}</h3>
      <table className="mt-1 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black/30 text-left">
            <th className="py-1 pr-2 font-medium">{t('petty.date')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('petty.amount')}</th>
            <th className="py-1 pr-2 font-medium">{t('petty.purpose')}</th>
            <th className="py-1 pr-2 font-medium">{t('petty.receipt')}</th>
            <th className="py-1 font-medium">{t('petty.initials')}</th>
          </tr>
        </thead>
        <tbody>
          {petty.map((entry) => (
            <tr key={entry.id} className="border-b border-black/10">
              <td className="py-1 pr-2">{entry.entry_date ? formatShortDate(String(entry.entry_date).slice(0, 10)) : ''}</td>
              <td className="py-1 pr-2 text-right">{money(entry.amount)}</td>
              <td className="py-1 pr-2">{entry.purpose || ''}</td>
              <td className="py-1 pr-2">{entry.receipt_back ? t('petty.receiptYes') : t('petty.receiptNo')}</td>
              <td className="py-1">{entry.initials || ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-1 pr-2 font-medium">{t('petty.totalOut')}</td>
            <td className="py-1 pr-2 text-right font-medium">{money(totals.totalOut)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>

      <h3 className="mt-4 text-[10pt] font-semibold">{t('petty.depositTitle')}</h3>
      <table className="mt-1 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black/30 text-left">
            <th className="py-1 pr-2 font-medium">{t('petty.date')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('petty.amount')}</th>
            <th className="py-1 pr-2 font-medium">{t('petty.bag')}</th>
            <th className="py-1 font-medium">{t('petty.initials')}</th>
          </tr>
        </thead>
        <tbody>
          {deposits.map((entry) => (
            <tr key={entry.id} className="border-b border-black/10">
              <td className="py-1 pr-2">{entry.deposit_date ? formatShortDate(String(entry.deposit_date).slice(0, 10)) : ''}</td>
              <td className="py-1 pr-2 text-right">{money(entry.amount)}</td>
              <td className="py-1 pr-2">{entry.bag_ref || ''}</td>
              <td className="py-1">{entry.initials || ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-1 pr-2 font-medium">{t('petty.totalDeposited')}</td>
            <td className="py-1 pr-2 text-right font-medium">{money(totals.totalDeposited)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
