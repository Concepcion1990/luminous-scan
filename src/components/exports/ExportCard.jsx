import { useState } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { apiDownload } from '@/api/client';

/**
 * One dataset card: downloads the file the SERVER builds for this
 * business (T5 rewire — the file used to be built in the browser
 * from entity reads, which left the Essentials export ban enforced
 * only by hiding the button). The server enforces Business-only,
 * the 20,000-row cap and the blank-money rule; this card only
 * fetches the finished file and reports what came back.
 */
export default function ExportCard({ dataset, businessId, businessName, profile }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState(null);

  const run = async (format) => {
    if (!businessId || busy) return;
    setBusy(format);
    try {
      const { blob, filename, truncated, rows } = await apiDownload(
        `/api/businesses/${businessId}/export/${dataset.id}?format=${format}`,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setDone({ count: rows, filename });
      toast({
        title: `${dataset.title} exported`,
        description:
          rows != null
            ? `${rows} row${rows === 1 ? '' : 's'} saved as ${filename}${truncated ? ' — stopped at 20,000 rows' : ''}`
            : `Saved as ${filename}${truncated ? ' — stopped at 20,000 rows' : ''}`,
      });
    } catch {
      toast({
        title: 'Export failed',
        description: `Could not build ${dataset.title.toLowerCase()}. Try again.`,
        variant: 'destructive',
      });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex-1">
        <h3 className="text-sm font-semibold">{dataset.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{dataset.description}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => run('xlsx')} disabled={!businessId || Boolean(busy)}>
            {busy === 'xlsx' ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
            )}
            {dataset.buildSheets ? 'Excel workbook' : 'Excel'}
          </Button>
          {!dataset.buildSheets && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run('csv')}
              disabled={!businessId || Boolean(busy)}
            >
              {busy === 'csv' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" />
              )}
              CSV
            </Button>
          )}
        </div>
        {done && done.count != null && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {done.count} rows
          </span>
        )}
      </div>
    </div>
  );
}
