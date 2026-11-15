import { useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Loader2, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { t } from '@/lib/i18n';
import { IMPORT_FIELDS, guessField, parseCsv } from '@/lib/csvImport';
import { evaluateRows, existingKeys } from '@/lib/importProducts';
import { downloadCsv, toCsv } from '@/lib/csv';
import { scoped } from '@/lib/scoped';
import { createProducts } from '@/lib/entitlements';
import { recordImportEvent } from '@/lib/importCommit';
import { countDistinctProducts } from '@/lib/productDuplicates';
import useEntitlements from '@/hooks/useEntitlements';
import useImportDraft from '@/hooks/useImportDraft';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ColumnMapper from '@/components/import/ColumnMapper';
import ImportPreview from '@/components/import/ImportPreview';
import DryRunPanel from '@/components/import/DryRunPanel';
import ProblemReport from '@/components/import/ProblemReport';

const NO_LOCATION = 'none';

/**
 * CSV import workbench: read the file, match columns, check every row with a dry
 * run, then write only the rows that passed.
 */
export default function ImportWorkbench({ businessId }) {
  const { user } = useAuth();
  const { limits } = useEntitlements();
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState([]);
  const [sheetName, setSheetName] = useState('');
  const [table, setTable] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [mapping, setMapping] = useState([]);
  const [existingProducts, setExistingProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [dryRun, setDryRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  // Pick-and-choose (owner ruling, Nov 15, 2026): rows start ALL
  // ticked; unticking records the row index here and the import
  // takes only the ticked rows. The plan cap governs the TICKED
  // count — never a silent positional trim.
  const [excluded, setExcluded] = useState([]);
  const excludedSet = useMemo(() => new Set(excluded), [excluded]);

  const existing = useMemo(() => existingKeys(existingProducts), [existingProducts]);

  // The dry run is cap-aware (owner ruling, Nov 14, 2026): the room
  // is the plan cap minus the catalog's distinct-original count —
  // the same number the pill and the server cap use.
  const capInfo = useMemo(() => {
    const have = countDistinctProducts(existingProducts);
    const cap = limits?.products ?? null;
    return { have, cap, room: cap == null ? null : Math.max(0, cap - have) };
  }, [existingProducts, limits]);

  // Verdicts are computed WITHOUT the positional cap pass: with
  // pick-and-choose, the cap is judged on the ticked count (see
  // overRoom below), not on file order.
  const report = useMemo(
    () => evaluateRows({ table, mapping, existing, room: null }),
    [table, mapping, existing, capInfo]
  );

  const tickedReadyRows = useMemo(
    () => report.rows.filter((row) => row.status === 'ready' && !excludedSet.has(row.index)),
    [report, excludedSet]
  );
  const effectiveReady = tickedReadyRows.length;
  const tickedUnits = tickedReadyRows.reduce((sum, row) => sum + (row.quantity || 0), 0);
  const overRoom = capInfo.room != null ? Math.max(0, effectiveReady - capInfo.room) : 0;
  const displayReport = { ...report, ready: effectiveReady, over: overRoom, units: tickedUnits };

  const toggleRow = (index, ticked) => {
    setExcluded((current) =>
      ticked ? current.filter((i) => i !== index) : [...current, index]
    );
  };

  const hasName = mapping.includes('name');
  const stockMapped = mapping.includes('stock_qty');
  const withStock = stockMapped && Boolean(locationId) && locationId !== NO_LOCATION;
  const signature = `${fileName}|${mapping.join(',')}|${locationId}|${[...excluded].sort((a, b) => a - b).join('.')}`;
  const needsCheck = !dryRun || dryRun.signature !== signature;

  // The staged import survives leaving (owner ruling, Nov 14,
  // 2026): file, matches, location and the dry-run verdict persist
  // on this device until Start over or a finished import clears
  // them. Restoring also re-reads the catalog so duplicate checks
  // and the room count are current.
  const draftSnapshot = {
    sheet: { fileName, sheets, sheetName, table, warnings, mapping },
    locationId,
    dryRun,
    excluded,
  };
  const { tooLarge: draftTooLarge } = useImportDraft({
    businessId,
    mode: 'create',
    snapshot: draftSnapshot,
    restore: (draft) => {
      const snap = draft.sheet || {};
      setFileName(snap.fileName || '');
      setSheets(snap.sheets || []);
      setSheetName(snap.sheetName || '');
      setTable(snap.table || null);
      setWarnings(snap.warnings || []);
      setMapping(snap.mapping || []);
      setLocationId(draft.locationId || '');
      setDryRun(draft.dryRun || null);
      setExcluded(Array.isArray(draft.excluded) ? draft.excluded : []);
      if (businessId) {
        Promise.all([
          base44.entities.Product.filter(scoped({}, businessId), { limit: 1000 }),
          base44.entities.Location.filter(scoped({}, businessId), { sort: 'name', limit: 100 }),
        ])
          .then(([productPage, locationPage]) => {
            setExistingProducts(productPage.items ?? []);
            setLocations(locationPage.items ?? []);
          })
          .catch(() => {});
      }
    },
  });

  const reset = () => {
    setFileName('');
    setSheets([]);
    setSheetName('');
    setTable(null);
    setWarnings([]);
    setMapping([]);
    setDryRun(null);
    setError('');
    setLocationId('');
    setExcluded([]);
  };

  const loadSheet = (sheet) => {
    setSheetName(sheet.name);
    setTable({ headers: sheet.headers, rows: sheet.rows });
    setMapping(sheet.headers.map(guessField));
    setDryRun(null);
    setExcluded([]);
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setResult(null);
    setDryRun(null);
    setExcluded([]);
    setSheets([]);
    setSheetName('');
    setWarnings([]);
    try {
      // Excel workbooks are read here; CSV goes through the same parser as before.
      let parsedSheets;
      if (/\.(csv|txt)$/i.test(file.name)) {
        const parsed = parseCsv(await file.text());
        if (!parsed.headers.length) {
          setError(t('import.noRowsInFile'));
          return;
        }
        parsedSheets = [{ name: 'CSV', ...parsed, warnings: [] }];
      } else {
        const { readWorkbookFile } = await import('@/lib/xlsx');
        parsedSheets = (await readWorkbookFile(file)).sheets;
      }

      const [productPage, locationPage] = await Promise.all([
        base44.entities.Product.filter(scoped({}, businessId), { limit: 1000 }),
        base44.entities.Location.filter(scoped({}, businessId), { sort: 'name', limit: 100 }),
      ]);
      setFileName(file.name);
      setSheets(parsedSheets);
      setWarnings(parsedSheets.flatMap((sheet) => sheet.warnings));
      setExistingProducts(productPage.items ?? []);
      setLocations(locationPage.items ?? []);
      loadSheet(parsedSheets[0]);
    } catch (err) {
      setError(err?.message || t('import.fileUnreadable'));
    }
  };

  const chooseSheet = (name) => {
    const sheet = sheets.find((entry) => entry.name === name);
    if (sheet) loadSheet(sheet);
  };

  const changeMapping = (column, field) => {
    setMapping((current) => current.map((value, index) => (index === column ? field : value)));
    setDryRun(null);
    setExcluded([]);
  };

  const templateExample = {
    name: 'Example product',
    sku: 'EX-001',
    upc: '195464952825',
    isbn: '9780000000001',
    category: 'Books',
    tags: 'signed, gift',
    unit: 'each',
    cost: '4.50',
    price: '12.99',
    reorder_point: '3',
    stock_qty: '10',
  };

  const downloadTemplate = () => {
    const columns = IMPORT_FIELDS.map((field) => ({
      label: field.label,
      value: (row) => row[field.key],
    }));
    downloadCsv('product-import-template.csv', toCsv(columns, [templateExample]));
  };

  // Codes are written as text cells, so a template keeps a UPC like 001234567890 intact.
  const downloadTemplateXlsx = async () => {
    const { downloadSheets } = await import('@/lib/xlsx');
    const textFields = new Set(['sku', 'upc', 'isbn', 'barcode']);
    downloadSheets(
      [
        {
          name: 'Products',
          columns: IMPORT_FIELDS.map((field) => ({
            label: field.label,
            text: textFields.has(field.key),
            value: (row) => row[field.key],
          })),
          rows: [templateExample],
        },
      ],
      'luminous-import-template.xlsx'
    );
  };

  // A dry run — first or re-run — always re-reads the CURRENT
  // catalog and re-tests every row against it (owner catch,
  // Nov 14, 2026: 'Re-run dry run' was dead because it re-read the
  // verdict computed at file-load and changed nothing on screen).
  const runCheck = async () => {
    if (!businessId || checking) return;
    setChecking(true);
    setError('');
    setResult(null);
    try {
      const productPage = await base44.entities.Product.filter(scoped({}, businessId), { limit: 1000 });
      const fresh = productPage.items ?? [];
      setExistingProducts(fresh);
      const have = countDistinctProducts(fresh);
      const cap = limits?.products ?? null;
      const room = cap == null ? null : Math.max(0, cap - have);
      const verdict = evaluateRows({ table, mapping, existing: existingKeys(fresh), room: null });
      // The verdict speaks for the TICKED rows: the cap is judged
      // on what the owner actually picked, never on file order.
      const ticked = verdict.rows.filter(
        (row) => row.status === 'ready' && !excludedSet.has(row.index)
      );
      setDryRun({
        signature,
        ready: ticked.length,
        skipped: verdict.skipped,
        over: room != null ? Math.max(0, ticked.length - room) : 0,
        units: ticked.reduce((sum, row) => sum + (row.quantity || 0), 0),
        problems: verdict.problems,
        have,
        cap,
        room,
      });
    } catch (err) {
      setError(err?.message || t('import.fileUnreadable'));
    } finally {
      setChecking(false);
    }
  };

  const runImport = async () => {
    if (!businessId || !dryRun || needsCheck || !effectiveReady || overRoom > 0) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const valid = tickedReadyRows;
      for (let index = 0; index < valid.length; index += 100) {
        const chunk = valid
          .slice(index, index + 100)
          .map((row) => ({ ...row.draft, business_id: businessId }));
        await createProducts(businessId, chunk);
      }

      // Opening stock lands in one location: a stock row and a ledger entry per product.
      let stockRows = 0;
      if (withStock) {
        const place = locations.find((location) => location.id === locationId);
        const idsBySku = new Map();
        const skus = valid.map((row) => row.draft.sku);
        for (let index = 0; index < skus.length; index += 100) {
          const page = await base44.entities.Product.filter(
            scoped({ sku: { $in: skus.slice(index, index + 100) } }, businessId),
            { limit: 500 }
          );
          (page.items ?? []).forEach((product) => {
            idsBySku.set(String(product.sku || '').toLowerCase(), product);
          });
        }
        const levels = [];
        const movements = [];
        valid.forEach((row) => {
          if (!(row.quantity > 0)) return;
          const saved = idsBySku.get(row.draft.sku.toLowerCase());
          if (!saved) return;
          levels.push({
            business_id: businessId,
            product_id: saved.id,
            location_id: locationId,
            quantity: row.quantity,
          });
          movements.push({
            business_id: businessId,
            product_id: saved.id,
            product_name: saved.name,
            sku: saved.sku || '',
            location_id: locationId,
            location_name: place?.name || '',
            type: 'receive',
            quantity: row.quantity,
            previous_qty: 0,
            new_qty: row.quantity,
            reference: 'CSV import',
            note: 'Opening stock from import',
            user_name: user?.full_name || user?.email || '',
          });
        });
        if (levels.length) {
          await base44.entities.StockLevel.bulkCreate(levels);
          await base44.entities.StockMovement.bulkCreate(movements);
          stockRows = levels.length;
        }
      }

      // One activity line for the whole import (owner ruling,
      // Nov 15, 2026) — the feed tells the import's story even
      // when every product arrived at zero and no stock moved.
      await recordImportEvent({ businessId, kind: 'create', count: valid.length, fileName });
      setResult({ created: valid.length, skipped: report.skipped, over: 0, stockRows });
      setTable(null);
      setFileName('');
      setMapping([]);
      setDryRun(null);
    } catch (err) {
      setError(err?.message || t('import.importFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!table) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <p className="text-sm font-semibold">{t('import.chooseSpreadsheet')}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t('import.chooseSpreadsheetIntro')}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Upload className="h-4 w-4" /> {t('import.chooseFile')}
            <input
              type="file"
              accept=".csv,.txt,.xlsx,.xlsm,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={onFile}
            />
          </label>
          <Button variant="outline" onClick={downloadTemplate}>
            {t('import.csvTemplate')}
          </Button>
          <Button variant="outline" onClick={downloadTemplateXlsx}>
            {t('import.excelTemplate')}
          </Button>
        </div>

        {error && (
          <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        {result && (
          <div className="mt-3 rounded-lg border border-ok/30 bg-ok/10 p-3 text-sm">
            <p className="font-medium">
              {result.stockRows > 0
                ? t('import.importedResultStock', {
                    created: result.created,
                    s: result.created === 1 ? '' : 's',
                    stockRows: result.stockRows,
                  })
                : t('import.importedResult', {
                    created: result.created,
                    s: result.created === 1 ? '' : 's',
                  })}
            </p>
            {result.skipped > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('import.skippedRowsNote', {
                  skipped: result.skipped,
                  s: result.skipped === 1 ? '' : 's',
                })}
              </p>
            )}
            {result.over > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('import.notImportedPlanFull', { count: result.over })}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="numeric text-xs text-muted-foreground">
            {t('import.fileSummary', {
              file: fileName,
              rows: table.rows.length,
              rs: table.rows.length === 1 ? '' : 's',
              columns: table.headers.length,
              cs: table.headers.length === 1 ? '' : 's',
            })}
          </p>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t('import.startOver')}
          </Button>
        </div>

        {draftTooLarge && (
          <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {t('import.draftTooLarge')}
          </p>
        )}

        <div className="mt-4 space-y-4">
          {sheets.length > 1 && (
            <div className="grid gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('import.worksheet')}
              </p>
              <Select value={sheetName} onValueChange={chooseSheet}>
                <SelectTrigger>
                  <SelectValue placeholder={t('import.chooseWorksheet')} />
                </SelectTrigger>
                <SelectContent>
                  {sheets.map((sheet) => (
                    <SelectItem key={sheet.name} value={sheet.name}>
                      {t('import.sheetRows', { name: sheet.name, rows: sheet.rows.length })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <TriangleAlert className="h-3.5 w-3.5 text-warn" /> {t('import.codesChanged')}
              </p>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <ColumnMapper headers={table.headers} mapping={mapping} onChange={changeMapping} />
          <ImportPreview
            report={report}
            excluded={excludedSet}
            onToggleRow={toggleRow}
            resetKey={signature.split('|').slice(0, 2).join('|')}
          />
          <ProblemReport rows={report.problems} fileName="product-import-problems.csv" />

          {stockMapped && (
            <div className="grid gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('import.openingStockHere')}
              </p>
              <Select
                value={locationId || NO_LOCATION}
                onValueChange={(value) => {
                  setLocationId(value);
                  setDryRun(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('import.noStock')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LOCATION}>{t('import.noStock')}</SelectItem>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DryRunPanel
            dryRun={dryRun}
            report={displayReport}
            needsCheck={needsCheck}
            withStock={withStock}
            capInfo={capInfo}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={runCheck}
              disabled={!hasName || !table.rows.length || busy || checking}
            >
              {checking ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t('import.runDryRun')}
                </>
              ) : needsCheck ? (
                t('import.runDryRun')
              ) : (
                t('import.rerunDryRun')
              )}
            </Button>
            <Button
              onClick={runImport}
              disabled={busy || !hasName || !effectiveReady || needsCheck || !businessId || overRoom > 0}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t('import.importing')}
                </>
              ) : (
                t('import.importProducts', {
                  count: effectiveReady,
                  s: effectiveReady === 1 ? '' : 's',
                })
              )}
            </Button>
            {!businessId && <span className="text-xs text-muted-foreground">{t('import.createBusinessFirstShort')}</span>}
          </div>

          {overRoom > 0 && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{' '}
              {t('import.tickedOverRoom', { count: effectiveReady, room: capInfo.room })}
            </p>
          )}

          {error && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}