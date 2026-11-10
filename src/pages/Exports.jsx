import { Link } from 'react-router-dom';
import { FileDown, Lock, ShieldAlert } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { EXPORTS } from '@/lib/exportData';
import ExportCard from '@/components/exports/ExportCard';
import BackupCard from '@/components/exports/BackupCard';
import { Button } from '@/components/ui/button';
import useEntitlements from '@/hooks/useEntitlements';

export default function Exports() {
  const { profile, activeId } = useBusiness();
  // In-page entitlement guard: the route is PlanGate-locked too, but this
  // page must be safe on its own if it is ever rendered without the gate.
  const { can, isLoading: entitlementLoading } = useEntitlements();
  const locked = !entitlementLoading && !can('exports');

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Data
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Exports &amp; backups</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Downloads are always limited to{' '}
          <span className="font-medium text-foreground">{profile.name}</span>. Every file is labelled
          with the business name and the date it was made.
        </p>
      </div>

      {!activeId && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          Create a business first — exports belong to a business, not to the app.
        </p>
      )}

      {locked && (
        <div className="mx-auto max-w-xl py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">CSV and Excel exports is a Business feature</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Your workspace is on the Essentials plan. Business adds CSV and Excel exports, stock
            valuation, unlimited products and staff, suppliers, purchasing and bundles.
          </p>
          <Button asChild className="mt-5">
            <Link to="/upgrade">See what Business includes</Link>
          </Button>
        </div>
      )}

      {!locked && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {EXPORTS.map((dataset) => (
              <ExportCard
                key={dataset.id}
                dataset={dataset}
                businessId={activeId}
                businessName={profile.name}
                profile={profile}
              />
            ))}
          </div>

          <BackupCard businessId={activeId} businessName={profile.name} profile={profile} />
        </>
      )}

      <div className="rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground sm:p-5">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <FileDown className="h-3.5 w-3.5" /> What these files are
        </p>
        <p className="mt-2">
          Every dataset comes as CSV or a real Excel workbook (.xlsx) — the full inventory workbook
          is Excel-only, with one sheet per dataset. CSV files open in Excel, Numbers, Google Sheets
          and most stock apps. UTF-8 text, quoted commas, line breaks in notes and leading zeroes in
          codes are all preserved, and cells that start like a formula are neutralised so a
          spreadsheet opens them as text.
        </p>
        <p className="mt-2">
          In the Excel files, SKUs, UPCs, ISBNs and barcodes are text cells — never scientific notation and
          never trimmed zeroes — with column widths, header filters and currency or quantity formats applied.
          The full inventory workbook keeps products, stock levels, locations and movements on separate
          sheets.
        </p>
        <p className="mt-2">
          Very large exports stop at 20,000 rows per dataset — when that happens the file name says
          so (truncated-20000), so a partial file never passes as complete.
        </p>
        <p className="mt-2">
          A backup is a snapshot of your data, not a one-click restore. Restoring it is a manual,
          review-first job, so keep the file safe — nothing in the app can recreate a deleted business
          from it yet. App code and Base44 platform backups are handled separately from these files.
        </p>
        <p className="mt-2">
          Photos and attachments are listed as their stored links — the image files themselves are not
          packed into the download.
        </p>
      </div>
    </div>
  );
}