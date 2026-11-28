import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { partialCounted } from '@/lib/barCounting';
import { t } from '@/lib/i18n';

/**
 * The bar count sheet on paper (plan release 379, Nov 26,
 * 2026): a Document Style Studio document — PREVIEW =
 * PRINT. One storage area's bar count: every bottle and
 * keg with what's on record, the full units, the open
 * one's tenths, and the counted total those make. The
 * saved count itself lives in Counts as a count session;
 * this paper is the count as it was entered.
 */
export default function BarCountDoc({ area, entries, business, docStyle }) {
  const lines = area?.lines || [];
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
        title={t('barCounting.docTitle')}
        subtitle=""
        fields={[]}
      />

      {area ? (
        <p className="mt-2 text-[10pt] font-medium">
          {t('barCounting.docArea', { name: area.name || '' })}
        </p>
      ) : null}

      <table className="mt-2 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black/30 text-left">
            <th className="py-1 pr-2 font-medium">{t('barCounting.colProduct')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('barCounting.expectedLabel')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('barCounting.fullLabel')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('barCounting.partialLabel')}</th>
            <th className="py-1 text-right font-medium">{t('barCounting.countedLabel')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const entry = entries?.[line.product_id];
            const kind = entry?.kind === 'keg' ? t('barCounting.kindKeg') : t('barCounting.kindBottle');
            return (
              <tr key={line.product_id} className="border-b border-black/10">
                <td className="py-1 pr-2">{line.product_name} ({kind})</td>
                <td className="py-1 pr-2 text-right">{line.expected}</td>
                <td className="py-1 pr-2 text-right">{entry ? entry.full_units : '—'}</td>
                <td className="py-1 pr-2 text-right">{entry ? `${entry.partial_tenths}/10` : '—'}</td>
                <td className="py-1 text-right font-medium">
                  {entry ? partialCounted(entry.full_units, entry.partial_tenths) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-2 text-[9pt] text-black/60">{t('barCounting.varianceNote')}</p>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
