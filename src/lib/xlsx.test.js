import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { readWorkbookFile } from './xlsx.js';

/**
 * Security scan, Nov 6 2026: xlsx@0.18.5 has two known vulnerabilities
 * (CVE-2023-30533 prototype pollution, CVE-2024-22363 ReDoS) with no fix
 * on npm. The dependency is now the official SheetJS 0.20.3 tarball, and
 * this test proves the import path still opens a real .xlsx file.
 */

test('xlsx is the patched 0.20.3 SheetJS release, not 0.18.5', () => {
  assert.ok(String(XLSX.version).startsWith('0.20.3'), `expected xlsx 0.20.3, got ${XLSX.version}`);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.dependencies.xlsx, 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz');
});

test('zod is gone: nothing imports it and it is not a dependency', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.dependencies?.zod, undefined);
  assert.equal(pkg.devDependencies?.zod, undefined);
});

test('readWorkbookFile opens a real .xlsx fixture and keeps leading-zero codes', async () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['SKU', 'Qty'],
    ['001234567890', 5],
    ['ABC-123', 2],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Stock');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const file = new File([bytes], 'stock.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const { sheets } = await readWorkbookFile(file);
  assert.equal(sheets.length, 1);
  assert.deepEqual(sheets[0].headers, ['SKU', 'Qty']);
  assert.deepEqual(sheets[0].rows, [
    ['001234567890', '5'],
    ['ABC-123', '2'],
  ]);
});
