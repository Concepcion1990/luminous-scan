import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { formatBusinessDate } from '@/lib/dates';
import { formatMoney } from '@/lib/inventory';
import { t } from '@/lib/i18n';

function LabelRow({ label, children }) {
  return (
    <p>
      <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{label} </span>
      {children}
    </p>
  );
}

/**
 * A supplier credit memo on paper (the smalls bundle,
 * Nov 25, 2026 — the owner's ruling: credit memos GET a
 * print button). This is OUR clean print of the memo as
 * recorded — the business's own record of the credit the
 * supplier gave — and it says so on its face: the header
 * carries this business's name, and the footer note states
 * plainly that the sheet is not the supplier's document.
 * A member of the Document Style Studio family; preview
 * is print. The standing line rides the invoice's
 * server-shaped figures (total / credit applied / balance
 * due), the same numbers the invoices page shows.
 */
export default function CreditMemoDoc({ memo, invoice, business, docStyle }) {
  if (!memo) return null;
  const money = (value) => formatMoney(value || 0, business?.currency, 2);
  const voided = memo.status === 'void';

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
        title={t('print.creditMemoTitle')}
        subtitle={[memo.credit_number, memo.supplier_name].filter(Boolean).join(' · ')}
        fields={[]}
      />

      <div className="mt-3 grid gap-y-0.5 text-[9pt]">
        <LabelRow label={t('ops.invoices.colSupplier')}>{memo.supplier_name || '—'}</LabelRow>
        <LabelRow label={t('ops.credits.colInvoice')}>{memo.invoice_number || '—'}</LabelRow>
        {memo.credit_number ? (
          <LabelRow label={t('ops.credits.creditNumberLabel')}>{memo.credit_number}</LabelRow>
        ) : null}
        <LabelRow label={t('ops.credits.dateLabel')}>
          {memo.credit_date ? formatBusinessDate(memo.credit_date, business) : '—'}
        </LabelRow>
        {memo.reason ? <LabelRow label={t('ops.credits.reasonLabel')}>{memo.reason}</LabelRow> : null}
        <LabelRow label={t('ops.invoices.colStatus')}>
          {voided ? t('ops.credits.statusVoid') : t('ops.credits.statusApplied')}
        </LabelRow>
        {memo.note ? (
          <p className="whitespace-pre-line">
            <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
              {t('ops.invoices.noteLabel')}{' '}
            </span>
            {memo.note}
          </p>
        ) : null}
      </div>

      <div className="mt-3 ml-auto w-[80mm] text-[9pt]">
        <div className="flex justify-between border-b border-black/25 py-1">
          <span>{t('ops.credits.amountLabel')}</span>
          <span className="numeric font-semibold">{money(memo.amount)}</span>
        </div>
        {invoice ? (
          <p className="py-1 text-[8pt] text-black/70">
            {t('ops.credits.remainingLine', {
              total: money(invoice.total),
              credited: money(invoice.credit_total),
              owed: money(invoice.balance_due),
            })}
          </p>
        ) : null}
      </div>

      <p className="mt-3 border-t border-black/25 pt-2 font-mono text-[6.5pt] uppercase tracking-wide text-black/60">
        {t('print.creditMemoRecordNote')}
      </p>
      <PrintedAt className="mt-1" />
      <DecoFooter style={docStyle} className="mt-3" />
    </div>
  );
}
