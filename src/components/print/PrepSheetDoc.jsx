import DocHeader from './DocHeader';
import DocPhoto from './DocPhoto';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The prep sheet on paper (release 361, Nov 23, 2026): for
 * each dish, build up to its par — how many makes that takes
 * and what those makes pull from the shelf. A member of the
 * Document Style Studio family; preview is print.
 */
export default function PrepSheetDoc({ rows, business, docStyle }) {
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
        title={t('print.prepTitle')}
        subtitle=""
        fields={[]}
      />

      {(rows || []).map((row) => (
        <div key={row.recipe.id} className="mt-3">
          <p className="text-[11pt] font-semibold">
            {row.recipe.name}
            <span className="ml-2 text-[9pt] font-normal text-black/70">
              {t('print.prepBuildTo', { qty: row.buildTo })} · {t('print.prepMakes', { count: row.makes })}
            </span>
          </p>
          {row.makes > 0 ? (
            <table className="mt-1 w-full border-collapse text-[9pt]">
              <tbody>
                {row.ingredients.map((ingredient) => (
                  <tr key={ingredient.product_id} className="border-b border-black/10">
                    <td className="py-1 pr-2">
                      <div className="flex items-center gap-2">
                        <DocPhoto url={ingredient.photo_url} />
                        <span>{ingredient.name}</span>
                      </div>
                    </td>
                    <td className="py-1 text-right">
                      {ingredient.quantity} {ingredient.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-[9pt] text-black/60">{t('print.prepNone')}</p>
          )}
        </div>
      ))}

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
