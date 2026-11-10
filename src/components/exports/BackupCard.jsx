import { useState } from 'react';
import { DatabaseBackup, FileSpreadsheet, Loader2 } from 'lucide-react';
import { t } from '@/lib/i18n';
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
        title: t('exports.backupDownloaded'),
        description: `${filename} · ${Object.entries(counts)
          .map(([key, value]) => `${value} ${key.replace(/_/g, ' ')}`)
          .join(', ')}`,
      });
    } catch {
      toast({
        title: t('exports.backupFailed'),
        description: t('exports.backupFailedDesc'),
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
          <h2 className="text-base font-semibold">{t('exports.backupTitle')}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('exports.backupDesc')}
          </p>

          <ul className="mt-3 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
            <li>{t('exports.backupIncludes1')}</li>
            <li>{t('exports.backupIncludes2')}</li>
            <li>{t('exports.backupIncludes3')}</li>
            <li>{t('exports.backupIncludes4')}</li>
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => run('json')} disabled={!businessId || Boolean(busy)}>
              {busy === 'json' ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <DatabaseBackup className="mr-1.5 h-4 w-4" />
              )}
              {busy === 'json' ? t('exports.buildingBackup') : t('exports.backupJson')}
            </Button>
            <Button variant="outline" onClick={() => run('xlsx')} disabled={!businessId || Boolean(busy)}>
              {busy === 'xlsx' ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-1.5 h-4 w-4" />
              )}
              {t('exports.excelSnapshot')}
            </Button>
            {done && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {t('exports.recordsDone', {
                  count: Object.values(done.counts).reduce((sum, value) => sum + value, 0),
                })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}