import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The production order plan on paper (plan release 378,
 * Nov 26, 2026): a Document Style Studio document —
 * PREVIEW = PRINT. One production plan — a batch run or a
 * catering event — with every ingredient it needs, what's
 * already on hand, and what to order, grouped by supplier
 * in the order guide's shape. The paper is the plan; the
 * drafts themselves live in Purchasing for the owner's
 * confirmation.
 */
export default function ProductionOrderDoc({ plan, business, docStyle }) {
  const money = (value) => formatMoney(value, business?.currency, 2);
  const lines = plan?.lines || [];
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
        title={t('productionOrder.docTitle')}
        subtitle=""
        fields={[]}
      />

      {plan ? (
        <p className="mt-2 text-[10pt] font-medium">
          {plan.source?.kind === 'event'
            ? t('productionOrder.eventSummary', { name: plan.source?.name || '', date: plan.source?.event_date || '' })
            : t('productionOrder.batchSummary', { name: plan.source?.name || '', makes: plan.source?.makes || 0 })}
        </p>
      ) : null}

      <table className="mt-2 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black/30 text-left">
            <th className="py-1 pr-2 font-medium">{t('productionOrder.colIngredient')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('productionOrder.colNeeded')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('productionOrder.colOnHand')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('productionOrder.colOrder')}</th>
            <th className="py-1 font-medium">{t('productionOrder.colSupplier')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.product_id} className="border-b border-black/10">
              <td className="py-1 pr-2">{line.product_name}</td>
              <td className="py-1 pr-2 text-right">{line.needed} {line.unit}</td>
              <td className="py-1 pr-2 text-right">{line.onHand}</td>
              <td className="py-1 pr-2 text-right font-medium">{line.orderQty > 0 ? line.orderQty : '—'}</td>
              <td className="py-1">{line.supplier_name || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {(plan?.groups || []).map((group) => (
        <p key={group.supplier_id || group.supplier_name || 'none'} className="mt-1 text-[9pt]">
          {`${group.supplier_name || '—'}: ${money(group.total)}`}
        </p>
      ))}
      {plan?.covered ? (
        <p className="mt-2 text-[9pt] text-black/60">{t('productionOrder.coveredNote')}</p>
      ) : null}

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
