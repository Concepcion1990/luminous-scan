import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { formatBusinessDate, formatTimeOnly } from '@/lib/dates';
import { formatMoney } from '@/lib/inventory';
import { spillTotals } from '@/lib/spillLog';
import { t } from '@/lib/i18n';

/**
 * The spill & breakage log on paper (plan Part 7, item
 * 392A — the Print Rule): a Document Style Studio
 * document — PREVIEW = PRINT. The paper carries the
 * log's full shape, the same columns the planner-book
 * form is built from: date/time, item, quantity spilled
 * or broken, the reason, and who recorded it. The pour
 * cost column rides only on the owner's rows (owner-only
 * money, shaped server-side) — a non-owner's print never
 * carries money it was never sent.
 */
export default function SpillLogDoc({ entries = [], business, docStyle }) {
  const totals = spillTotals(entries);
  const showMoney = totals.showMoney;
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
      <DecoHeader style={docStyle} className="mb-2" />
      <DocHeader
        business={business}
        logoUrl={business?.logo_url || ''}
        title={t('spill.title')}
        subtitle={t('spill.lossNote')}
        fields={[]}
      />

      <table className="mt-2 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black/30 text-left">
            <th className="py-1 pr-2 font-medium">{t('spill.colWhen')}</th>
            <th className="py-1 pr-2 font-medium">{t('spill.colItem')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('spill.colQuantity')}</th>
            <th className="py-1 pr-2 font-medium">{t('spill.colReason')}</th>
            <th className="py-1 pr-2 font-medium">{t('spill.colBy')}</th>
            {showMoney ? <th className="py-1 text-right font-medium">{t('spill.colCost')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-black/10">
              <td className="py-1 pr-2">
                {entry.created_at ? formatBusinessDate(entry.created_at, business) : ''}
                {entry.created_at ? <span className="block text-[8pt]">{formatTimeOnly(entry.created_at)}</span> : null}
              </td>
              <td className="py-1 pr-2">
                {entry.product_name || ''}
                <span className="block text-[8pt]">{entry.kind === 'breakage' ? t('spill.kindBreakage') : t('spill.kindSpill')}</span>
              </td>
              <td className="py-1 pr-2 text-right">{entry.quantity}</td>
              <td className="py-1 pr-2">{entry.reason || ''}</td>
              <td className="py-1 pr-2">{entry.created_by || ''}</td>
              {showMoney ? (
                <td className="py-1 text-right">{entry.total_cost != null ? formatMoney(entry.total_cost, business?.currency, 2) : '—'}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
        {showMoney ? (
          <tfoot>
            <tr>
              <td className="py-1 pr-2 font-medium" colSpan={5}>{t('spill.totalLabel')}</td>
              <td className="py-1 text-right font-medium">{formatMoney(totals.totalCost || 0, business?.currency, 2)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
