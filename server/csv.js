/**
 * CSV building — server copy of the escaping rules in src/lib/csv.js
 * (formula-injection guard, leading-zero codes kept as text).
 * The browser keeps its own copy for the ported pages; the server
 * export endpoint uses this one so an export never depends on the
 * browser's data.
 */
function escapeCell(value, asText) {
  let text = value === null || value === undefined ? '' : String(value);
  if (text) {
    const isNumber = /^-?\d+(\.\d+)?$/.test(text);
    if (!isNumber && (/^[=+@\t\r]/.test(text) || /^-[A-Za-z(]/.test(text))) {
      text = `'${text}`;
    }
    if (asText && /^0\d+$/.test(text)) {
      text = `="${text}"`;
    }
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds RFC-style CSV. Columns: [{ label, value(row), text }]. */
export function toCsv(columns, rows) {
  const header = columns.map((column) => escapeCell(column.label)).join(',');
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(column.value(row), column.text)).join(','),
  );
  return [header, ...body].join('\r\n');
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
