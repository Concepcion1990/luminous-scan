import { t } from '@/lib/i18n';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import DocHeader from './DocHeader';

/**
 * The product & price list (the prints build, Nov 25, 2026):
 * the compact catalog sheet — name, code, category and retail
 * price — printed from the Products page. It carries the list
 * the viewer is looking at (search and filters applied, in
 * the screen's order), minus archived products, which never
 * belong on a price list.
 */

const TH = 'border-b border-black pb-1 text-left font-mono text-[6.5pt] uppercase tracking-wide';
const TD = 'py-1 align-top text-[9pt]';

export default function PriceListDoc({ products = [], business, docStyle }) {
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
        <DecoHeader style={docStyle} className="mb-2" />
        <DocHeader business={business} title={t('print.priceListTitle')} style={docStyle} />
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[38%]`}>{t('print.colProductName')}</th>
              <th className={TH}>SKU</th>
              <th className={TH}>{t('products.sortCategory')}</th>
              <th className={TH}>{t('products.sortPrice')}</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-black/15">
                <td className={`${TD} font-semibold`}>{product.name}</td>
                <td className={TD}>{product.sku || product.isbn || product.barcode || product.upc || '—'}</td>
                <td className={TD}>{product.category || '—'}</td>
                <td className={TD}>{formatMoney(product.price, business?.currency || 'USD', 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <DecoFooter style={docStyle} />
        <PrintedAt />
    </div>
  );
}
