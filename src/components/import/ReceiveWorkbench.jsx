import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { CheckCircle2, Loader2, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import useImportSheet from '@/hooks/useImportSheet';
import { evaluateReceipts, guessReceiveField, RECEIVE_FIELDS } from '@/lib/importModes';
import { applyReceipts } from '@/lib/importCommit';
import { downloadTemplateCsv, downloadTemplateXlsx } from '@/lib/importTemplates';
import { scoped } from '@/lib/scoped';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ColumnMapper from '@/components/import/ColumnMapper';
import ReceivePreview from '@/components/import/ReceivePreview';
import ProblemReport from '@/components/import/ProblemReport';

const EXAMPLE = {
  sku: 'BOOK-0142',
  quantity: '12',
  unit_cost: '6.25',
  reference: 'PO-1043',
  supplier_name: 'Harbor Textiles Co.',
  note: 'Carton 2 of 3',
};

function newBatchRef() {
  return `${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Receive mode: add arriving quantities to one location and record each line in
 * the movement ledger. This never sets an exact count and never edits a product.
 */
export default function ReceiveWorkbench({ businessId }) {
  const { user } = useAuth();
  const sheet = useImportSheet(guessReceiveField);
  const [products, setProducts] = useState([]);
  const [levels, setLevels] = useState([]);
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [batchRef, setBatchRef] = useState('');
  const [dryRun, setDryRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!businessId) {
      setProducts([]);
      setLocations([]);
      setLevels([]);
      return () => {
        alive = false;
      };
    }
    Promise.all([
      base44.entities.Product.filter(scoped({}, businessId), { limit: 1000 }),
      base44.entities.Location.filter(scoped({}, businessId), { sort: 'name', limit: 100 }),
    ]).then(([productPage, locationPage]) => {
      if (!alive) return;
      setProducts(productPage.items ?? []);
      const places = locationPage.items ?? [];
      setLocations(places);
      if (!locationId && places.length === 1) setLocationId(places[0].id);
    });
    return () => {
      alive = false;
    };
  }, [businessId]);

  useEffect(() => {
    let alive = true;
    if (!businessId || !locationId) {
      setLevels([]);
      return () => {
        alive = false;
      };
    }
    base44.entities.StockLevel.filter(scoped({ location_id: locationId }, businessId), { limit: 2000 }).then(
      (page) => {
        if (alive) setLevels(page.items ?? []);
      }
    );
    return () => {
      alive = false;
    };
  }, [businessId, locationId]);

  const report = useMemo(
    () => evaluateReceipts({ table: sheet.table, mapping: sheet.mapping, products, levels, locationId }),
    [sheet.table, sheet.mapping, products, levels, locationId]
  );

  const matchKey = sheet.mapping.includes('id') ? 'id' : sheet.mapping.includes('sku') ? 'sku' : '';
  const signature = `${sheet.fileName}|${sheet.mapping.join(',')}|${locationId}|${batchRef}`;
  const needsCheck = !dryRun || dryRun.signature !== signature;
  const place = locations.find((location) => location.id === locationId);

  const startOver = () => {
    sheet.reset();
    setError('');
    setDryRun(null);
    setBatchRef('');
    setReference('');
    setNote('');
  };

  const runCheck = () => {
    setDryRun({
      signature,
      ready: report.ready,
      skipped: report.skipped,
      units: report.units,
      problems: report.problems,
    });
  };

  const receive = async () => {
    if (!businessId || !dryRun || needsCheck || !report.ready) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const rows = report.rows.filter((row) => row.status === 'ready');
      const outcome = await applyReceipts({
        rows,
        levels,
        locationId,
        locationName: place?.name || '',
        businessId,
        user,
        batchRef,
        reference,
        note,
      });
      setResult({ ...outcome, skipped: report.skipped, reference, batchRef });
      const levelPage = await base44.entities.StockLevel.filter(
        scoped({ location_id: locationId }, businessId),
        { limit: 2000 }
      );
      setLevels(levelPage.items ?? []);
      sheet.reset();
      setDryRun(null);
    } catch (err) {
      setError(err?.message || 'The receipt could not be finished.');
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        <Upload className="h-4 w-4" /> Choose CSV or Excel file
        <input
          type="file"
          accept=".csv,.txt,.xlsx,.xlsm,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={async (event) => {
            setBatchRef(newBatchRef());
            setDryRun(null);
            await sheet.onFile(event);
          }}
        />
      </label>
      <Button variant="outline" onClick={() => downloadTemplateCsv('stock-receipt-template.csv', RECEIVE_FIELDS, EXAMPLE)}>
        CSV template
      </Button>
      <Button
        variant="outline"
        onClick={() => downloadTemplateXlsx('stock-receipt-template.xlsx', RECEIVE_FIELDS, EXAMPLE)}
      >
        Excel template
      </Button>
    </div>
  );

  const locationPicker = (
    <div className="grid gap-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Stock arrives at
      </p>
      <Select
        value={locationId}
        onValueChange={(value) => {
          setLocationId(value);
          setDryRun(null);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Choose a location" />
        </SelectTrigger>
        <SelectContent>
          {locations.map((location) => (
            <SelectItem key={location.id} value={location.id}>
              {location.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const resultPanel = result && (
    <div className="mt-3 rounded-lg border border-ok/30 bg-ok/10 p-3 text-sm">
      <p className="font-medium">
        Received {result.units} unit{result.units === 1 ? '' : 's'} across {result.received} product
        {result.received === 1 ? '' : 's'} at {place?.name || 'the chosen location'}.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Import {result.batchRef} is in the movement ledger
        {result.reference ? ` under reference ${result.reference}` : ''}. Uploading the same sheet again will
        be refused so nothing is received twice.
      </p>
    </div>
  );

  if (!sheet.table) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <p className="text-sm font-semibold">Receive stock from a spreadsheet</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Each row adds a quantity to what is already on hand at the location you pick — it never sets an
          exact count and never edits a product. Every line is written to the movement ledger as a receipt.
        </p>
        {pickFile}
        {sheet.error && (
          <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {sheet.error}
          </p>
        )}
        {sheet.reading && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the file…
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
            {sheet.fileName} · {sheet.table.rows.length} row{sheet.table.rows.length === 1 ? '' : 's'} ·{' '}
            {sheet.table.headers.length} column{sheet.table.headers.length === 1 ? '' : 's'}
          </p>
          <Button variant="ghost" size="sm" onClick={startOver}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Start over
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          {sheet.sheets.length > 1 && (
            <div className="grid gap-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Worksheet
              </p>
              <Select
                value={sheet.sheetName}
                onValueChange={(name) => {
                  sheet.chooseSheet(name);
                  setDryRun(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a worksheet" />
                </SelectTrigger>
                <SelectContent>
                  {sheet.sheets.map((entry) => (
                    <SelectItem key={entry.name} value={entry.name}>
                      {entry.name} · {entry.rows.length} rows
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {sheet.warnings.length > 0 && (
            <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <TriangleAlert className="h-3.5 w-3.5 text-warn" /> Codes this workbook has already changed
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
              setDryRun(null);
            }}
            fields={RECEIVE_FIELDS}
            requiredKeys={['sku', 'id']}
            missingMessage="Match a column to SKU or Record ID, and one to Quantity received."
          />

          {locationPicker}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Reference for these receipts (optional)
              </p>
              <Input
                value={reference}
                onChange={(event) => {
                  setReference(event.target.value);
                  setDryRun(null);
                }}
                placeholder="PO-1043"
              />
            </div>
            <div className="grid gap-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Note (optional)
              </p>
              <Input
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setDryRun(null);
                }}
                placeholder="Delivered in three cartons"
              />
            </div>
          </div>

          <ReceivePreview report={report} />
          <ProblemReport rows={report.problems} fileName="stock-receipt-problems.csv" />

          <div
            className={`rounded-lg border p-3 text-xs ${
              !dryRun ? 'border-dashed border-border' : needsCheck ? 'border-warn/40 bg-warn/10' : 'border-ok/40 bg-ok/10'
            }`}
          >
            <p className="flex items-center gap-1.5 font-semibold text-foreground">
              {!dryRun ? (
                <>Dry run</>
              ) : needsCheck ? (
                <>
                  <TriangleAlert className="h-3.5 w-3.5 text-warn" /> The setup changed since the dry run
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-ok" /> Dry run passed
                </>
              )}
            </p>
            <p className="mt-1 text-foreground">
              <span className="numeric font-semibold">{report.ready}</span> product
              {report.ready === 1 ? '' : 's'} would be received ·{' '}
              <span className="numeric font-semibold">{report.units}</span> units ·{' '}
              <span className="numeric font-semibold">{report.skipped}</span> skipped
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {!dryRun
                ? 'Run a dry run to check every row. It saves nothing.'
                : needsCheck
                  ? 'Run the dry run again before receiving.'
                  : 'Nothing has been saved — this was only a check.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={runCheck}
              disabled={!matchKey || !locationId || !sheet.table.rows.length || busy}
            >
              {needsCheck ? 'Run dry run' : 'Re-run dry run'}
            </Button>
            <Button onClick={receive} disabled={busy || !businessId || !locationId || needsCheck || !report.ready}>
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Receiving…
                </>
              ) : (
                `Receive ${report.units} unit${report.units === 1 ? '' : 's'}`
              )}
            </Button>
            {!locationId && (
              <span className="text-xs text-muted-foreground">Choose the location the stock arrived at.</span>
            )}
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