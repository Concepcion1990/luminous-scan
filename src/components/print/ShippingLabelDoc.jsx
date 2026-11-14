import { t } from '@/lib/i18n';

/**
 * The 4×6 shipping label (both plans, Nov 13, 2026).
 *
 * Built from a customer order: the recipient name comes from the
 * order; the postal address is typed at print time in the Print
 * Center and is never saved — orders carry no address field, and
 * customer addresses stay out of the app entirely.
 *
 * White-label, like every customer document: the sender block is
 * the business's own name (plus its address when the sender types
 * one) — the app's name never appears on the label.
 */
export default function ShippingLabelDoc({ order, business, recipientName, recipientAddress, senderAddress }) {
  const lines = (value) =>
    String(value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  const toLines = lines(recipientAddress);
  const fromLines = lines(senderAddress);
  const tracking = [order?.carrier, order?.tracking_ref].filter(Boolean).join(' ');

  return (
    <div className="print-label print-page-break flex h-[152mm] w-[102mm] flex-col bg-white p-[6mm] text-black">
      <div>
        <p className="font-mono text-[7pt] uppercase tracking-[0.18em] text-black/60">
          {t('print.shipFrom')}
        </p>
        <p className="text-[11pt] font-semibold leading-tight">{business?.name}</p>
        {fromLines.map((line, index) => (
          <p key={index} className="text-[9pt] leading-snug">
            {line}
          </p>
        ))}
      </div>

      <div className="mt-[12mm]">
        <p className="font-mono text-[7pt] uppercase tracking-[0.18em] text-black/60">
          {t('print.shipTo')}
        </p>
        <p className="text-[17pt] font-bold leading-tight">
          {recipientName || order?.customer_name || '—'}
        </p>
        {toLines.map((line, index) => (
          <p key={index} className="text-[12pt] leading-snug">
            {line}
          </p>
        ))}
      </div>

      <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-black/25 pt-2 font-mono text-[7pt] uppercase tracking-wide text-black/60">
        <span>{order?.number || ''}</span>
        <span>{tracking}</span>
      </div>
    </div>
  );
}
