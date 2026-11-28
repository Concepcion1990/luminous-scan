import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The supplier price book on paper (plan release 377,
 * Nov 26, 2026): a Document Style Studio document —
 * PREVIEW = PRINT. One ingredient, every supplier's
 * current price side by side, cheapest first and marked —
 * the sheet the owner takes to the phone with a supplier.
 * Prices are the latest the app has collected from that
 * supplier's invoices and orders, with the date each was
 * seen; nothing here is a quote the app invented.
 */
export default function PriceBookDoc({ priceBook, business, docStyle }) {
  const money = (value) => formatMoney(value, business?.currency, 2);
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
        title={t('priceBook.docTitle')}
        subtitle=""
        fields={[]}
      />

      <div className="mt-3 space-y-2">
        {(priceBook || []).length ? (
          (priceBook || []).map((entry) => (
            <div key={entry.product_id} className="border-b border-black/10 pb-1 text-[9pt]">
              <p className="font-medium">{entry.product_name || entry.product_id}</p>
              {(entry.offers || []).map((offer, index) => (
                <div
                  key={`${offer.supplier_id || offer.supplier_name}-${offer.date}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span>
                    {offer.supplier_name || '—'}
                    {index === 0 ? ` · ${t('priceBook.cheapest')}` : ''}
                  </span>
                  <span>
                    {money(offer.unit_cost)}
                    {offer.date ? ` · ${offer.date}` : ''}
                    {` · ${offer.source === 'invoice' ? t('priceBook.sourceInvoice') : t('priceBook.sourceOrder')}`}
                  </span>
                </div>
              ))}
            </div>
          ))
        ) : (
          <p className="text-[9pt] text-black/60">{t('priceBook.emptyTitle')}</p>
        )}
      </div>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
