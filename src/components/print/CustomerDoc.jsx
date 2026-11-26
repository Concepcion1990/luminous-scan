import DocHeader from './DocHeader';
import DocPhoto from './DocPhoto';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { channelLabel, orderShipAddressLines } from '@/lib/orders';
import { formatMoney } from '@/lib/inventory';
import { formatBusinessDate } from '@/lib/dates';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

const TITLES = {
  invoice: 'print.invoiceTitle',
  receipt: 'print.salesReceiptTitle',
  packing: 'print.packingSlipTitle',
};

/**
 * Customer-facing paperwork built from a customer order: a priced invoice, a
 * compact receipt, or a packing slip that travels in the box with no prices on it.
 */
export default function CustomerDoc({ order, business, mode = 'invoice', docStyle, photoById = {} }) {
  // Paper dates follow the business's own date-format pick
  // when it has one (the smalls bundle, Nov 25, 2026).
  const shortDate = (value) => {
    if (!value) return '';
    return formatBusinessDate(value, business) || String(value);
  };
  const packing = mode === 'packing';
  const receipt = mode === 'receipt';
  const lines = order.lines || [];
  // Exact prices on paper (Nov 14, 2026): cents always, never rounded.
  const money = (value) => formatMoney(value || 0, business?.currency, 2);
  const units = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);

  const fields = packing
    ? [
        [t('print.fieldPackedBy'), 'w-[30mm]'],
        [t('print.fieldCheckedBy'), 'w-[30mm]'],
        [t('print.fieldShipDate'), 'w-[22mm]'],
      ]
    : receipt
      ? [
          [t('print.fieldPaidBy'), 'w-[30mm]'],
          [t('print.fieldMethod'), 'w-[24mm]'],
          [t('print.fieldServedBy'), 'w-[26mm]'],
        ]
      : [
          [t('print.fieldTerms'), 'w-[24mm]'],
          [t('print.fieldDue'), 'w-[22mm]'],
          [t('print.fieldCustomerRef'), 'w-[30mm]'],
        ];

  const discountLabel = t('print.discount');
  const totals = [
    [t('print.subtotal'), order.subtotal],
    [discountLabel, order.discount],
    [t('print.shipping'), order.shipping],
    [t('print.tax'), order.tax],
  ].filter(([label, value]) => label !== discountLabel || Number(value) > 0);

  // The sales receipt is a real till receipt (owner ruling,
  // Nov 14, 2026): a compact 80mm slip — the standard thermal
  // roll width — that prints at that same narrow width centered
  // on Letter/A4, never stretched full-width. The invoice keeps
  // the full-page document look below; only the receipt is a slip.
  if (receipt) {
    return (
      <div
        className={`print-label print-page-break doc-root mx-auto w-[80mm] bg-white p-3 text-black ${docRootClass(docStyle)}`}
        style={docRootStyle(docStyle, business?.brand_color)}
      >
        <DocFrame style={docStyle} brandColor={business?.brand_color} page={false} />
        <DecoHeader style={docStyle} capMm={18} band={false} className="mb-2" />
        {business?.logo_url && (
          <img
            src={business.logo_url}
            alt=""
            className="doc-logo mx-auto mb-1 max-h-[14mm] max-w-[50mm] object-contain"
          />
        )}
        <p className="text-center text-[13pt] font-bold leading-tight">{business?.name || ''}</p>
        <p className="mt-0.5 text-center font-mono text-[7.5pt] uppercase tracking-[0.18em] text-black/60">
          {t('print.salesReceiptTitle')}
        </p>
        <p className="mt-1 text-center text-[8.5pt]">
          {[order.number, shortDate(order.order_date)].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-1 text-center text-[8.5pt]">
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            {t('print.customer')}{' '}
          </span>
          {order.customer_name || '—'}
        </p>

        <div className="mt-2 border-t border-dashed border-black/50" />
        <div>
          {lines.map((line, index) => (
            <div key={`${line.product_id || line.sku}-${index}`} className="break-inside-avoid py-1.5">
              <p className="text-[9pt] leading-tight">{line.product_name}</p>
              <div className="mt-0.5 flex justify-between text-[8.5pt]">
                <span className="numeric">
                  {line.quantity ?? 0} × {money(line.unit_price)}
                </span>
                <span className="numeric">
                  {money((Number(line.unit_price) || 0) * (Number(line.quantity) || 0))}
                </span>
              </div>
            </div>
          ))}
          {lines.length === 0 && (
            <p className="py-3 text-center text-[8pt] text-black/60">{t('print.noLines')}</p>
          )}
        </div>
        <div className="border-t border-dashed border-black/50" />

        <div className="mt-1.5 text-[8.5pt]">
          {totals.map(([label, value]) => (
            <div key={label} className="flex justify-between py-0.5">
              <span>{label}</span>
              <span className="numeric">{money(value)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-black py-1 text-[11pt] font-bold">
            <span>{t('print.totalPaid')}</span>
            <span className="numeric">{money(order.total)}</span>
          </div>
        </div>

        <p className="mt-2 border-t border-dashed border-black/50 pt-2 text-center font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
          {t('print.footerReceipt')}
        </p>
        <PrintedAt className="mt-1 text-center" />
        <DecoFooter style={docStyle} capMm={18} anchor={false} className="mt-2" />
      </div>
    );
  }

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
        title={t(TITLES[mode] || TITLES.invoice)}
        subtitle={[order.number, shortDate(order.order_date), channelLabel(order.channel)]
          .filter(Boolean)
          .join(' · ')}
        fields={fields}
      />

      <div className="mt-2 grid gap-y-0.5 text-[8pt]">
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            {packing ? t('print.shipTo') : t('print.customer')}{' '}
          </span>
          {order.customer_name || '—'}
          {order.customer_email ? ` · ${order.customer_email}` : ''}
          {order.customer_phone ? ` · ${order.customer_phone}` : ''}
        </p>
        {packing &&
          orderShipAddressLines(order).map((line, index) => <p key={index}>{line}</p>)}
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            {packing ? t('print.shipsFrom') : t('print.fulfilledFrom')}{' '}
          </span>
          {order.location_name || '—'}
          {order.customer_ref ? t('print.refSuffix', { ref: order.customer_ref }) : ''}
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.status')} </span>
          {order.status}
          {!packing && order.tracking_ref
            ? ` · ${order.carrier || t('print.trackingFallback')} ${order.tracking_ref}`
            : ''}
          {packing && t('print.packingUnitCount', { units, s: units === 1 ? '' : 's' })}
        </p>
        {order.notes && (
          <p className="whitespace-pre-line">
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.notes')} </span>
            {order.notes}
          </p>
        )}
      </div>

      <table className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-black text-left font-mono text-[6.5pt] uppercase tracking-wide">
            <th className="w-[26mm] py-1 font-normal">SKU</th>
            <th className="py-1 font-normal">{t('print.colItem')}</th>
            <th className="w-[14mm] py-1 text-right font-normal">{t('print.colQty')}</th>
            {!packing && <th className="w-[22mm] py-1 text-right font-normal">{t('print.colUnitPrice')}</th>}
            {!packing && <th className="w-[22mm] py-1 text-right font-normal">{t('print.colAmount')}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr
              key={`${line.product_id || line.sku}-${index}`}
              className="break-inside-avoid border-b border-black/25"
            >
              <td className="truncate py-1.5 pr-1 font-mono text-[7pt]">{line.sku}</td>
              <td className="py-1.5 pr-2">
                <div className="flex items-center gap-2">
                  <DocPhoto url={photoById[line.product_id]} />
                  <p className="min-w-0 truncate text-[9pt] leading-tight">{line.product_name}</p>
                </div>
              </td>
              <td className="numeric py-1.5 text-right text-[8pt]">{line.quantity ?? 0}</td>
              {!packing && (
                <td className="numeric py-1.5 text-right text-[8pt]">{money(line.unit_price)}</td>
              )}
              {!packing && (
                <td className="numeric py-1.5 text-right text-[8pt]">
                  {money((Number(line.unit_price) || 0) * (Number(line.quantity) || 0))}
                </td>
              )}
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={packing ? 3 : 5} className="py-3 text-center text-[8pt] text-black/60">
                {t('print.noLines')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {packing ? (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[8pt]">
          <p>
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.carrier')} </span>
            {order.carrier || '________________'}
          </p>
          <p>
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.tracking')} </span>
            {order.tracking_ref || '________________'}
          </p>
        </div>
      ) : (
        <div className="mt-3 ml-auto w-[70mm] text-[8pt]">
          {totals.map(([label, value]) => (
            <div key={label} className="flex justify-between border-b border-black/25 py-1">
              <span>{label}</span>
              <span className="numeric">{money(value)}</span>
            </div>
          ))}
          <div className="flex justify-between py-1 text-[9.5pt] font-semibold">
            <span>{receipt ? t('print.totalPaid') : t('print.totalDue')}</span>
            <span className="numeric">{money(order.total)}</span>
          </div>
        </div>
      )}

      <p className="mt-3 border-t border-black/25 pt-2 font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
        {packing
          ? t('print.footerPacking')
          : receipt
            ? t('print.footerReceipt')
            : t('print.footerInvoice')}
      </p>
      <PrintedAt className="mt-1" />
      <DecoFooter style={docStyle} className="mt-3" />
    </div>
  );
}