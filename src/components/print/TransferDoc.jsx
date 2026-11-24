import DocHeader from './DocHeader';
import DocPhoto from './DocPhoto';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { formatShortDate } from '@/lib/dates';
import { t } from '@/lib/i18n';

/**
 * A transfer on paper (release 361, Nov 23, 2026): one
 * document for a transfer pair — what moved, how much, from
 * where to where, and when. The app settles location
 * transfers at once; this sheet is the paper trail that
 * travels with the goods. A member of the Document Style
 * Studio family; preview is print.
 */
export default function TransferDoc({ doc, business, docStyle }) {
  if (!doc) return null;
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
        title={t('print.transferTitle')}
        subtitle={[doc.fromName, doc.toName].filter(Boolean).join(' → ')}
        fields={[]}
      />

      <div className="mt-3 grid gap-y-0.5 text-[9pt]">
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.transferFrom')} </span>
          {doc.fromName || '—'}
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.transferTo')} </span>
          {doc.toName || '—'}
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.transferDate')} </span>
          {doc.date ? formatShortDate(doc.date) : '—'}
          {doc.by ? ` · ${doc.by}` : ''}
        </p>
        {doc.reference ? (
          <p>
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.transferReference')} </span>
            {doc.reference}
          </p>
        ) : null}
      </div>

      <table className="mt-3 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black/40 text-left">
            <th className="py-1 pr-2 font-medium">{t('print.transferItem')}</th>
            <th className="py-1 text-right font-medium">{t('print.transferQuantity')}</th>
          </tr>
        </thead>
        <tbody>
          {(doc.lines || []).map((line, index) => (
            <tr key={index} className="border-b border-black/10">
              <td className="py-1 pr-2">
                <div className="flex items-center gap-2">
                  <DocPhoto url={line.photo_url} />
                  <span>
                    {line.product_name}
                    {line.sku ? <span className="text-black/60"> — {line.sku}</span> : null}
                  </span>
                </div>
              </td>
              <td className="py-1 text-right">{line.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
