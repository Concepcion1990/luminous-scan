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
 *
 * The prints build (Nov 25, 2026) adds a blank hand-fill twin
 * for every record paper: the weekly schedule, the timesheet,
 * the payroll register, the training record, Business
 * Policies & Terms (two headed sections of ruled lines — the
 * owner writes their own words by hand), the staff roster,
 * the product & price list and the supplier directory. Like
 * the first three, the twins are for EVERYONE, both plans —
 * a blank sheet shows no one's records.
 */
export const BLANK_FORMS = [
  { key: 'count', labelKey: 'print.countSheetTitle' },
  { key: 'pick', labelKey: 'print.pickListTitle' },
  { key: 'temp', labelKey: 'ops.tempLogs.title' },
  { key: 'schedule', labelKey: 'workforce.schedule.title' },
  { key: 'timesheet', labelKey: 'print.timesheetTitle' },
  { key: 'payroll', labelKey: 'print.payrollRegisterTitle' },
  { key: 'training', labelKey: 'training.team.record' },
  { key: 'policies', labelKey: 'settings.policies.title' },
  { key: 'roster', labelKey: 'print.staffRosterTitle' },
  { key: 'pricelist', labelKey: 'print.priceListTitle' },
  { key: 'suppliers', labelKey: 'print.supplierDirectoryTitle' },
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
  schedule: [
    ['workforce.schedule.person', 'w-[30mm]'],
    ['workforce.day.0', 'w-[21mm]'],
    ['workforce.day.1', 'w-[21mm]'],
    ['workforce.day.2', 'w-[21mm]'],
    ['workforce.day.3', 'w-[21mm]'],
    ['workforce.day.4', 'w-[21mm]'],
    ['workforce.day.5', 'w-[21mm]'],
    ['workforce.day.6', 'w-[21mm]'],
  ],
  timesheet: [
    ['print.transferDate', 'w-[24mm]'],
    ['workforce.schedule.person', 'w-[34mm]'],
    ['workforce.schedule.start', 'w-[22mm]'],
    ['workforce.schedule.end', 'w-[22mm]'],
    ['payroll.hours.breaks', 'w-[30mm]'],
    ['print.colHours', 'w-[20mm]'],
    ['print.colNotes', ''],
  ],
  payroll: [
    ['training.team.person', 'w-[34mm]'],
    ['payroll.hours.regular', 'w-[27mm]'],
    ['payroll.hours.overtime', 'w-[27mm]'],
    ['payroll.gross', ''],
    ['payroll.deductions', ''],
    ['payroll.net', ''],
  ],
  training: [
    ['training.team.person', 'w-[36mm]'],
    ['print.colLesson', ''],
    ['print.colScore', 'w-[30mm]'],
    ['print.transferDate', 'w-[26mm]'],
  ],
  roster: [
    ['staff.memberDialog.nameLabel', 'w-[36mm]'],
    ['staff.memberDialog.roleLabel', 'w-[30mm]'],
    ['print.fieldLocation', 'w-[30mm]'],
    ['staff.memberDialog.emailLabel', ''],
    ['suppliers.phone', 'w-[30mm]'],
  ],
  pricelist: [
    ['print.colProductName', ''],
    ['SKU', 'w-[32mm]'],
    ['products.sortCategory', 'w-[34mm]'],
    ['products.sortPrice', 'w-[28mm]'],
  ],
  suppliers: [
    ['suppliers.supplierName', 'w-[36mm]'],
    ['suppliers.contact', 'w-[30mm]'],
    ['suppliers.phone', 'w-[30mm]'],
    ['suppliers.email', ''],
    ['suppliers.accountNumberLabel', 'w-[28mm]'],
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
  schedule: [['print.fieldWeekOf', 'w-[34mm]']],
  timesheet: [
    ['workforce.schedule.person', 'w-[34mm]'],
    ['print.fieldPeriod', 'w-[34mm]'],
  ],
  payroll: [['print.fieldPeriod', 'w-[34mm]']],
  training: [['workforce.schedule.person', 'w-[34mm]']],
  policies: [],
  roster: [],
  pricelist: [['print.fieldLocation', 'w-[34mm]']],
  suppliers: [],
};

const FORM_ROWS = {
  count: 20, pick: 20, temp: 18,
  schedule: 10, timesheet: 16, payroll: 12, training: 12,
  roster: 12, pricelist: 20, suppliers: 12,
};

/** Sectioned blanks (no table): headed runs of ruled lines —
 *  today only Policies & Terms, where the writing itself is
 *  the form. [headingKey, ruledLines] per section. */
const FORM_SECTIONS = {
  policies: [
    ['settings.policies.storePolicies', 12],
    ['settings.policies.termsConditions', 12],
  ],
};

export default function BlankFormDoc({ kind, business, docStyle }) {
  const form = BLANK_FORMS.find((entry) => entry.key === kind) || BLANK_FORMS[0];
  const columns = FORM_COLUMNS[form.key] || [];
  const sections = FORM_SECTIONS[form.key];
  const rows = Array.from({ length: FORM_ROWS[form.key] || 0 }, (_, index) => index);
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
        fields={(FORM_FIELDS[form.key] || []).map(([labelKey, width]) => [t(labelKey), width])}
      />

      {sections ? (
        sections.map(([headingKey, lines]) => (
          <div key={headingKey} className="mt-3">
            <h3 className="font-display text-[12pt] font-semibold">{t(headingKey)}</h3>
            {Array.from({ length: lines }, (_, index) => (
              <div key={index} className="h-[8mm] border-b border-black/25" />
            ))}
          </div>
        ))
      ) : (
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
      )}

      <PrintedAt className="mt-2" />
      <DecoFooter style={docStyle} className="mt-3" />
    </div>
  );
}
