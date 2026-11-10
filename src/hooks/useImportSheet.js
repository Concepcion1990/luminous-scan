import { useState } from 'react';
import { parseCsv } from '@/lib/csvImport';

/**
 * Reads one spreadsheet — CSV or a real Excel workbook — and remembers the chosen
 * worksheet and column mapping. `guess` decides the field suggested for a column.
 */
export default function useImportSheet(guess = () => '') {
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState([]);
  const [sheetName, setSheetName] = useState('');
  const [table, setTable] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [mapping, setMapping] = useState([]);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);

  const loadSheet = (sheet) => {
    setSheetName(sheet.name);
    setTable({ headers: sheet.headers, rows: sheet.rows });
    setMapping(sheet.headers.map((header) => guess(header)));
    setWarnings(sheet.warnings || []);
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setReading(true);
    try {
      let parsed;
      if (/\.(csv|txt)$/i.test(file.name)) {
        const csv = parseCsv(await file.text());
        if (!csv.headers.length) throw new Error('That file has no rows to read. Check the first row holds your column names.');
        parsed = [{ name: 'CSV', ...csv, warnings: [] }];
      } else {
        const { readWorkbookFile } = await import('@/lib/xlsx');
        parsed = (await readWorkbookFile(file)).sheets;
      }
      setFileName(file.name);
      setSheets(parsed);
      loadSheet(parsed[0]);
    } catch (err) {
      setError(err?.message || 'That file could not be read.');
    } finally {
      setReading(false);
    }
  };

  const chooseSheet = (name) => {
    const sheet = sheets.find((entry) => entry.name === name);
    if (sheet) loadSheet(sheet);
  };

  const changeMapping = (column, field) => {
    setMapping((current) => current.map((value, index) => (index === column ? field : value)));
  };

  const reset = () => {
    setFileName('');
    setSheets([]);
    setSheetName('');
    setTable(null);
    setWarnings([]);
    setMapping([]);
    setError('');
  };

  return {
    fileName,
    sheets,
    sheetName,
    table,
    warnings,
    mapping,
    error,
    reading,
    setError,
    onFile,
    chooseSheet,
    changeMapping,
    reset,
  };
}