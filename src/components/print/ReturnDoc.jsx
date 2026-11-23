import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { conditionLabel, reasonLabel } from '@/lib/returns';
import { formatTrailStamp, returnTrail } from '@/lib/trail';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

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
export default function ReturnDoc({ ret, business, docStyle }) {
  const exchange = ret.kind === 'exchange';
  const lines = ret.lines || [];
  const exchangeLines = ret.exchange_lines || [];
  // Exact prices on paper (Nov 14, 2026): cents always, never rounded.
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
        title={exchange ? t('print.returnExchangeTitle') : t('print.returnTitle')}
        subtitle={[ret.number, ret.status, reasonLabel(ret.reason)].filter(Boolean).join(' · ')}
        fields={[
          [t('print.fieldReceivedOn'), 'w-[24mm]'],
          [t('print.fieldApprovedBy'), 'w-[30mm]'],
          [t('print.fieldProcessedBy'), 'w-[30mm]'],
        ]}
      />

      <div className="mt-2 grid gap-y-0.5 text-[8pt]">
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.customer')} </span>
          {ret.customer_name || '—'}
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            {t('print.originalOrder')}{' '}
          </span>
          {ret.order_number || '—'}
          {ret.received_date ? t('print.receivedDate', { date: shortDate(ret.received_date) }) : ''}
        </p>
        <p>
          <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            {t('print.returnedTo')}{' '}
          </span>
          {ret.location_name || '—'}
        </p>
        {ret.notes && (
          <p className="whitespace-pre-line">
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.notes')} </span>
            {ret.notes}
          </p>
        )}
      </div>

      <table className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-black text-left font-mono text-[6.5pt] uppercase tracking-wide">
            <th className="w-[26mm] py-1 font-normal">SKU</th>
            <th className="py-1 font-normal">{t('print.colReturnedItem')}</th>
            <th className="w-[12mm] py-1 text-right font-normal">{t('print.colQty')}</th>
            <th className="w-[34mm] py-1 font-normal">{t('print.colCondition')}</th>
            <th className="w-[18mm] py-1 text-center font-normal">{t('print.colRestock')}</th>
            <th className="w-[22mm] py-1 text-right font-normal">{t('print.colValue')}</th>
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
              <td className="py-1.5 text-center text-[8pt]">{line.restock ? t('print.yes') : t('print.no')}</td>
              <td className="numeric py-1.5 text-right text-[8pt]">
                {money((Number(line.unit_price) || 0) * (Number(line.quantity) || 0))}
              </td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={6} className="py-3 text-center text-[8pt] text-black/60">
                {t('print.noReturnItems')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {exchangeLines.length > 0 && (
        <>
          <p className="mt-3 font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
            {t('print.replacementItems')}
          </p>
          <table className="mt-1 w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b border-black text-left font-mono text-[6.5pt] uppercase tracking-wide">
                <th className="w-[26mm] py-1 font-normal">SKU</th>
                <th className="py-1 font-normal">{t('print.colReplacement')}</th>
                <th className="w-[12mm] py-1 text-right font-normal">{t('print.colQty')}</th>
                <th className="w-[22mm] py-1 text-right font-normal">{t('print.colValue')}</th>
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
          <span>{t('print.refundRecorded')}</span>
          <span className="numeric">{money(ret.refund_amount)}</span>
        </div>
        {ret.refund_note && <p className="py-1 text-[7.5pt] text-black/70">{ret.refund_note}</p>}
      </div>

      {/* The return's time trail prints with the document
          (release 357): the stages it has truly passed, each
          with its DATE + TIME and who performed it — the same
          trail the card shows, so preview = print. */}
      {returnTrail(ret).length > 0 && (
        <div className="mt-3 border-t border-black/25 pt-2">
          <p className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('trail.title')}</p>
          <ul className="mt-1 space-y-0.5 text-[8pt]">
            {returnTrail(ret).map((s) => (
              <li key={s.key} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{s.label}</span>
                <span>{formatTrailStamp(s.at)}</span>
                {s.actor ? <span>· {s.actor}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 border-t border-black/25 pt-2 font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
        {t('print.returnFooter')}
      </p>
      <PrintedAt className="mt-1" />
      <DecoFooter style={docStyle} className="mt-3" />
    </div>
  );
}