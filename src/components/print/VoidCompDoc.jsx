import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { formatBusinessDate, formatTimeOnly } from '@/lib/dates';
import { formatMoney } from '@/lib/inventory';
import { voidCompTotals } from '@/lib/voidComp';
import { t } from '@/lib/i18n';

/**
 * The void & comp log on paper (plan Part 7, owner-ruled
 * addition G-C — the Print Rule): a Document Style Studio
 * document — PREVIEW = PRINT. The paper carries the
 * register's full shape, the same columns the planner-book
 * form is built from: date & time, kind, value, reason,
 * who approved it, and who recorded it, with the void and
 * comp totals at the foot. Owner/manager money: this paper
 * only ever prints from an owner/manager read. The
 * subtitle carries the honest note onto the paper too —
 * every entry was typed in by hand; no till sent it.
 */
export default function VoidCompDoc({ entries = [], business, docStyle }) {
  const totals = voidCompTotals(entries);
  const money = (v) => formatMoney(v, business?.currency, 2);
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
      <DecoHeader style={docStyle} className="mb-2" />
      <DocHeader business={business} logoUrl={business?.logo_url || ''} title={t('voidcomp.title')} subtitle={t('voidcomp.handNote')} fields={[]} />

      <table className="mt-2 w-full border-collapse text-[9pt]">
        <thead>
          <tr className="border-b border-black/30 text-left">
            <th className="py-1 pr-2 font-medium">{t('voidcomp.colWhen')}</th>
            <th className="py-1 pr-2 font-medium">{t('voidcomp.colKind')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('voidcomp.colValue')}</th>
            <th className="py-1 pr-2 font-medium">{t('voidcomp.colReason')}</th>
            <th className="py-1 pr-2 font-medium">{t('voidcomp.colApprover')}</th>
            <th className="py-1 font-medium">{t('voidcomp.colBy')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-black/10">
              <td className="py-1 pr-2">
                {entry.created_at ? formatBusinessDate(entry.created_at, business) : ''}
                {entry.created_at ? <span className="block text-[8pt]">{formatTimeOnly(entry.created_at)}</span> : null}
              </td>
              <td className="py-1 pr-2">{entry.kind === 'comp' ? t('voidcomp.kindComp') : t('voidcomp.kindVoid')}</td>
              <td className="py-1 pr-2 text-right">{money(entry.amount)}</td>
              <td className="py-1 pr-2">{entry.reason || ''}</td>
              <td className="py-1 pr-2">{entry.approver || ''}</td>
              <td className="py-1">{entry.created_by || ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-1 pr-2 font-medium" colSpan={2}>{t('voidcomp.totalVoids')}</td>
            <td className="py-1 pr-2 text-right font-medium">{money(totals.totalVoids)}</td>
            <td colSpan={3} />
          </tr>
          <tr>
            <td className="py-1 pr-2 font-medium" colSpan={2}>{t('voidcomp.totalComps')}</td>
            <td className="py-1 pr-2 text-right font-medium">{money(totals.totalComps)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
