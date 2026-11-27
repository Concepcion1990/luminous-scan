import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { formatMoney } from '@/lib/inventory';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The tip papers on paper (plan release 373, Nov 26, 2026):
 * Document Style Studio documents — PREVIEW = PRINT. One
 * document prints a saved pool split (the period, the pool,
 * the method, and each person's hours and share); the other
 * prints the year tip record (per person, per year: tips
 * reported, their gross receipts and hours, and their
 * allocated amount, with the establishment's form-ready
 * totals — gross receipts, 8% of gross receipts, total
 * tips reported, the shortfall, and the total allocated).
 * Records only: the paper assembles the owner's numbers;
 * it files nothing. The data arrives owner-shaped — this
 * document is only ever shown to the owner.
 */
export default function TipPoolingDoc({ run, shares = [], yearRecord, business, docStyle }) {
  const isYear = Boolean(yearRecord);
  if (!isYear && !run) return null;
  const money = (value) => formatMoney(value, business?.currency, 2);
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
        title={isYear ? t('tipPooling.docYearTitle') : t('tipPooling.docTitle')}
        subtitle={isYear
          ? t('tipPooling.yearTitle', { year: yearRecord.year })
          : t('tipPooling.periodLine', { start: run.period_start, end: run.period_end })}
        fields={[]}
      />

      {isYear ? (
        <div className="mt-3 text-[10pt]">
          <div className="space-y-1">
            <p>{`${t('tipPooling.grossReceiptsLabel')}: ${money(yearRecord.gross_receipts)}`}</p>
            <p>{`${t('tipPooling.eightPercentLabel')}: ${money(yearRecord.eight_percent)}`}</p>
            <p>{`${t('tipPooling.totalReportedLabel')}: ${money(yearRecord.total_reported)}`}</p>
            <p>{`${t('tipPooling.shortfallLabel')}: ${money(yearRecord.shortfall)}`}</p>
            <p>{`${t('tipPooling.totalAllocatedLabel')}: ${money(yearRecord.total_allocated)}`}</p>
          </div>
          <div className="mt-3 space-y-1">
            {(yearRecord.per_person || []).map((person) => (
              <div key={person.staff_member_id} className="flex items-baseline justify-between gap-3 border-b border-black/10 pb-1 text-[9pt]">
                <span>{person.person_name}</span>
                <span>
                  {`${t('tipPooling.tipsReportedLabel')}: ${money(person.tips_reported)} · ${t('tipPooling.allocationInputLabel')}: ${money(person.allocated)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-[10pt]">
          <p>{`${t('tipPooling.poolAmountLabel')}: ${money(run.pool_amount)}`}</p>
          <div className="mt-3 space-y-1">
            {shares.map((share) => (
              <div key={share.id || share.staff_member_id} className="flex items-baseline justify-between gap-3 border-b border-black/10 pb-1 text-[9pt]">
                <span>{share.person_name}{share.role_name ? ` · ${share.role_name}` : ''}</span>
                <span>{`${share.hours} ${t('tipPooling.hoursLabel')} · ${money(share.share_amount)}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
