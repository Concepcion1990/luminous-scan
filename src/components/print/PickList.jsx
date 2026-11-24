import DocHeader from './DocHeader';
import DocPhoto, { firstPhotoUrl } from './DocPhoto';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

export default function PickList({ products, business, docStyle }) {
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
        title={t('print.pickListTitle')}
        subtitle={t('print.pickListSubtitle')}
        fields={[
          [t('print.fieldOrderBatch'), 'w-[34mm]'],
          [t('print.fieldPickedBy'), 'w-[30mm]'],
        ]}
      />

      <table className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-black text-left font-mono text-[6.5pt] uppercase tracking-wide">
            <th className="w-[7mm] py-1 font-normal">{t('print.colDone')}</th>
            <th className="w-[16mm] py-1 font-normal">{t('print.colQty')}</th>
            <th className="w-[30mm] py-1 font-normal">SKU</th>
            <th className="py-1 font-normal">{t('print.colItem')}</th>
            <th className="w-[16mm] py-1 font-normal">{t('print.colLoc')}</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="break-inside-avoid border-b border-black/25">
              <td className="py-2 pr-1">
                <span className="block h-[5mm] w-[5mm] border border-black/50" />
              </td>
              <td className="py-2 pr-1">
                <span className="block h-[6mm] border border-black/40" />
              </td>
              <td className="truncate py-2 pr-1 font-mono text-[7pt]">{product.sku}</td>
              <td className="py-2 pr-2">
                <div className="flex items-center gap-2">
                  <DocPhoto url={firstPhotoUrl(product)} />
                  <div className="min-w-0">
                    <p className="truncate text-[9pt] font-medium leading-tight">{product.name}</p>
                    {(product.author || product.condition || product.isbn) && (
                      <p className="truncate text-[6.5pt] leading-tight text-black/60">
                        {[product.author, product.condition, product.isbn && `ISBN ${product.isbn}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="py-2">
                <span className="block h-[5mm] border-b border-dotted border-black/50" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="mt-3 flex items-end justify-between gap-6 border-t border-black pt-2 text-[7.5pt]">
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.lines')} </span>
          <span className="inline-block w-[12mm] border-b border-dotted border-black/60">&nbsp;</span>
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.pickedBy')} </span>
          <span className="inline-block w-[32mm] border-b border-dotted border-black/60">&nbsp;</span>
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.checkedBy')} </span>
          <span className="inline-block w-[32mm] border-b border-dotted border-black/60">&nbsp;</span>
        </p>
      </footer>
      <PrintedAt className="mt-2" />
      <DecoFooter style={docStyle} className="mt-3" />
    </div>
  );
}