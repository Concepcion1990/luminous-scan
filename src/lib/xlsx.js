/**
 * Native Microsoft Excel (.xlsx) reading and writing.
 *
 * Codes are written as text cells so UPCs, ISBNs and SKUs keep every digit and
 * any leading zeroes; quantities and money keep their numeric type and format.
 * Reading uses the value Excel last displayed, so nothing is recalculated and no
 * macro is ever run.
 */
import * as XLSX from 'xlsx';

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

/** Cells Excel has already flattened to scientific notation can never be recovered. */
function ambiguityWarnings(sheet, name) {
  const warnings = [];
  const ref = sheet['!ref'];
  if (!ref) return warnings;
  const range = XLSX.utils.decode_range(ref);
  const lastRow = Math.min(range.e.r, range.s.r + 5000);
  for (let r = range.s.r; r <= lastRow; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.t !== 'n') continue;
      const shown = String(cell.w ?? cell.v ?? '');
      if (!/^-?\d(?:\.\d+)?E\+\d+$/i.test(shown)) continue;
      warnings.push(
        `"${name}" row ${r + 1}, column ${XLSX.utils.encode_col(c)} reads ${shown}: the code was saved as a ` +
          'number and has already lost digits. Set that column to Text in Excel, retype the code, and upload again.'
      );
      if (warnings.length >= 5) return warnings;
    }
  }
  return warnings;
}

function sheetTable(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) return { name, headers: [], rows: [], warnings: [] };

  // raw:false returns the text Excel shows for each cell, so a text-formatted
  // code such as 001234567890 keeps its leading zeroes.
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
    formula: false,
  });
  const cells = grid.map((row) => (Array.isArray(row) ? row : []).map((cell) => String(cell ?? '').trim()));

  const headerIndex = cells.findIndex((row) => row.some(Boolean));
  if (headerIndex === -1) return { name, headers: [], rows: [], warnings: [] };

  const width = Math.max(1, ...cells.map((row) => row.length));
  const headers = Array.from({ length: width }, (_, index) => cells[headerIndex][index] || `Column ${index + 1}`);
  const rows = cells
    .slice(headerIndex + 1)
    .filter((row) => row.some(Boolean))
    .map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));

  return { name, headers, rows, warnings: ambiguityWarnings(sheet, name) };
}

/** Opens a workbook in the browser and returns every worksheet with rows. */
export async function readWorkbookFile(file) {
  if (!file) throw new Error('Choose a spreadsheet first.');
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('That workbook is larger than 12 MB. Split it into smaller files and import them in turn.');
  }
  const buffer = await file.arrayBuffer();
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: false, cellNF: true, cellText: true });
  } catch {
    throw new Error('That workbook could not be opened. Save it again as .xlsx and upload it once more.');
  }
  if (!workbook.SheetNames?.length) throw new Error('That workbook has no worksheets.');
  const sheets = workbook.SheetNames.map((name) => sheetTable(workbook, name)).filter(
    (sheet) => sheet.headers.length
  );
  if (!sheets.length) throw new Error('No worksheet in that file has any rows to read.');
  const oversized = sheets.find((sheet) => sheet.rows.length > MAX_IMPORT_ROWS);
  if (oversized) {
    throw new Error(
      `"${oversized.name}" holds ${oversized.rows.length} rows; the limit for one import is ${MAX_IMPORT_ROWS}. Split it into parts.`
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
function worksheetFor({ columns, rows }) {
  const sheet = {};
  const put = (r, c, cell) => {
    sheet[XLSX.utils.encode_cell({ r, c })] = cell;
  };

  columns.forEach((column, c) => {
    put(0, c, { t: 's', v: String(column.label ?? '') });
  });

  rows.forEach((row, index) => {
    const r = index + 1;
    columns.forEach((column, c) => {
      const value = column.value ? column.value(row) : row?.[column.key];
      if (value === null || value === undefined || value === '') return;
      // Codes are always text cells: no scientific notation, no dropped zeroes.
      if (column.text) {
        put(r, c, { t: 's', v: String(value) });
        return;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        const z = numberFormat(column.label);
        put(r, c, z ? { t: 'n', v: value, z } : { t: 'n', v: value });
        return;
      }
      if (typeof value === 'boolean') {
        put(r, c, { t: 's', v: value ? 'Yes' : 'No' });
        return;
      }
      // Everything else is written as a string cell, never a formula.
      put(r, c, { t: 's', v: String(value) });
    });
  });

  const lastCol = Math.max(columns.length - 1, 0);
  const dataRef = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: lastCol } });
  sheet['!ref'] = dataRef;
  sheet['!cols'] = columns.map((column) => ({ wch: columnWidth(column, rows) }));
  // Header row filters; the writer in use cannot store a frozen pane, so rows scroll under the header.
  if (rows.length) sheet['!autofilter'] = { ref: dataRef };
  return sheet;
}

/** sheets: [{ name, columns, rows }] — one worksheet each. */
export function buildWorkbook(sheets) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet, index) => {
    XLSX.utils.book_append_sheet(workbook, worksheetFor(sheet), safeSheetName(sheet.name, index));
  });
  return workbook;
}

export function downloadWorkbook(workbook, filename) {
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
  const blob = new Blob([data], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Builds and downloads a real .xlsx file. */
export function downloadSheets(sheets, filename) {
  downloadWorkbook(buildWorkbook(sheets), filename);
  return filename;
}