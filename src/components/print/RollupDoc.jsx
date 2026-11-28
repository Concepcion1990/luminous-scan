import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { formatMoney } from '@/lib/inventory';
import { t } from '@/lib/i18n';

/**
 * The all-locations rollup on paper (plan release 380,
 * Nov 26, 2026): a Document Style Studio document —
 * PREVIEW = PRINT. Every location the owner owns, side by
 * side: food cost %, stock value, this week's waste and
 * what's low, with the all-locations totals at the foot —
 * the same figures the rollup page shows, from the same
 * read.
 */
export default function RollupDoc({ rows, business, docStyle }) {
  const list = rows || [];
  const money = (value) => formatMoney(value, business?.currency, 2);
  const totals = list.reduce(
    (acc, row) => ({
      stockValue: acc.stockValue + (Number(row.stockValue) || 0),
      wasteValue: acc.wasteValue + (Number(row.waste?.value) || 0),
      lowCount: acc.lowCount + (Number(row.lowCount) || 0),
    }),
    { stockValue: 0, wasteValue: 0, lowCount: 0 },
  );
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
        title={t('locationsRollup.docTitle')}
        subtitle=""
        fields={[]}
      />

      <table className="mt-2 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black/30 text-left">
            <th className="py-1 pr-2 font-medium">{t('locationsRollup.colLocation')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('locationsRollup.colFoodCost')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('locationsRollup.colStockValue')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('locationsRollup.colWaste')}</th>
            <th className="py-1 text-right font-medium">{t('locationsRollup.colLow')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((row) => (
            <tr key={row.business_id} className="border-b border-black/10">
              <td className="py-1 pr-2">{row.name}</td>
              <td className="py-1 pr-2 text-right">
                {row.foodCostPct === null || row.foodCostPct === undefined
                  ? t('locationsRollup.foodCostNone')
                  : `${row.foodCostPct}%`}
              </td>
              <td className="py-1 pr-2 text-right">{money(row.stockValue)}</td>
              <td className="py-1 pr-2 text-right">{money(row.waste?.value)}</td>
              <td className="py-1 text-right">
                {row.lowCount > 0 ? row.low.map((item) => item.name).join(', ') : t('locationsRollup.lowNone')}
              </td>
            </tr>
          ))}
          <tr className="border-t border-black/30 font-medium">
            <td className="py-1 pr-2">{t('locationsRollup.totalsLabel')}</td>
            <td className="py-1 pr-2 text-right">—</td>
            <td className="py-1 pr-2 text-right">{money(totals.stockValue)}</td>
            <td className="py-1 pr-2 text-right">{money(totals.wasteValue)}</td>
            <td className="py-1 text-right">{totals.lowCount}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-2 text-[9pt] text-black/60">{t('locationsRollup.weekNote')}</p>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
