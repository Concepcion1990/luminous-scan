import DocHeader from './DocHeader';
import { t } from '@/lib/i18n';

export default function CountSheet({ products, business }) {
  return (
    <div className="print-label print-page-break w-[180mm] bg-white p-2 text-black">
      <DocHeader
        business={business}
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
          {products.map((product, index) => (
            <tr key={product.id} className="break-inside-avoid border-b border-black/25">
              <td className="py-1.5 font-mono text-[7pt] text-black/70">{index + 1}</td>
              <td className="truncate py-1.5 pr-1 font-mono text-[7pt]">{product.sku}</td>
              <td className="py-1.5 pr-2">
                <p className="truncate text-[8pt] font-medium leading-tight">{product.name}</p>
                {(product.author || product.condition) && (
                  <p className="truncate text-[6.5pt] leading-tight text-black/60">
                    {[product.author, product.condition].filter(Boolean).join(' · ')}
                  </p>
                )}
              </td>
              <td className="py-1.5 pr-1">
                <span className="block h-[6mm] border border-black/30" />
              </td>
              <td className="py-1.5">
                <span className="block h-[6mm] border border-black/20" />
              </td>
            </tr>
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
    </div>
  );
}