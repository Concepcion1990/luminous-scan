import { t } from '@/lib/i18n';
import { formatBusinessDate, formatTimeOnly } from '@/lib/dates';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import DocHeader from './DocHeader';

/**
 * The filled temperature log (the prints build, Nov 25, 2026):
 * the restaurant temperature readings as a Studio sheet for
 * the food-safety file — when, which unit, the reading, in or
 * out of range, who took it, and the corrective action under
 * any reading that needed one. Its blank twin shipped with
 * the 368 print family; this filled sheet completes the file.
 * The Temperature logs page is Business-gated (the Restaurant
 * Corner), and the paper follows that gating exactly.
 */

const TH = 'border-b border-black pb-1 text-left font-mono text-[6.5pt] uppercase tracking-wide';
const TD = 'py-1 align-top text-[9pt]';

export default function TempLogDoc({ logs = [], business, docStyle }) {
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
        <DecoHeader style={docStyle} className="mb-2" />
        <DocHeader business={business} title={t('ops.tempLogs.title')} subtitle={t('ops.tempLogs.subtitle')} style={docStyle} />
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${TH} w-[20%]`}>{t('ops.tempLogs.colWhen')}</th>
              <th className={TH}>{t('ops.tempLogs.colUnit')}</th>
              <th className={TH}>{t('ops.tempLogs.colReading')}</th>
              <th className={TH}>{t('ops.tempLogs.colRange')}</th>
              <th className={TH}>{t('ops.tempLogs.colBy')}</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-black/15">
                <td className={TD}>
                  {log.created_date ? formatBusinessDate(log.created_date, business) : ''}
                  {log.created_date ? <span className="block text-[8pt]">{formatTimeOnly(log.created_date)}</span> : null}
                </td>
                <td className={TD}>
                  <span className="font-semibold">{log.unit_name || ''}</span>
                  {log.location_name ? <span className="block text-[8pt]">{log.location_name}</span> : null}
                  {log.corrective_action ? (
                    <span className="block text-[8pt]">{t('ops.tempLogs.correctivePrefix')}: {log.corrective_action}</span>
                  ) : null}
                </td>
                <td className={TD}>{`${log.temperature}°${log.scale || ''}`}</td>
                <td className={TD}>{log.in_range ? t('ops.tempLogs.inRange') : t('ops.tempLogs.outOfRange')}</td>
                <td className={TD}>{log.user_name || log.created_by || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <DecoFooter style={docStyle} />
        <PrintedAt />
    </div>
  );
}
