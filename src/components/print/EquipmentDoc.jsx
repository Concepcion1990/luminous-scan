import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * One machine's record on paper (plan release 372, Nov 26,
 * 2026): a Document Style Studio document — the machine's
 * page (bought when, warranty end, who services it, its
 * identifying details), its upkeep schedule with due
 * dates, and its history of breakdowns and repairs.
 * PREVIEW = PRINT: the Equipment page shows this exact
 * document for the selected machine and prints this exact
 * document. Money rides it only when the reader is
 * owner/manager territory — the data arrives already
 * shaped server-side, and a stripped figure simply does
 * not appear here.
 */
export default function EquipmentDoc({ machine, upkeep = [], events = [], business, docStyle }) {
  if (!machine) return null;
  const facts = [
    machine.kind,
    machine.make_model,
    machine.serial_number,
    machine.location_name,
  ].filter(Boolean);
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
        title={t('equipment.docTitle')}
        subtitle={machine.name}
        fields={[]}
      />

      <div className="mt-3 space-y-1 text-[10pt]">
        {facts.length ? <p>{facts.join(' · ')}</p> : null}
        {machine.purchased_date ? <p>{t('equipment.boughtOn', { date: machine.purchased_date })}</p> : null}
        {machine.purchase_price != null ? (
          <p>{`${t('equipment.priceLabel')}: ${formatMoney(machine.purchase_price, business?.currency, 2)}`}</p>
        ) : null}
        {machine.warranty_end ? <p>{t('equipment.warrantyUntil', { date: machine.warranty_end })}</p> : null}
        {machine.service_name ? (
          <p>{t('equipment.servicedBy', { name: machine.service_name })}{machine.service_phone ? ` · ${machine.service_phone}` : ''}</p>
        ) : null}
        {machine.notes ? <p className="whitespace-pre-line text-black/70">{machine.notes}</p> : null}
      </div>

      {upkeep.length ? (
        <div className="mt-4">
          <p className="text-[11pt] font-semibold">{t('equipment.upkeepTitle')}</p>
          <div className="mt-1 space-y-1">
            {upkeep.map((task) => (
              <div key={task.id} className="flex items-baseline justify-between gap-3 border-b border-black/10 pb-1 text-[9pt]">
                <span>{task.title}</span>
                <span>{task.next_due_date ? t('equipment.nextDueLabel', { date: task.next_due_date }) : ''}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <p className="text-[11pt] font-semibold">{t('equipment.historyTitle')}</p>
        {events.length ? (
          <div className="mt-1 space-y-2">
            {events.map((event) => (
              <div key={event.id} className="border-b border-black/10 pb-2 text-[9pt]">
                <p className="font-medium">
                  {event.kind === 'breakdown' ? t('equipment.reportBreakdown') : t('equipment.recordRepair')}
                  {event.kind === 'breakdown' ? ` — ${event.status === 'fixed' ? t('equipment.statusFixed') : t('equipment.statusOpen')}` : ''}
                </p>
                <p className="whitespace-pre-line">{event.description}</p>
                {event.outcome ? <p className="text-black/70">{event.outcome}</p> : null}
                {event.cost != null ? (
                  <p>{`${t('equipment.costLabel')}: ${formatMoney(event.cost, business?.currency, 2)}`}</p>
                ) : null}
                <p className="text-black/60">{event.reported_by_name || ''}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[9pt] text-black/60">{t('equipment.noHistory')}</p>
        )}
      </div>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
