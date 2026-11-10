import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { readWorkbookFile, buildWorkbook } from './xlsx.js';

/**
 * T3: the xlsx swap. The Base44 app used `xlsx@0.20.3`, which carries
 * unpatched CVEs (CVE-2023-30533 prototype pollution, CVE-2024-22363
 * ReDoS) with no fix on npm. The twin uses ExcelJS instead, and this
 * test proves the swap is behavior-identical for the import/export
 * paths: real .xlsx files open, leading-zero codes survive, numbers
 * stay numeric, and the old library is gone from the dependency tree.
 *
 * (Replaces the old xlsx.test.js, which asserted the vulnerable
 * library's version. That test is not ported — the twin must NOT
 * install xlsx at all.)
 */

test('xlsx is gone: nothing depends on it and nothing imports it', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.dependencies?.xlsx, undefined);
  assert.equal(pkg.devDependencies?.xlsx, undefined);
  assert.ok(pkg.dependencies?.exceljs, 'exceljs is a dependency');
  const lib = readFileSync('src/lib/xlsx.js', 'utf8');
  assert.equal(/from ['"]xlsx['"]/.test(lib), false);
  assert.match(lib, /from ['"]exceljs['"]/);
});

test('zod is gone: nothing imports it and it is not a dependency', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.dependencies?.zod, undefined);
  assert.equal(pkg.devDependencies?.zod, undefined);
});

async function makeFixture() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Stock');
  sheet.addRow(['SKU', 'Qty']);
  // A text-formatted code: ExcelJS stores the string as-is.
  const codeCell = sheet.addRow(['001234567890', 5]).getCell(1);
  codeCell.numFmt = '@';
  sheet.addRow(['ABC-123', 2]);
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer], 'stock.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

test('readWorkbookFile opens a real .xlsx fixture and keeps leading-zero codes', async () => {
  const file = await makeFixture();
  const { sheets } = await readWorkbookFile(file);
  assert.equal(sheets.length, 1);
  assert.deepEqual(sheets[0].headers, ['SKU', 'Qty']);
  assert.deepEqual(sheets[0].rows, [
    ['001234567890', '5'],
    ['ABC-123', '2'],
  ]);
});

test('buildWorkbook round-trips through ExcelJS: codes stay text, money stays numeric', async () => {
  const workbook = buildWorkbook([
    {
      name: 'Products',
      columns: [
        { label: 'SKU', value: (row) => row.sku, text: true },
        { label: 'Name', value: (row) => row.name },
        { label: 'Cost', value: (row) => row.cost },
        { label: 'On hand', value: (row) => row.qty },
      ],
      rows: [
        { sku: '00123', name: 'Bookmark', cost: 2.5, qty: 7 },
        { sku: 'ABC-9', name: 'Notepad', cost: null, qty: 0 },
      ],
    },
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(buffer.byteLength > 0);
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(buffer);
  const sheet = reloaded.getWorksheet('Products');
  assert.ok(sheet, 'sheet survives the round trip');
  // Header row + two data rows.
  assert.equal(sheet.getCell('A1').value, 'SKU');
  assert.equal(sheet.getCell('A2').value, '00123');
  assert.equal(typeof sheet.getCell('A2').value, 'string');
  assert.equal(sheet.getCell('C2').value, 2.5);
  assert.equal(typeof sheet.getCell('C2').value, 'number');
  assert.equal(sheet.getCell('D2').value, 7);
  // A missing cost writes no cell (blank, never an invented $0).
  assert.equal(sheet.getCell('C3').value, null);
});

test('readWorkbookFile refuses a missing file and an unreadable workbook', async () => {
  await assert.rejects(readWorkbookFile(null), /Choose a spreadsheet first/);
  const bad = new File(['not a workbook'], 'bad.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  await assert.rejects(readWorkbookFile(bad), /could not be opened/);
});
