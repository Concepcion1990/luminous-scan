/**
 * Server-side .xlsx writing with ExcelJS — T3 (the xlsx swap).
 * Mirrors the rules in src/lib/xlsx.js: codes are text cells (no
 * dropped leading zeroes, no scientific notation), money keeps its
 * numeric type and format, everything else is a plain string cell
 * (never a formula). Returns a Buffer for the export endpoint.
 */
import ExcelJS from 'exceljs';

const UNSAFE_SHEET_CHARS = /[\\/?*[\]:]/g;

function safeSheetName(name, index) {
  const clean = String(name || '')
    .replace(UNSAFE_SHEET_CHARS, ' ')
    .trim()
    .slice(0, 31);
  return clean || `Sheet ${index + 1}`;
}

function numberFormat(label) {
  if (/(cost|price|value|total|subtotal|shipping|tax|margin|refund|amount)/i.test(label || '')) return '#,##0.00';
  if (/(qty|quantity|units|on hand|available|held|reorder|count|products|skus|days)/i.test(label || '')) return '#,##0';
  return undefined;
}

function columnWidth(column, rows) {
  let width = String(column.label ?? '').length + 2;
  rows.slice(0, 300).forEach((row) => {
    const value = column.value ? column.value(row) : row?.[column.key];
    if (value === null || value === undefined) return;
    const length = String(value).split('\n').reduce((longest, line) => Math.max(longest, line.length), 0) + 1;
    if (length > width) width = length;
  });
  return Math.min(Math.max(width, 9), 44);
}

/** sheets: [{ name, columns, rows }] — one worksheet each. */
export async function buildWorkbookBuffer(sheets) {
  const workbook = new ExcelJS.Workbook();
  sheets.forEach((sheet, index) => {
    const ws = workbook.addWorksheet(safeSheetName(sheet.name, index));
    ws.columns = sheet.columns.map((column) => ({ width: columnWidth(column, sheet.rows) }));
    ws.addRow(sheet.columns.map((column) => String(column.label ?? '')));
    sheet.rows.forEach((row) => {
      const values = sheet.columns.map((column) => {
        const value = column.value ? column.value(row) : row?.[column.key];
        if (value === null || value === undefined || value === '') return null;
        if (column.text) return String(value);
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        return String(value);
      });
      const excelRow = ws.addRow(values);
      sheet.columns.forEach((column, c) => {
        const cell = excelRow.getCell(c + 1);
        const value = values[c];
        if (column.text && value !== null) cell.numFmt = '@';
        else if (typeof value === 'number') {
          const fmt = numberFormat(column.label);
          if (fmt) cell.numFmt = fmt;
        }
      });
    });
    if (sheet.rows.length) {
      ws.autoFilter = { from: 'A1', to: ws.getRow(1).getCell(sheet.columns.length).address };
    }
  });
  return workbook.xlsx.writeBuffer();
}
