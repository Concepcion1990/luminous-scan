import { useState } from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { exportDataset } from '@/lib/exportData';

/** One dataset card: builds the file on demand in CSV or Excel, then reports what went into it. */
export default function ExportCard({ dataset, businessId, businessName, profile }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState(null);

  const run = async (format) => {
    if (!businessId || busy) return;
    setBusy(format);
    try {
      const { count, filename } = await exportDataset(
        dataset,
        { businessId, businessName, profile },
        format
      );
      setDone({ count, filename });
      toast({
        title: `${dataset.title} exported`,
        description: `${count} row${count === 1 ? '' : 's'} saved as ${filename}`,
      });
    } catch {
      toast({
        title: 'Export failed',
        description: `Could not read ${dataset.title.toLowerCase()}. Try again.`,
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
        {done && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {done.count} rows
          </span>
        )}
      </div>
    </div>
  );
}