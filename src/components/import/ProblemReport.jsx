import { Download, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import useEntitlements from '@/hooks/useEntitlements';
import { downloadCsv, toCsv } from '@/lib/csv';

/**
 * The rows that cannot be imported, with the reason.
 *
 * Downloading the problems as a file is an export, so it is Business-only:
 * on Essentials there is no Download button. Essentials instead sees the
 * first 25 problem rows listed inline, with an "and N more" count, so the
 * sheet can still be fixed and tried again — the download on Business only
 * ever capped the on-screen list at five. The download itself is a
 * client-side CSV build; no backend function serves it.
 */
export default function ProblemReport({ rows = [], fileName = 'import-problems.csv' }) {
  const { isEssentials, isLoading: entitlementLoading } = useEntitlements();
  const allowDownload = !isEssentials && !entitlementLoading;
  if (!rows.length) return null;

  const shown = allowDownload ? rows.slice(0, 5) : rows.slice(0, 25);

  const download = () => {
    const columns = [
      { label: 'Spreadsheet row', value: (row) => row.index + 2 },
      { label: 'Product', value: (row) => row.name || row.sku || '' },
      { label: 'Problem', value: (row) => row.problem || '' },
    ];
    downloadCsv(fileName, toCsv(columns, rows));
  };

  return (
    <div className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <TriangleAlert className="h-3.5 w-3.5 text-warn" /> {rows.length} row
        {rows.length === 1 ? '' : 's'} need attention
      </p>
      <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
        {shown.map((row) => (
          <li key={row.index} className="truncate">
            Row {row.index + 2}: {row.problem}
          </li>
        ))}
        {allowDownload && rows.length > 5 && <li>and {rows.length - 5} more</li>}
        {!allowDownload && rows.length > 25 && <li>and {rows.length - 25} more</li>}
      </ul>
      {!allowDownload && (
        <p className="mt-2 text-muted-foreground">
          Business can download this list as a file — see{' '}
          <Link to="/upgrade" className="underline underline-offset-2 hover:text-foreground">
            Plan &amp; limits
          </Link>
          .
        </p>
      )}
      {allowDownload && (
        <Button variant="outline" size="sm" className="mt-2" onClick={download}>
          <Download className="mr-1.5 h-3.5 w-3.5" /> Download these problems
        </Button>
      )}
    </div>
  );
}