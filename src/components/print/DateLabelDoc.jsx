import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { formatShortDate } from '@/lib/dates';
import { t } from '@/lib/i18n';

/**
 * Date labels (release 361, Nov 23, 2026): one label per
 * stock batch — what it is, where it sits, the day it was
 * received and the day it must be used by. A member of the
 * Document Style Studio family, like every printed sheet;
 * preview is print.
 */
export default function DateLabelDoc({ batches, business, docStyle }) {
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
      <DecoHeader style={docStyle} className="mb-2" />
      <div className="grid grid-cols-2 gap-3">
        {(batches || []).map((batch) => (
          <div key={batch.id} className="rounded border border-black/50 p-3">
            <p className="text-[12pt] font-semibold leading-tight">{batch.product_name}</p>
            {batch.location_name ? (
              <p className="mt-0.5 text-[9pt] text-black/70">{batch.location_name}</p>
            ) : null}
            <div className="mt-2 grid gap-y-0.5 text-[9pt]">
              <p>
                <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.labelReceived')} </span>
                {batch.created_date ? formatShortDate(batch.created_date) : '—'}
              </p>
              <p>
                <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.labelUseBy')} </span>
                <span className="font-semibold">{batch.expires_on ? formatShortDate(batch.expires_on) : '—'}</span>
              </p>
              <p>
                <span className="font-mono text-[6.5pt] uppercase tracking-wide text-black/60">{t('print.labelQuantity')} </span>
                {batch.quantity}
              </p>
            </div>
          </div>
        ))}
      </div>
      <DecoFooter style={docStyle} className="mt-3" />
      <PrintedAt className="mt-1 text-right" />
    </div>
  );
}
