/**
 * Downloadable templates, one per import mode. Codes are written as text cells so
 * a UPC or SKU keeps every digit and any leading zeroes.
 */

import { downloadCsv, toCsv } from '@/lib/csv';

const TEXT_KEYS = new Set(['id', 'sku', 'upc', 'barcode', 'isbn', 'reference']);

export function downloadTemplateCsv(name, fields, example) {
  const columns = fields.map((field) => ({
    label: field.label,
    value: (row) => row[field.key] ?? '',
  }));
  downloadCsv(name, toCsv(columns, [example]));
}

export async function downloadTemplateXlsx(name, fields, example) {
  const { downloadSheets } = await import('@/lib/xlsx');
  downloadSheets(
    [
      {
        name: 'Template',
        columns: fields.map((field) => ({
          label: field.label,
          text: TEXT_KEYS.has(field.key),
          value: (row) => row[field.key] ?? '',
        })),
        rows: [example],
      },
    ],
    name
  );
}