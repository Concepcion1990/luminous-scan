import DocHeader from './DocHeader';
import { conditionLabel, reasonLabel } from '@/lib/returns';
import { formatMoney } from '@/lib/inventory';

function shortDate(value) {
  if (!value) return '';
  const stamp = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(stamp.getTime())
    ? String(value)
    : stamp.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Return / exchange paperwork: what came back, its condition, and whether it was
 * put back on the shelf. Refunds are the amount recorded by hand, nothing more.
 */
export default function ReturnDoc({ ret, business }) {
  const exchange = ret.kind === 'exchange';
  const lines = ret.lines || [];
  const exchangeLines = ret.exchange_lines || [];
  const money = (value) => formatMoney(value || 0, business?.currency);

  return (
    <div className="print-label print-page-break w-[180mm] bg-white p-2 text-black">
      <DocHeader
        business={business}
        title={exchange ? 'Return & exchange' : 'Return'}
        subtitle={[ret.number, ret.status, reasonLabel(ret.reason)].filter(Boolean).join(' · ')}
        fields={[
          ['Received on', 'w-[24mm]'],
          ['Approved by', 'w-[30mm]'],
          ['Processed by', 'w-[30mm]'],
        ]}
      />

      <div className="mt-2 grid gap-y-0.5 text-[8pt]">
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">Customer </span>
          {ret.customer_name || '—'}
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            Original order{' '}
          </span>
          {ret.order_number || '—'}
          {ret.received_date ? ` · received ${shortDate(ret.received_date)}` : ''}
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            Returned to{' '}
          </span>
          {ret.location_name || '—'}
        </p>
        {ret.notes && (
          <p className="whitespace-pre-line">
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">Notes </span>
            {ret.notes}
          </p>
        )}
      </div>

      <table className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-black text-left font-mono text-[6.5pt] uppercase tracking-wide">
            <th className="w-[26mm] py-1 font-normal">SKU</th>
            <th className="py-1 font-normal">Returned item</th>
            <th className="w-[12mm] py-1 text-right font-normal">Qty</th>
            <th className="w-[34mm] py-1 font-normal">Condition</th>
            <th className="w-[18mm] py-1 text-center font-normal">Restock</th>
            <th className="w-[22mm] py-1 text-right font-normal">Value</th>
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
              <td className="truncate py-1.5 pr-1 text-[8pt]">{conditionLabel(line.condition)}</td>
              <td className="py-1.5 text-center text-[8pt]">{line.restock ? 'Yes' : 'No'}</td>
              <td className="numeric py-1.5 text-right text-[8pt]">
                {money((Number(line.unit_price) || 0) * (Number(line.quantity) || 0))}
              </td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={6} className="py-3 text-center text-[8pt] text-black/60">
                No items on this return.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {exchangeLines.length > 0 && (
        <>
          <p className="mt-3 font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            Replacement items
          </p>
          <table className="mt-1 w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b border-black text-left font-mono text-[6.5pt] uppercase tracking-wide">
                <th className="w-[26mm] py-1 font-normal">SKU</th>
                <th className="py-1 font-normal">Replacement</th>
                <th className="w-[12mm] py-1 text-right font-normal">Qty</th>
                <th className="w-[22mm] py-1 text-right font-normal">Value</th>
              </tr>
            </thead>
            <tbody>
              {exchangeLines.map((line, index) => (
                <tr
                  key={`${line.product_id || line.sku}-${index}`}
                  className="break-inside-avoid border-b border-black/25"
                >
                  <td className="truncate py-1.5 pr-1 font-mono text-[7pt]">{line.sku}</td>
                  <td className="py-1.5 pr-2">
                    <p className="truncate text-[9pt] leading-tight">{line.product_name}</p>
                  </td>
                  <td className="numeric py-1.5 text-right text-[8pt]">{line.quantity ?? 0}</td>
                  <td className="numeric py-1.5 text-right text-[8pt]">
                    {money((Number(line.unit_price) || 0) * (Number(line.quantity) || 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="mt-3 ml-auto w-[80mm] text-[8pt]">
        <div className="flex justify-between border-b border-black/25 py-1">
          <span>Refund recorded</span>
          <span className="numeric">{money(ret.refund_amount)}</span>
        </div>
        {ret.refund_note && <p className="py-1 text-[7.5pt] text-black/70">{ret.refund_note}</p>}
      </div>

      <p className="mt-3 border-t border-black/25 pt-2 font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
        The refund amount is what was recorded by hand in this app. No payment processor refund is implied.
        Only lines marked restock return to sellable stock.
      </p>
    </div>
  );
}