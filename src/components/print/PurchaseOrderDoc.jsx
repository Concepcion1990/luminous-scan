import DocHeader from './DocHeader';
import { formatMoney } from '@/lib/inventory';
import { t } from '@/lib/i18n';

/**
 * Purchase order and its packing slip. The packing slip deliberately carries no
 * prices, so it can travel inside the box.
 */
export default function PurchaseOrderDoc({ order, business, mode = 'po' }) {
  const packing = mode === 'packing';
  const lines = order.lines || [];
  const money = (value) => formatMoney(value || 0, business?.currency);

  return (
    <div className="print-label print-page-break w-[180mm] bg-white p-2 text-black">
      <DocHeader
        business={business}
        title={packing ? t('print.packingSlipTitle') : t('print.purchaseOrderTitle')}
        subtitle={[order.number, order.supplier_name, order.status].filter(Boolean).join(' · ')}
        fields={[
          [t('print.fieldOrderDate'), 'w-[26mm]'],
          [t('print.fieldExpected'), 'w-[26mm]'],
          [packing ? t('print.fieldCheckedBy') : t('print.fieldOrderedBy'), 'w-[30mm]'],
        ]}
      />

      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[8pt]">
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.receiveInto')} </span>
          {order.location_name || '—'}
        </p>
        {!packing && (
          <p>
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.total')} </span>
            {money(order.total)}
          </p>
        )}
        {order.note && (
          <p className="w-full">
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.note')} </span>
            {order.note}
          </p>
        )}
      </div>

      <table className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-black text-left font-mono text-[6.5pt] uppercase tracking-wide">
            <th className="w-[26mm] py-1 font-normal">SKU</th>
            <th className="py-1 font-normal">{t('print.colItem')}</th>
            <th className="w-[16mm] py-1 text-right font-normal">{t('print.colOrdered')}</th>
            <th className="w-[16mm] py-1 text-right font-normal">{t('print.colReceived')}</th>
            {!packing && <th className="w-[20mm] py-1 text-right font-normal">{t('print.colUnitCost')}</th>}
            {!packing && <th className="w-[22mm] py-1 text-right font-normal">{t('print.colLineTotal')}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${line.product_id || line.sku}-${index}`} className="break-inside-avoid border-b border-black/25">
              <td className="truncate py-1.5 pr-1 font-mono text-[7pt]">{line.sku}</td>
              <td className="py-1.5 pr-2">
                <p className="truncate text-[9pt] leading-tight">{line.product_name}</p>
              </td>
              <td className="numeric py-1.5 text-right text-[8pt]">{line.qty_ordered ?? 0}</td>
              <td className="numeric py-1.5 text-right text-[8pt]">{line.qty_received ?? 0}</td>
              {!packing && (
                <td className="numeric py-1.5 text-right text-[8pt]">
                  {money(line.unit_cost)}
                </td>
              )}
              {!packing && (
                <td className="numeric py-1.5 text-right text-[8pt]">
                  {money((line.unit_cost || 0) * (line.qty_ordered || 0))}
                </td>
              )}
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={packing ? 4 : 6} className="py-3 text-center text-[8pt] text-black/60">
                {t('print.noLines')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!packing && (
        <div className="mt-3 ml-auto w-[70mm] text-[8pt]">
          <div className="flex justify-between border-b border-black/25 py-1">
            <span>{t('print.subtotal')}</span>
            <span className="numeric">{money(order.subtotal)}</span>
          </div>
          <div className="flex justify-between border-b border-black/25 py-1">
            <span>{t('print.shipping')}</span>
            <span className="numeric">{money(order.shipping)}</span>
          </div>
          <div className="flex justify-between border-b border-black/25 py-1">
            <span>{t('print.tax')}</span>
            <span className="numeric">{money(order.tax)}</span>
          </div>
          <div className="flex justify-between py-1 text-[9.5pt] font-semibold">
            <span>{t('print.total')}</span>
            <span className="numeric">{money(order.total)}</span>
          </div>
        </div>
      )}

      <p className="mt-3 border-t border-black/25 pt-2 font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
        {packing ? t('print.poFooterPacking') : t('print.poFooter')}
      </p>
    </div>
  );
}