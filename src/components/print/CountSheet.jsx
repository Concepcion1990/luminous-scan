import { Fragment } from 'react';
import DocHeader from './DocHeader';
import DocPhoto, { firstPhotoUrl } from './DocPhoto';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The printed count sheet. Release 378 (Nov 25, 2026) adds
 * shelf order: when the caller passes `groups` — the picked
 * products grouped by their primary storage area, areas in
 * walk order (src/lib/counts.js shelfOrderProducts) — each
 * area's items sit under its own subheader so the paper
 * walks the shelves the way the counter does. Numbering
 * runs continuously across areas. Without groups (or with a
 * single section) the sheet is the flat list it has always
 * been, byte for byte.
 */
export default function CountSheet({ products, groups, business, docStyle }) {
  const sections = groups && groups.length ? groups : [{ label: '', products: products || [] }];
  const showHeaders = sections.length > 1;
  let rowNumber = 0;
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
        title={t('print.countSheetTitle')}
        subtitle={t('print.countSheetSubtitle')}
        fields={[
          [t('print.fieldLocation'), 'w-[34mm]'],
          [t('print.countedBy'), 'w-[30mm]'],
          [t('print.fieldSheet'), 'w-[10mm]'],
        ]}
      />

      <table className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-black text-left font-mono text-[6.5pt] uppercase tracking-wide">
            <th className="w-[7mm] py-1 font-normal">#</th>
            <th className="w-[29mm] py-1 font-normal">SKU</th>
            <th className="py-1 font-normal">{t('print.colItem')}</th>
            <th className="w-[20mm] py-1 font-normal">{t('print.colCounted')}</th>
            <th className="w-[28mm] py-1 font-normal">{t('print.colNotes')}</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section, sectionIndex) => (
            <Fragment key={`section-${sectionIndex}`}>
              {showHeaders && section.label ? (
                <tr className="break-inside-avoid border-b border-black bg-black/5">
                  <td colSpan={5} className="py-1 font-mono text-[7pt] font-semibold uppercase tracking-wide">
                    {section.label}
                  </td>
                </tr>
              ) : null}
              {section.products.map((product) => {
                rowNumber += 1;
                const index = rowNumber - 1;
                return (
            <tr key={product.id} className="break-inside-avoid border-b border-black/25">
              <td className="py-1.5 font-mono text-[7pt] text-black/70">{index + 1}</td>
              <td className="truncate py-1.5 pr-1 font-mono text-[7pt]">{product.sku}</td>
              <td className="py-1.5 pr-2">
                <div className="flex items-center gap-2">
                  <DocPhoto url={firstPhotoUrl(product)} />
                  <div className="min-w-0">
                    <p className="truncate text-[8pt] font-medium leading-tight">{product.name}</p>
                    {(product.author || product.condition) && (
                      <p className="truncate text-[6.5pt] leading-tight text-black/60">
                        {[product.author, product.condition].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="py-1.5 pr-1">
                <span className="block h-[6mm] border border-black/30" />
              </td>
              <td className="py-1.5">
                <span className="block h-[6mm] border border-black/20" />
              </td>
            </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>

      <footer className="mt-3 flex items-end justify-between gap-6 border-t border-black pt-2 text-[7.5pt]">
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.itemsCounted')} </span>
          <span className="inline-block w-[14mm] border-b border-dotted border-black/60">&nbsp;</span>
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.countedBy')} </span>
          <span className="inline-block w-[34mm] border-b border-dotted border-black/60">&nbsp;</span>
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.verifiedBy')} </span>
          <span className="inline-block w-[34mm] border-b border-dotted border-black/60">&nbsp;</span>
        </p>
      </footer>
      <PrintedAt className="mt-2" />
      <DecoFooter style={docStyle} className="mt-3" />
    </div>
  );
}