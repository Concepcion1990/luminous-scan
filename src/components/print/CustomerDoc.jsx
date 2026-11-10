import DocHeader from './DocHeader';
import { channelLabel } from '@/lib/orders';
import { formatMoney } from '@/lib/inventory';

const TITLES = { invoice: 'Invoice', receipt: 'Sales receipt', packing: 'Packing slip' };

function shortDate(value) {
  if (!value) return '';
  const stamp = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(stamp.getTime())
    ? String(value)
    : stamp.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Customer-facing paperwork built from a customer order: a priced invoice, a
 * compact receipt, or a packing slip that travels in the box with no prices on it.
 */
export default function CustomerDoc({ order, business, mode = 'invoice' }) {
  const packing = mode === 'packing';
  const receipt = mode === 'receipt';
  const lines = order.lines || [];
  const money = (value) => formatMoney(value || 0, business?.currency);
  const units = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);

  const fields = packing
    ? [
        ['Packed by', 'w-[30mm]'],
        ['Checked by', 'w-[30mm]'],
        ['Ship date', 'w-[22mm]'],
      ]
    : receipt
      ? [
          ['Paid by', 'w-[30mm]'],
          ['Method', 'w-[24mm]'],
          ['Served by', 'w-[26mm]'],
        ]
      : [
          ['Terms', 'w-[24mm]'],
          ['Due', 'w-[22mm]'],
          ['Customer ref', 'w-[30mm]'],
        ];

  const totals = [
    ['Subtotal', order.subtotal],
    ['Discount', order.discount],
    ['Shipping', order.shipping],
    ['Tax', order.tax],
  ].filter(([label, value]) => label !== 'Discount' || Number(value) > 0);

  return (
    <div className="print-label print-page-break w-[180mm] bg-white p-2 text-black">
      <DocHeader
        business={business}
        title={TITLES[mode] || TITLES.invoice}
        subtitle={[order.number, shortDate(order.order_date), channelLabel(order.channel)]
          .filter(Boolean)
          .join(' · ')}
        fields={fields}
      />

      <div className="mt-2 grid gap-y-0.5 text-[8pt]">
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            {packing ? 'Ship to ' : 'Customer '}
          </span>
          {order.customer_name || '—'}
          {order.customer_email ? ` · ${order.customer_email}` : ''}
          {order.customer_phone ? ` · ${order.customer_phone}` : ''}
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            {packing ? 'Ships from ' : 'Fulfilled from '}
          </span>
          {order.location_name || '—'}
          {order.customer_ref ? ` · ref ${order.customer_ref}` : ''}
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">Status </span>
          {order.status}
          {!packing && order.tracking_ref
            ? ` · ${order.carrier || 'Tracking'} ${order.tracking_ref}`
            : ''}
          {packing && ` · ${units} unit${units === 1 ? '' : 's'}`}
        </p>
        {order.notes && (
          <p className="whitespace-pre-line">
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">Notes </span>
            {order.notes}
          </p>
        )}
      </div>

      <table className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-black text-left font-mono text-[6.5pt] uppercase tracking-wide">
            <th className="w-[26mm] py-1 font-normal">SKU</th>
            <th className="py-1 font-normal">Item</th>
            <th className="w-[14mm] py-1 text-right font-normal">Qty</th>
            {!packing && <th className="w-[22mm] py-1 text-right font-normal">Unit price</th>}
            {!packing && <th className="w-[22mm] py-1 text-right font-normal">Amount</th>}
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
                <p className="truncate text-[9pt] leading-tight">{line.product_name}</p>
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
                No lines on this order.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {packing ? (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[8pt]">
          <p>
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">Carrier </span>
            {order.carrier || '________________'}
          </p>
          <p>
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">Tracking </span>
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
            <span>{receipt ? 'Total paid' : 'Total due'}</span>
            <span className="numeric">{money(order.total)}</span>
          </div>
        </div>
      )}

      <p className="mt-3 border-t border-black/25 pt-2 font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
        {packing
          ? 'Tick each line as it goes in the box, then mark the order shipped so stock leaves once.'
          : receipt
            ? 'Payment is recorded by hand. This receipt does not itself charge a card.'
            : 'Amounts are as entered on the order. Payment is tracked by hand, not collected by this document.'}
      </p>
    </div>
  );
}