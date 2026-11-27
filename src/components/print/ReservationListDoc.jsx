import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The day's reservations on paper (plan release 376,
 * Nov 26, 2026): a Document Style Studio document —
 * PREVIEW = PRINT. The list the host stand works from:
 * every party for the day in time order, with the table
 * or section, the phone, the notes the kitchen needs,
 * and the deposit record where one was taken. Guest
 * contact details print only here, on the house's own
 * paper, from the book they live in — they are never
 * exported anywhere else.
 */
export default function ReservationListDoc({ date, reservations, business, docStyle }) {
  const money = (value) => formatMoney(value, business?.currency, 2);
  const statusLabel = (status) => t(`reservations.status${status === 'seated' ? 'Seated' : status === 'no-show' ? 'NoShow' : status === 'cancelled' ? 'Cancelled' : 'Booked'}`);
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
        title={t('reservations.docTitle')}
        subtitle={date || ''}
        fields={[]}
      />

      <div className="mt-3 space-y-1">
        {(reservations || []).length ? (
          (reservations || []).map((r) => (
            <div key={r.id} className="border-b border-black/10 pb-1 text-[9pt]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">
                  {r.res_time ? `${r.res_time} · ` : ''}{r.party_name}
                </span>
                <span>
                  {t('reservations.guestsLine', { count: r.party_size, date: r.res_date })}
                  {r.table_label ? ` · ${r.table_label}` : ''} · {statusLabel(r.status)}
                </span>
              </div>
              {r.phone || r.notes || Number(r.deposit_amount) > 0 ? (
                <p className="text-black/70">
                  {r.phone ? `${t('reservations.phoneLabel')}: ${r.phone}` : ''}
                  {Number(r.deposit_amount) > 0
                    ? `${r.phone ? ' · ' : ''}${t('reservations.depositLabel')}: ${money(r.deposit_amount)}${r.deposit_how ? ` (${r.deposit_how})` : ''}`
                    : ''}
                  {r.notes ? ` · ${r.notes}` : ''}
                </p>
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-[9pt] text-black/60">{t('reservations.emptyTitle')}</p>
        )}
      </div>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
