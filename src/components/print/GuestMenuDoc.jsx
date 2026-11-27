import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The guest menu on paper (plan release 371, Nov 26, 2026):
 * a Document Style Studio document — the business's saved
 * frame, decorations and language dress a menu built ONLY
 * from the owner's published dishes, their linked prices and
 * the allergen matrix's flags. PREVIEW = PRINT: the owner's
 * page and the public guest page both show this exact
 * document, and printing prints this exact document. No
 * StockHaven internal (cost, stock, supplier, staff) can
 * appear here — the items arrive already shaped guest-safe
 * (src/lib/kitchenMenu.js / server/guestMenuCore.js).
 */
export default function GuestMenuDoc({ items = [], business, docStyle }) {
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
        title={t('guestMenu.docTitle')}
        subtitle={business?.name || ''}
        fields={[]}
      />

      <div className="mt-3 space-y-4">
        {(items || []).map((item) => (
          <div key={item.recipeId} className="border-b border-black/10 pb-3">
            <div className="flex items-start gap-3">
              {item.photoUrl ? (
                <img src={item.photoUrl} alt="" className="h-[18mm] w-[18mm] rounded object-cover" />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[12pt] font-semibold">{item.name}</p>
                  <p className="text-[11pt] font-semibold">
                    {item.price != null ? formatMoney(item.price, business?.currency, 2) : t('guestMenu.noPrice')}
                  </p>
                </div>
                {item.description ? (
                  <p className="mt-0.5 whitespace-pre-line text-[9pt] text-black/70">{item.description}</p>
                ) : null}
                <p className="mt-1 text-[8pt] text-black/60">
                  {item.allergens?.length
                    ? `${t('guestMenu.allergenPrefix')}: ${item.allergens.map((key) => t(`allergens.${key}`)).join(', ')}`
                    : t('guestMenu.noAllergens')}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[8pt] text-black/60">{t('guestMenu.allergenNote')}</p>
      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
