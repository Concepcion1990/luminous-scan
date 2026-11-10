import { useState } from 'react';
import { DatabaseBackup, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { downloadBackup, downloadBackupWorkbook } from '@/lib/exportData';

/** Full snapshot of one business — products, stock, history and purchasing. */
export default function BackupCard({ businessId, businessName, profile }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState(null);

  const run = async (format) => {
    if (!businessId || busy) return;
    setBusy(format);
    try {
      const { counts, filename } =
        format === 'xlsx'
          ? await downloadBackupWorkbook({ businessId, businessName, profile })
          : await downloadBackup({ businessId, businessName, profile });
      setDone({ counts, filename });
      toast({
        title: 'Backup downloaded',
        description: `${filename} · ${Object.entries(counts)
          .map(([key, value]) => `${value} ${key.replace(/_/g, ' ')}`)
          .join(', ')}`,
      });
    } catch {
      toast({
        title: 'Backup failed',
        description: 'The business data could not be read. Try again.',
        variant: 'destructive',
      });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <DatabaseBackup className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Full backup</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            One file with this business's products, locations, stock levels, complete movement ledger,
            suppliers, purchasing, orders, returns, counts and listings — plus its profile settings. Keep
            it somewhere you control.
          </p>

          <ul className="mt-3 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
            <li>Products, codes, costs and notes</li>
            <li>Locations and per-location quantities</li>
            <li>Every movement, with actor and time</li>
            <li>Purchasing, orders, returns and counts</li>
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => run('json')} disabled={!businessId || Boolean(busy)}>
              {busy === 'json' ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <DatabaseBackup className="mr-1.5 h-4 w-4" />
              )}
              {busy === 'json' ? 'Building backup…' : 'Backup (JSON)'}
            </Button>
            <Button variant="outline" onClick={() => run('xlsx')} disabled={!businessId || Boolean(busy)}>
              {busy === 'xlsx' ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              )}
              Excel snapshot
            </Button>
            {done && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {Object.values(done.counts).reduce((sum, value) => sum + value, 0)} records
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}