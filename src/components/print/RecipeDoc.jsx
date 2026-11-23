import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The dish card on paper (release 359, Nov 23, 2026): a
 * member of the Document Style Studio family (release 350) —
 * the owner's frame, decorations and printed-at stamp, the
 * dish's photo, its ingredients, and the selling price beside
 * the true cost. Money follows the same law as the screen:
 * the rows arrive cost-free for anyone without the money
 * tick, so the paper never carries a figure the reader was
 * not allowed to see. Preview is print — what the dish page
 * shows in its print view is exactly this sheet.
 */
export default function RecipeDoc({ recipe, business, docStyle, rows, costPerMake, trueCost, price, foodCostPct, showMoney }) {
  const money = (value) => formatMoney(value || 0, business?.currency, 2);

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
        title={t('print.recipeTitle')}
        subtitle={[recipe.name, recipe.location_name].filter(Boolean).join(' · ')}
        fields={[]}
      />

      {recipe.photo_url ? (
        <img
          src={recipe.photo_url}
          alt=""
          className="mt-2 h-[38mm] w-full rounded object-cover"
        />
      ) : null}

      {recipe.description ? (
        <p className="mt-2 whitespace-pre-line text-[9pt]">{recipe.description}</p>
      ) : null}

      <table className="mt-3 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black/40 text-left">
            <th className="py-1 pr-2 font-medium">{t('print.recipeIngredient')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('print.recipeQuantity')}</th>
            {showMoney ? <th className="py-1 text-right font-medium">{t('print.recipeLineCost')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((row, index) => (
            <tr key={index} className="border-b border-black/10">
              <td className="py-1 pr-2">
                {row.label}
                {row.detail ? <span className="text-black/60"> — {row.detail}</span> : null}
              </td>
              <td className="py-1 pr-2 text-right">{row.qtyText}</td>
              {showMoney ? <td className="py-1 text-right">{row.costText || ''}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 grid gap-y-0.5 text-[9pt]">
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.recipeMakes')} </span>
          {recipe.yield_qty ?? 1}
          {recipe.product_name ? ` · ${recipe.product_name}` : ''}
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.recipePrice')} </span>
          {price != null ? money(price) : '—'}
          {showMoney ? (
            <>
              {'  ·  '}
              <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.recipeTrueCost')} </span>
              {money(trueCost)}
              {foodCostPct != null ? ` (${foodCostPct}%)` : ''}
            </>
          ) : null}
        </p>
        {showMoney ? (
          <p>
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.recipeCostPerMake')} </span>
            {money(costPerMake)}
          </p>
        ) : null}
      </div>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
