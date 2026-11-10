import { useState } from 'react';
import { FileUp, ShieldAlert } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import ImportModePicker from '@/components/import/ImportModePicker';
import ImportWorkbench from '@/components/import/ImportWorkbench';
import UpdateWorkbench from '@/components/import/UpdateWorkbench';
import ReceiveWorkbench from '@/components/import/ReceiveWorkbench';

const MODES = {
  create: ImportWorkbench,
  update: UpdateWorkbench,
  receive: ReceiveWorkbench,
};

export default function ImportCenter() {
  const { profile, activeId } = useBusiness();
  // The failed-rows download is an export, so it is Business-only — and the
  // copy must not promise it on Essentials. While the plan is still loading
  // the Essentials wording shows (fail closed on the promise).
  const { isEssentials, isLoading: entitlementLoading } = useEntitlements();
  const allowDownload = !isEssentials && !entitlementLoading;
  const [mode, setMode] = useState('create');
  const Workbench = MODES[mode];

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Data</p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Import center</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Three separate spreadsheet operations, so a price correction can never arrive as a stock receipt.
          Everything lands in <span className="font-medium text-foreground">{profile.name}</span> only, and
          nothing is written until a dry run has passed.
        </p>
      </div>

      {!activeId && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          Create a business first — imported products belong to a business.
        </p>
      )}

      <ImportModePicker mode={mode} onChange={setMode} />

      <Workbench businessId={activeId} />

      <div className="rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground sm:p-5">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <FileUp className="h-3.5 w-3.5" /> What each operation does
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">Create new products</span> adds rows that are not in
          the catalog yet. Duplicate SKUs and barcodes already in use are skipped, and opening stock can land
          in a location you choose as a receipt.
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">Update existing products</span> matches each row by
          SKU or record ID and shows the old value beside the proposed new one. Blank cells leave the saved
          value alone unless you ask for blanks to be cleared, and quantities are never touched.
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">Receive stock</span> adds arriving quantities to one
          location and writes a receipt to the movement ledger for every line. Each batch is marked, so the
          same sheet cannot be received twice.
        </p>
        <p className="mt-2">
          Excel workbooks (.xlsx) are read directly — pick the worksheet and the columns are matched for you.
          Codes stay whole: a UPC saved as text keeps its digits and leading zeroes. Rows that cannot be
          imported are listed with a reason
          {allowDownload
            ? ' and can be downloaded as a file.'
            : ', so you can fix them and try again.'}
        </p>
      </div>
    </div>
  );
}