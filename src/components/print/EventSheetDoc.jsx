import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The event sheet (BEO) on paper (plan release 375,
 * Nov 26, 2026): a Document Style Studio document —
 * PREVIEW = PRINT. One page the kitchen and floor work
 * from: the party, its menu with servings, what the event
 * pulls from the shelves, and its notes.
 *
 * TWO COPIES, ONE DOCUMENT: the owner's copy carries the
 * money (the total, the deposit taken, the balance due);
 * the STAFF copy hides the money — with `staffCopy` set,
 * no money line exists on the paper at all. Deposits and
 * balances are owner-only money, on screen and on paper.
 * The data also arrives money-free for non-owner readers,
 * so a staff copy is the only copy they can ever print.
 */
export default function EventSheetDoc({ event, prep, staffCopy = false, business, docStyle }) {
  if (!event) return null;
  const money = (value) => formatMoney(value, business?.currency, 2);
  const showMoney = !staffCopy && event.event_total !== undefined;
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
        title={t('catering.docTitle')}
        subtitle={event.name || ''}
        fields={[]}
      />

      <div className="mt-3 text-[10pt]">
        <p>
          {t('catering.guestsLine', { count: event.party_size, date: event.event_date })}
          {event.event_time ? ` · ${event.event_time}` : ''}
        </p>
        {event.contact_name ? (
          <p>{`${t('catering.contactLabel')}: ${event.contact_name}${event.contact_phone ? ` · ${event.contact_phone}` : ''}`}</p>
        ) : null}
        {staffCopy ? <p className="mt-1 text-[9pt] text-black/60">{t('catering.staffCopyNote')}</p> : null}
      </div>

      <div className="mt-3">
        <p className="text-[11pt] font-semibold">{t('catering.menuTitle')}</p>
        {(event.menu || []).length ? (
          <div className="mt-1 space-y-1">
            {(event.menu || []).map((line) => (
              <div key={line.recipe_id} className="flex items-baseline justify-between gap-3 border-b border-black/10 pb-1 text-[9pt]">
                <span>{line.name}</span>
                <span>{`${line.servings} ${t('catering.servingsLabel')}`}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[9pt] text-black/60">{t('catering.noDishes')}</p>
        )}
      </div>

      {prep?.totals?.length ? (
        <div className="mt-3">
          <p className="text-[11pt] font-semibold">{t('catering.docPrepTitle')}</p>
          <div className="mt-1 space-y-1">
            {prep.totals.map((row) => (
              <div key={row.product_id} className="flex items-baseline justify-between gap-3 border-b border-black/10 pb-1 text-[9pt]">
                <span>{row.name}</span>
                <span>{`${row.quantity} ${row.unit}`}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {event.notes ? (
        <div className="mt-3 text-[9pt]">
          <p className="font-semibold">{t('catering.notesLabel')}</p>
          <p className="mt-0.5 whitespace-pre-wrap">{event.notes}</p>
        </div>
      ) : null}

      {showMoney ? (
        <div className="mt-3 space-y-1 text-[10pt]">
          <p>{`${t('catering.totalLabel')}: ${money(event.event_total)}`}</p>
          <p>{`${t('catering.depositLabel')}: ${money(event.deposit)}`}</p>
          <p className="font-semibold">{`${t('catering.balanceLabel')}: ${money(event.balance_due)}`}</p>
        </div>
      ) : null}

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
