import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The labor week on paper (plan release 374, Nov 26,
 * 2026): a Document Style Studio document — PREVIEW =
 * PRINT. It prints the week's schedule totals the owner
 * sees on the Labor target page: each person's scheduled
 * hours and projected cost, the week's projected labor %
 * against the owner's own target, and the warnings the
 * watch raised. Every number on it is the owner's: their
 * target, their expected sales, their watch lines.
 */
export default function LaborWatchDoc({ week, warnings = [], business, docStyle }) {
  if (!week) return null;
  const money = (value) => formatMoney(value, business?.currency, 2);
  const totals = week.totals || {};
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
      <DecoHeader style={docStyle} className="mb-2" />
      <DocHeader business={business} logoUrl={business?.logo_url || ''} title={t('laborWatch.docTitle')} subtitle="" fields={[]} />

      <div className="mt-3 text-[10pt]">
        <p>{`${t('laborWatch.totalHoursLabel')}: ${totals.scheduled_hours ?? 0}`}</p>
        <p>{`${t('laborWatch.totalCostLabel')}: ${money(totals.projected_cost)}`}</p>
        {totals.labor_pct !== null && totals.labor_pct !== undefined ? (
          <p>{`${t('laborWatch.laborPctLabel')}: ${totals.labor_pct}%`}</p>
        ) : null}
        {totals.labor_target_pct !== null && totals.labor_target_pct !== undefined ? (
          <p>{`${t('laborWatch.targetLabel')}: ${totals.labor_target_pct}%`}</p>
        ) : null}
        <div className="mt-3 space-y-1">
          {(week.people || []).map((person) => (
            <div key={person.staff_member_id} className="flex items-baseline justify-between gap-3 border-b border-black/10 pb-1 text-[9pt]">
              <span>{person.person_name}</span>
              <span>{`${person.scheduled_hours} · ${money(person.projected_cost)}`}</span>
            </div>
          ))}
        </div>
        {warnings.length ? (
          <div className="mt-3 space-y-1">
            <p className="font-medium">{t('laborWatch.warningsTitle')}</p>
            {warnings.map((warning, i) => (
              <p key={i} className="text-[9pt]">{warning.text}</p>
            ))}
          </div>
        ) : null}
      </div>

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
