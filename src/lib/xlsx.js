/**
 * Excel (.xlsx) reading and writing — FAIL-CLOSED STUB (T1).
 *
 * The Base44 app used `xlsx@0.20.3`, which carries unpatched CVEs
 * (CVE-2023-30533 Prototype Pollution, CVE-2024-22363 ReDoS). The twin
 * does NOT carry that library over: the swap to a maintained library
 * (e.g. ExcelJS) happens with the import/export port in T3/T5, proven
 * by the import/export test suites.
 *
 * Until then every workbook operation here throws a clear error instead
 * of pretending to work — an import or export that silently produced
 * nothing (or wrong data) would be worse than refusing. The constants
 * stay so the size/row limits remain visible to callers.
 */

export const MAX_IMPORT_BYTES = 12 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20000;

const NOT_READY = new Error(
  'Excel (.xlsx) support is not yet implemented — the xlsx library swap lands with the import/export port (T3/T5). CSV import/export is unaffected.',
);

export async function readWorkbookFile() {
  throw NOT_READY;
}

export function buildWorkbook() {
  throw NOT_READY;
}

export function downloadWorkbook() {
  throw NOT_READY;
}

export function downloadSheets() {
  throw NOT_READY;
}
