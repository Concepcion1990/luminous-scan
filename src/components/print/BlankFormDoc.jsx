import DocHeader from './DocHeader';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * Blank forms (print family, Nov 24, 2026 — the owner's
 * ruling): clean tables with the column headers across the
 * top and EMPTY rows to fill in by hand, for every business
 * on both plans. A blank form wears the owner's own Document
 * Style Studio styling — their logo when they have chosen
 * one, their header design, their footer — through the same
 * DocFrame / DecoHeader / DecoFooter machinery as every
 * filled document; there is no second setup and no bare
 * generic sheet.
 *
 * The forms are the papers the app already knows as filled
 * documents: the stock count sheet, the pick list, and the
 * temperature log (which until now had no paper at all).
 */
export const BLANK_FORMS = [
  { key: 'count', labelKey: 'print.countSheetTitle' },
  { key: 'pick', labelKey: 'print.pickListTitle' },
  { key: 'temp', labelKey: 'ops.tempLogs.title' },
];

const FORM_COLUMNS = {
  count: [
    ['print.colProductName', ''],
    ['SKU', 'w-[29mm]'],
    ['print.colQty', 'w-[20mm]'],
    ['print.colNotes', 'w-[28mm]'],
  ],
  pick: [
    ['print.colDone', 'w-[10mm]'],
    ['print.colProductName', ''],
    ['SKU', 'w-[29mm]'],
    ['print.colQty', 'w-[16mm]'],
    ['print.colLoc', 'w-[18mm]'],
  ],
  temp: [
    ['print.transferDate', 'w-[24mm]'],
    ['print.colTime', 'w-[18mm]'],
    ['ops.tempLogs.unitLabel', ''],
    ['ops.tempLogs.temperatureLabel', 'w-[30mm]'],
    ['print.checkedBy', 'w-[34mm]'],
  ],
};

const FORM_FIELDS = {
  count: [
    ['print.fieldLocation', 'w-[34mm]'],
    ['print.countedBy', 'w-[30mm]'],
  ],
  pick: [
    ['print.fieldOrderBatch', 'w-[34mm]'],
    ['print.fieldPickedBy', 'w-[30mm]'],
  ],
  temp: [['print.fieldLocation', 'w-[34mm]']],
};

const FORM_ROWS = { count: 20, pick: 20, temp: 18 };

export default function BlankFormDoc({ kind, business, docStyle }) {
  const form = BLANK_FORMS.find((entry) => entry.key === kind) || BLANK_FORMS[0];
  const columns = FORM_COLUMNS[form.key];
  const rows = Array.from({ length: FORM_ROWS[form.key] }, (_, index) => index);
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
        title={t(form.labelKey)}
        subtitle={t('print.blankFormSubtitle')}
        fields={FORM_FIELDS[form.key].map(([labelKey, width]) => [t(labelKey), width])}
      />

      <table className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-black text-left font-mono text-[6.5pt] uppercase tracking-wide">
            {columns.map(([labelKey, width]) => (
              <th key={labelKey} className={`${width} py-1 font-normal`}>
                {labelKey.includes('.') ? t(labelKey) : labelKey}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((index) => (
            <tr key={index} className="break-inside-avoid border-b border-black/25">
              {columns.map(([labelKey]) => (
                <td key={labelKey} className="py-1.5">
                  <span className="block h-[6mm]" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <PrintedAt className="mt-2" />
      <DecoFooter style={docStyle} className="mt-3" />
    </div>
  );
}
