import { t } from '@/lib/i18n';
import { formatBusinessDate, formatTimeOnly } from '@/lib/dates';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import DocHeader from './DocHeader';

/**
 * The inspection-ready packet (plan release 370, Nov 26,
 * 2026): ONE Studio document gathering the whole food-safety
 * family's papers for the inspector's date range — the
 * temperature logs, the cooling / reheating / sanitizer logs,
 * and the waste log — in the business's saved Studio style
 * and language. PREVIEW = PRINT, like every Studio paper:
 * the page shows this exact document and prints this exact
 * document. The filled temperature-log sheet (TempLogDoc)
 * stays its own paper; the packet gathers the family, it
 * does not rebuild what exists.
 */

const TH = 'border-b border-black pb-1 text-left font-mono text-[6.5pt] uppercase tracking-wide';
const TD = 'py-1 align-top text-[9pt]';
const SECTION = 'mt-4 mb-1 text-[11pt] font-semibold';

function WhenCell({ row, business }) {
  return (
    <td className={TD}>
      {row.created_date ? formatBusinessDate(row.created_date, business) : ''}
      {row.created_date ? <span className="block text-[8pt]">{formatTimeOnly(row.created_date)}</span> : null}
    </td>
  );
}

export default function InspectionPacketDoc({ tempLogs = [], safetyLogs = [], wasteEntries = [], pestVisits = [], calibrationLogs = [], business, docStyle, fromLabel = '', toLabel = '' }) {
  const range = fromLabel && toLabel ? `${fromLabel} – ${toLabel}` : '';
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
      <DecoHeader style={docStyle} className="mb-2" />
      <DocHeader business={business} title={t('foodSafety.packet.docTitle')} subtitle={t('foodSafety.packet.docSubtitle')} style={docStyle} />
      {range ? <p className="mb-2 text-[9pt]">{range}</p> : null}

      <h2 className={SECTION}>{t('ops.tempLogs.title')}</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-[18%]`}>{t('ops.tempLogs.colWhen')}</th>
            <th className={TH}>{t('ops.tempLogs.colUnit')}</th>
            <th className={TH}>{t('ops.tempLogs.colReading')}</th>
            <th className={TH}>{t('ops.tempLogs.colRange')}</th>
            <th className={TH}>{t('ops.tempLogs.colBy')}</th>
          </tr>
        </thead>
        <tbody>
          {tempLogs.map((log) => (
            <tr key={log.id} className="border-b border-black/15">
              <WhenCell row={log} business={business} />
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

      <h2 className={SECTION}>{t('foodSafety.logs.title')}</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-[18%]`}>{t('ops.tempLogs.colWhen')}</th>
            <th className={TH}>{t('foodSafety.packet.colKind')}</th>
            <th className={TH}>{t('foodSafety.logs.colItem')}</th>
            <th className={TH}>{t('ops.tempLogs.colReading')}</th>
            <th className={TH}>{t('ops.tempLogs.colRange')}</th>
            <th className={TH}>{t('ops.tempLogs.colBy')}</th>
          </tr>
        </thead>
        <tbody>
          {safetyLogs.map((log) => (
            <tr key={log.id} className="border-b border-black/15">
              <WhenCell row={log} business={business} />
              <td className={TD}>{t(`foodSafety.logs.kind.${log.kind}`)}</td>
              <td className={TD}>
                <span className="font-semibold">{log.subject_name || ''}</span>
                {log.location_name ? <span className="block text-[8pt]">{log.location_name}</span> : null}
                {log.corrective_action ? (
                  <span className="block text-[8pt]">{t('ops.tempLogs.correctivePrefix')}: {log.corrective_action}</span>
                ) : null}
              </td>
              <td className={TD}>{log.unit === 'ppm' ? `${log.reading} ppm` : `${log.reading}°${log.unit || ''}`}</td>
              <td className={TD}>{log.in_range ? t('ops.tempLogs.inRange') : t('ops.tempLogs.outOfRange')}</td>
              <td className={TD}>{log.user_name || log.created_by || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={SECTION}>{t('ops.waste.title')}</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-[18%]`}>{t('ops.waste.colDate')}</th>
            <th className={TH}>{t('ops.waste.colProduct')}</th>
            <th className={TH}>{t('ops.waste.colQuantity')}</th>
            <th className={TH}>{t('ops.waste.colReason')}</th>
            <th className={TH}>{t('ops.waste.colLocation')}</th>
          </tr>
        </thead>
        <tbody>
          {wasteEntries.map((entry) => (
            <tr key={entry.id} className="border-b border-black/15">
              <WhenCell row={entry} business={business} />
              <td className={TD}>
                <span className="font-semibold">{entry.product_name || ''}</span>
                {entry.note ? <span className="block text-[8pt]">{entry.note}</span> : null}
              </td>
              <td className={TD}>{entry.quantity}</td>
              <td className={TD}>{entry.reason ? t(`ops.waste.reason.${entry.reason}`) : ''}</td>
              <td className={TD}>{entry.location_name || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={SECTION}>{t('pestCal.pestTitle')}</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-[14%]`}>{t('pestCal.date')}</th>
            <th className={TH}>{t('pestCal.company')}</th>
            <th className={TH}>{t('pestCal.areas')}</th>
            <th className={TH}>{t('pestCal.findings')}</th>
            <th className={TH}>{t('pestCal.nextVisit')}</th>
            <th className={TH}>{t('pestCal.report')}</th>
          </tr>
        </thead>
        <tbody>
          {pestVisits.map((visit) => (
            <tr key={visit.id} className="border-b border-black/15">
              <td className={TD}>{visit.visit_date || (visit.created_date ? formatBusinessDate(visit.created_date, business) : '')}</td>
              <td className={TD}>
                <span className="font-semibold">{visit.company || ''}</span>
                {visit.technician ? <span className="block text-[8pt]">{visit.technician}</span> : null}
              </td>
              <td className={TD}>{visit.areas_treated || ''}</td>
              <td className={TD}>{visit.findings || ''}</td>
              <td className={TD}>{visit.next_visit_on || ''}</td>
              <td className={TD}>{visit.has_report ? (visit.report_filename || t('pestCal.report')) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className={SECTION}>{t('pestCal.calTitle')}</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-[18%]`}>{t('ops.tempLogs.colWhen')}</th>
            <th className={TH}>{t('pestCal.thermometer')}</th>
            <th className={TH}>{t('ops.tempLogs.colReading')}</th>
            <th className={TH}>{t('pestCal.outcome')}</th>
            <th className={TH}>{t('pestCal.initials')}</th>
          </tr>
        </thead>
        <tbody>
          {calibrationLogs.map((check) => (
            <tr key={check.id} className="border-b border-black/15">
              <WhenCell row={check} business={business} />
              <td className={TD}>{check.thermometer_name || ''}</td>
              <td className={TD}>{`${check.reading}°${check.unit || ''}`}</td>
              <td className={TD}>{check.outcome === 'pass' ? t('pestCal.pass') : t('pestCal.adjusted')}</td>
              <td className={TD}>{check.initials || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <DecoFooter style={docStyle} />
      <PrintedAt />
    </div>
  );
}
