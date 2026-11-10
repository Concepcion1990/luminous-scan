function escapeCell(value, asText) {
  let text = value === null || value === undefined ? '' : String(value);
  if (text) {
    const isNumber = /^-?\d+(\.\d+)?$/.test(text);
    // Stop a spreadsheet from executing a cell as a formula.
    if (!isNumber && (/^[=+@\t\r]/.test(text) || /^-[A-Za-z(]/.test(text))) {
      text = `'${text}`;
    }
    // Keep codes like 00123 readable instead of dropping the leading zeroes.
    if (asText && /^0\d+$/.test(text)) {
      text = `="${text}"`;
    }
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Builds RFC-style CSV. Multiline notes and commas stay intact when quoted.
 * Mark a column `text: true` for codes whose leading zeroes must survive Excel.
 */
export function toCsv(columns, rows) {
  const header = columns.map((column) => escapeCell(column.label)).join(',');
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(column.value(row), column.text)).join(',')
  );
  return [header, ...body].join('\r\n');
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8;') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename, csv) {
  // The BOM keeps accented characters readable when the file opens in Excel.
  downloadText(filename, '\uFEFF' + csv, 'text/csv;charset=utf-8;');
}

export function fileSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function fileStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}