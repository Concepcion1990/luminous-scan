import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { CheckCircle2, Loader2, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import { t } from '@/lib/i18n';
import useImportSheet from '@/hooks/useImportSheet';
import { evaluateUpdates, guessUpdateField, UPDATE_FIELDS } from '@/lib/importModes';
import { applyProductUpdates } from '@/lib/importCommit';
import { downloadTemplateCsv, downloadTemplateXlsx } from '@/lib/importTemplates';
import { scoped } from '@/lib/scoped';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ColumnMapper from '@/components/import/ColumnMapper';
import UpdatePreview from '@/components/import/UpdatePreview';
import ProblemReport from '@/components/import/ProblemReport';

const EXAMPLE = {
  sku: 'BOOK-0142',
  name: 'The Lighthouse Keeper',
  description: 'Paperback, 312 pages',
  category: 'Fiction',
  tags: 'signed, first edition',
  condition: 'Very good',
  cost: '6.25',
  price: '14.99',
  supplier_name: 'Harbor Textiles Co.',
  weight: '0.6 kg',
  dimensions: '210 x 140 x 22 mm',
  notes: 'Spine creased at the top',
};

/**
 * Update mode: correct product details from a sheet. Matching is by record ID or
 * SKU, blank cells are left alone unless asked, and quantities never change.
 */
export default function UpdateWorkbench({ businessId }) {
  const sheet = useImportSheet(guessUpdateField);
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [clearBlanks, setClearBlanks] = useState(false);
  const [dryRun, setDryRun] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const loadProducts = async () => {
    if (!businessId) {
      setProducts([]);
      setLoadingProducts(false);
      return;
    }
    setLoadingProducts(true);
    try {
      const page = await base44.entities.Product.filter(scoped({}, businessId), { limit: 1000 });
      setProducts(page.items ?? []);
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => {
    let alive = true;
    if (!businessId) {
      setProducts([]);
      setLoadingProducts(false);
      return () => {
        alive = false;
      };
    }
    setLoadingProducts(true);
    base44.entities.Product.filter(scoped({}, businessId), { limit: 1000 })
      .then((page) => {
        if (alive) setProducts(page.items ?? []);
      })
      .finally(() => {
        if (alive) setLoadingProducts(false);
      });
    return () => {
      alive = false;
    };
  }, [businessId]);

  const report = useMemo(
    () => evaluateUpdates({ table: sheet.table, mapping: sheet.mapping, products, clearBlanks }),
    [sheet.table, sheet.mapping, products, clearBlanks]
  );

  const matchKey = sheet.mapping.includes('id') ? 'id' : sheet.mapping.includes('sku') ? 'sku' : '';
  const signature = `${sheet.fileName}|${sheet.mapping.join(',')}|${clearBlanks}`;
  const needsCheck = !dryRun || dryRun.signature !== signature;

  const dropChecks = () => {
    setDryRun(null);
    setConfirmed(false);
  };

  const startOver = () => {
    sheet.reset();
    setError('');
    dropChecks();
  };

  const runCheck = () => {
    setConfirmed(false);
    setDryRun({
      signature,
      changed: report.changed,
      same: report.same,
      skipped: report.skipped,
      fieldCount: report.fieldCount,
      problems: report.problems,
    });
  };

  const apply = async () => {
    if (!businessId || !confirmed || needsCheck || !report.changed) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const changes = report.rows
        .filter((row) => row.status === 'change')
        .map((row) => ({ id: row.product.id, ...row.values }));
      const updated = await applyProductUpdates({ changes, businessId });
      setResult({ updated, skipped: report.skipped, same: report.same, fields: report.fieldCount });
      await loadProducts();
      sheet.reset();
      dropChecks();
    } catch (err) {
      setError(err?.message || t('import.updateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        <Upload className="h-4 w-4" /> {t('import.chooseFile')}
        <input
          type="file"
          accept=".csv,.txt,.xlsx,.xlsm,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(event) => {
            setError('');
            dropChecks();
            sheet.onFile(event);
          }}
        />
      </label>
      <Button variant="outline" onClick={() => downloadTemplateCsv('product-update-template.csv', UPDATE_FIELDS, EXAMPLE)}>
        {t('import.csvTemplate')}
      </Button>
      <Button
        variant="outline"
        onClick={() => downloadTemplateXlsx('product-update-template.xlsx', UPDATE_FIELDS, EXAMPLE)}
      >
        {t('import.excelTemplate')}
      </Button>
    </div>
  );

  const resultPanel = result && (
    <div className="mt-3 rounded-lg border border-ok/30 bg-ok/10 p-3 text-sm">
      <p className="font-medium">
        {result.fields > 0
          ? t('import.updatedResultFields', {
              updated: result.updated,
              s: result.updated === 1 ? '' : 's',
              fields: result.fields,
              fs: result.fields === 1 ? '' : 's',
            })
          : t('import.updatedResult', {
              updated: result.updated,
              s: result.updated === 1 ? '' : 's',
            })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {result.same > 0
          ? `${t('import.updateSameRows', {
              same: result.same,
              s: result.same === 1 ? '' : 's',
            })} `
          : ''}
        {t('import.quantitiesUntouched')}
      </p>
    </div>
  );

  if (!sheet.table) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <p className="text-sm font-semibold">{t('import.updateWorkbenchTitle')}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t('import.updateIntro')}
        </p>
        {pickFile}
        {sheet.error && (
          <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {sheet.error}
          </p>
        )}
        {sheet.reading && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('import.readingFile')}
          </p>
        )}
        {resultPanel}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="numeric text-xs text-muted-foreground">
            {t('import.fileSummary', {
              file: sheet.fileName,
              rows: sheet.table.rows.length,
              rs: sheet.table.rows.length === 1 ? '' : 's',
              columns: sheet.table.headers.length,
              cs: sheet.table.headers.length === 1 ? '' : 's',
            })}
          </p>
          <Button variant="ghost" size="sm" onClick={startOver}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t('import.startOver')}
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          {sheet.sheets.length > 1 && (
            <div className="grid gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('import.worksheet')}
              </p>
              <Select
                value={sheet.sheetName}
                onValueChange={(name) => {
                  sheet.chooseSheet(name);
                  dropChecks();
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('import.chooseWorksheet')} />
                </SelectTrigger>
                <SelectContent>
                  {sheet.sheets.map((entry) => (
                    <SelectItem key={entry.name} value={entry.name}>
                      {t('import.sheetRows', { name: entry.name, rows: entry.rows.length })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {sheet.warnings.length > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <TriangleAlert className="h-3.5 w-3.5 text-warn" /> {t('import.codesChanged')}
              </p>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                {sheet.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <ColumnMapper
            headers={sheet.table.headers}
            mapping={sheet.mapping}
            onChange={(column, field) => {
              sheet.changeMapping(column, field);
              dropChecks();
            }}
            fields={UPDATE_FIELDS}
            requiredKeys={['sku', 'id']}
            missingMessage={t('import.updateMissingMessage')}
          />

          <p className="text-[11px] text-muted-foreground">
            {matchKey === 'id'
              ? t('import.matchById')
              : matchKey === 'sku'
                ? t('import.matchBySku')
                : t('import.noMatchColumn')}
            {' '}
            {loadingProducts
              ? t('import.readingCatalog')
              : t('import.productsInBusiness', { count: products.length })}
          </p>

          <label className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-xs">
            <input
              type="checkbox"
              checked={clearBlanks}
              onChange={(event) => {
                setClearBlanks(event.target.checked);
                dropChecks();
              }}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span>
              {t('import.clearBlanks')}
              <span className="mt-0.5 block text-muted-foreground">
                {t('import.clearBlanksHint')}
              </span>
            </span>
          </label>

          <UpdatePreview report={report} />
          <ProblemReport rows={report.problems} fileName="product-update-problems.csv" />

          <div
            className={`rounded-lg border p-3 text-xs ${
              !dryRun ? 'border-dashed border-border' : needsCheck ? 'border-warn/40 bg-warn/10' : 'border-ok/40 bg-ok/10'
            }`}
          >
            <p className="flex items-center gap-1.5 font-semibold text-foreground">
              {!dryRun ? (
                <>{t('import.dryRunTitle')}</>
              ) : needsCheck ? (
                <>
                  <TriangleAlert className="h-3.5 w-3.5 text-warn" /> {t('import.dryRunStale')}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-ok" /> {t('import.dryRunPassed')}
                </>
              )}
            </p>
            <p className="mt-1 text-foreground">
              <span className="numeric font-semibold">{report.changed}</span>{' '}
              {t('import.updateDryRunProducts', { s: report.changed === 1 ? '' : 's' })} ·{' '}
              <span className="numeric font-semibold">{report.fieldCount}</span>{' '}
              {t('import.updateDryRunFields')} ·{' '}
              <span className="numeric font-semibold">{report.same}</span>{' '}
              {t('import.updateDryRunUnchanged')} ·{' '}
              <span className="numeric font-semibold">{report.skipped}</span>{' '}
              {t('import.updateDryRunSkipped')}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {!dryRun
                ? t('import.updateDryRunIntro')
                : needsCheck
                  ? t('import.updateDryRunAgain')
                  : t('import.dryRunNothingSaved')}
            </p>
          </div>

          {dryRun && !needsCheck && report.changed > 0 && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span>
                {t('import.confirmUpdateStart')}{' '}
                <span className="font-medium text-foreground">{report.changed}</span>{' '}
                {t('import.confirmUpdateEnd', { s: report.changed === 1 ? '' : 's' })}
              </span>
            </label>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={runCheck} disabled={!matchKey || !sheet.table.rows.length || busy}>
              {needsCheck ? t('import.runDryRun') : t('import.rerunDryRun')}
            </Button>
            <Button
              onClick={apply}
              disabled={busy || !businessId || needsCheck || !confirmed || !report.changed}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t('import.updating')}
                </>
              ) : (
                t('import.updateProducts', {
                  count: report.changed,
                  s: report.changed === 1 ? '' : 's',
                })
              )}
            </Button>
            {!businessId && <span className="text-xs text-muted-foreground">{t('import.createBusinessFirstShort')}</span>}
          </div>

          {(error || sheet.error) && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error || sheet.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}