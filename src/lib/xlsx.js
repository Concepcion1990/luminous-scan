/**
 * Native Microsoft Excel (.xlsx) reading and writing — ExcelJS (T3).
 *
 * The Base44 app used `xlsx@0.20.3`, which carries unpatched CVEs
 * (CVE-2023-30533 Prototype Pollution, CVE-2024-22363 ReDoS) with no
 * published fix. The twin does NOT carry that library over: this
 * module is rewritten against ExcelJS (maintained), with the same
 * exported shapes the import/export code already uses, proven by the
 * import/export parity tests (test:t3).
 *
 * Codes are written as text cells so UPCs, ISBNs and SKUs keep every
 * digit and any leading zeroes; quantities and money keep their
 * numeric type and format. Reading uses the text Excel last displayed
 * for each cell, so nothing is recalculated and no macro is ever run.
 */
import ExcelJS from 'exceljs';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const MAX_IMPORT_BYTES = 12 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20000;

const UNSAFE_SHEET_CHARS = /[\\/?*[\]:]/g;

function safeSheetName(name, index) {
  const clean = String(name || '')
    .replace(UNSAFE_SHEET_CHARS, ' ')
    .trim()
    .slice(0, 31);
  return clean || `Sheet ${index + 1}`;
}

/** The text Excel shows for one cell — keeps text-formatted codes intact. */
function cellText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    // cell.text is the formatted display (e.g. a text-formatted code
    // such as 001234567890, or a date as shown). Fall back to the raw
    // value when ExcelJS has no display text for the cell.
    return typeof cell.text === 'string' && cell.text !== '' ? cell.text : String(value);
  }
  if (value instanceof Date) {
    return typeof cell.text === 'string' && cell.text !== ''
      ? cell.text
      : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (value.result !== undefined && value.result !== null) return String(value.result);
    if (typeof value.hyperlink === 'string') return value.hyperlink;
  }
  return String(value);
}

/** Cells Excel has already flattened to scientific notation can never be recovered. */
function ambiguityWarnings(worksheet, name) {
  const warnings = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (warnings.length >= 5 || rowNumber > 5001) return;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (warnings.length >= 5) return;
      if (typeof cell.value !== 'number') return;
      const shown = String(cell.text ?? cell.value ?? '');
      if (!/^-?\d(?:\.\d+)?E\+\d+$/i.test(shown)) return;
      const columnLetter = String.fromCharCode(64 + colNumber);
      warnings.push(
        `"${name}" row ${rowNumber}, column ${columnLetter} reads ${shown}: the code was saved as a ` +
          'number and has already lost digits. Set that column to Text in Excel, retype the code, and upload again.',
      );
    });
  });
  return warnings;
}

function sheetTable(worksheet) {
  const name = worksheet.name;
  const grid = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells[cell.col - 1] = cellText(cell).trim();
    });
    grid.push(cells.map((cell) => cell ?? ''));
  });
  const headerIndex = grid.findIndex((row) => row.some(Boolean));
  if (headerIndex === -1) return { name, headers: [], rows: [], warnings: [] };

  const width = Math.max(1, ...grid.map((row) => row.length));
  const headers = Array.from(
    { length: width },
    (_, index) => grid[headerIndex][index] || `Column ${index + 1}`,
  );
  const rows = grid
    .slice(headerIndex + 1)
    .filter((row) => row.some(Boolean))
    .map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));

  return { name, headers, rows, warnings: ambiguityWarnings(worksheet, name) };
}

/** Opens a workbook in the browser and returns every worksheet with rows. */
export async function readWorkbookFile(file) {
  if (!file) throw new Error('Choose a spreadsheet first.');
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('That workbook is larger than 12 MB. Split it into smaller files and import them in turn.');
  }
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error('That workbook could not be opened. Save it again as .xlsx and upload it once more.');
  }
  if (!workbook.worksheets?.length) throw new Error('That workbook has no worksheets.');
  const sheets = workbook.worksheets
    .map((worksheet) => sheetTable(worksheet))
    .filter((sheet) => sheet.headers.length);
  if (!sheets.length) throw new Error('No worksheet in that file has any rows to read.');
  const oversized = sheets.find((sheet) => sheet.rows.length > MAX_IMPORT_ROWS);
  if (oversized) {
    throw new Error(
      `"${oversized.name}" holds ${oversized.rows.length} rows; the limit for one import is ${MAX_IMPORT_ROWS}. Split it into parts.`,
    );
  }
  return { sheets };
}

function numberFormat(label) {
  if (/(cost|price|value|total|subtotal|shipping|tax|margin|refund|amount)/i.test(label || '')) return '#,##0.00';
  if (/(qty|quantity|units|on hand|available|held|reorder|count|products|skus|days)/i.test(label || '')) {
    return '#,##0';
  }
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

/** One worksheet: header row, typed cells, sensible widths and a filter row. */
function worksheetFor(workbook, { columns, rows }, index, name) {
  const ws = workbook.addWorksheet(safeSheetName(name, index));
  ws.columns = columns.map((column) => ({ width: columnWidth(column, rows) }));
  ws.addRow(columns.map((column) => String(column.label ?? '')));
  rows.forEach((row) => {
    const values = columns.map((column) => {
      const value = column.value ? column.value(row) : row?.[column.key];
      if (value === null || value === undefined || value === '') return null;
      // Codes are always text cells: no scientific notation, no dropped zeroes.
      if (column.text) return String(value);
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      // Everything else is written as a string cell, never a formula.
      return String(value);
    });
    const excelRow = ws.addRow(values);
    columns.forEach((column, c) => {
      const cell = excelRow.getCell(c + 1);
      const value = values[c];
      if (column.text && value !== null) cell.numFmt = '@';
      else if (typeof value === 'number') {
        const fmt = numberFormat(column.label);
        if (fmt) cell.numFmt = fmt;
      }
    });
  });
  if (rows.length) {
    ws.autoFilter = { from: 'A1', to: ws.getRow(1).getCell(Math.max(columns.length, 1)).address };
  }
  return ws;
}

/** sheets: [{ name, columns, rows }] — one worksheet each. Returns an ExcelJS Workbook. */
export function buildWorkbook(sheets) {
  const workbook = new ExcelJS.Workbook();
  sheets.forEach((sheet, index) => {
    worksheetFor(workbook, sheet, index, sheet.name);
  });
  return workbook;
}

export async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}

/**
 * Builds and downloads a real .xlsx file. Returns the filename
 * synchronously (the download itself completes async) so existing
 * call sites that use the return value keep working.
 */
export function downloadSheets(sheets, filename) {
  const workbook = buildWorkbook(sheets);
  downloadWorkbook(workbook, filename).catch(() => {
    // The download failed in this browser; the caller already has
    // the filename and can offer a retry. Never throw from a click.
  });
  return filename;
}
