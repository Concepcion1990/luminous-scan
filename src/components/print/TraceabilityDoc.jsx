import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { formatBusinessDate, formatTimeOnly } from '@/lib/dates';
import { t } from '@/lib/i18n';

/**
 * The traceability log on paper (plan Part 7, item 392 —
 * the owner-ruled SUPPLIER TRACEABILITY strengthening,
 * piece 3): a Document Style Studio document — PREVIEW =
 * PRINT. Pick a supplier or a lot in the app and this sheet
 * carries every line of where it went: receivings in,
 * movements, pulls, waste and receiving checks. This is
 * the paper the health department and the supplier are
 * handed after a recall — and the book form's source.
 */
export default function TraceabilityDoc({ lines = [], pickLabel = '', business, docStyle }) {
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
        title={t('lotTrace.traceTitle')}
        subtitle={t('lotTrace.traceHelp')}
        fields={[]}
      />

      {pickLabel ? (
        <p className="mt-2 text-[10pt] font-medium">{pickLabel}</p>
      ) : null}

      <table className="mt-2 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black/30 text-left">
            <th className="py-1 pr-2 font-medium">{t('lotTrace.colWhen')}</th>
            <th className="py-1 pr-2 font-medium">{t('lotTrace.product')}</th>
            <th className="py-1 pr-2 font-medium">{t('lotTrace.lotCode')}</th>
            <th className="py-1 pr-2 font-medium">{t('lotTrace.supplier')}</th>
            <th className="py-1 pr-2 font-medium">{t('lotTrace.location')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('lotTrace.quantity')}</th>
            <th className="py-1 font-medium">{t('lotTrace.colDetails')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={`${line.at || ''}-${i}`} className="border-b border-black/10">
              <td className="py-1 pr-2">
                {line.at ? formatBusinessDate(line.at, business) : ''}
                {line.at ? <span className="block text-[8pt]">{formatTimeOnly(line.at)}</span> : null}
              </td>
              <td className="py-1 pr-2">{line.product_name || ''}</td>
              <td className="py-1 pr-2">{line.lot_code || ''}</td>
              <td className="py-1 pr-2">{line.supplier_name || ''}</td>
              <td className="py-1 pr-2">{line.location_name || ''}</td>
              <td className="py-1 pr-2 text-right">{line.quantity || ''}</td>
              <td className="py-1">{line.detail || line.kind || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-[9pt] text-black/60">{t('lotTrace.honestNote')}</p>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
