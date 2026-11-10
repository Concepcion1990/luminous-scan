/**
 * SyncIndicator — T6. The visible sync status her hard rule demands:
 * the phone SHOWS "still sending" vs "sent" so nobody is fooled.
 *
 *   - Offline: "Offline — changes are saved on this device"
 *   - Pending: "N changes still sending…"
 *   - Failed: "N changes could not be sent — they are kept on this device"
 *   - Clear: "All changes sent"
 *
 * A failed change can be discarded from here — only after staff have
 * seen it, and only that one change. Nothing is ever dropped silently.
 */
import { CloudOff, Loader2, RefreshCw, Check, TriangleAlert, X } from 'lucide-react';
import { t } from '@/lib/i18n';
import { getOfflineQueue } from '@/lib/offlineQueue';
import { discardQueuedChange } from '@/lib/syncClient';

export default function SyncIndicator({ sync }) {
  if (!sync) return null;
  const { online, pending, failed, flushing, flush } = sync;

  const retry = async () => {
    await flush();
  };

  const discardFailed = async () => {
    const rows = await getOfflineQueue().all();
    for (const row of rows.filter((c) => c.status === 'failed')) {
      await discardQueuedChange(getOfflineQueue(), row.key);
    }
    await sync.refreshQueue();
  };

  if (!online) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
        <CloudOff className="h-4 w-4 shrink-0 text-warn" />
        <span>
          {t('sync.offline')}
          {pending > 0 && ` — ${t('sync.sending', { count: pending, s: pending === 1 ? '' : 's' })}`}
        </span>
      </p>
    );
  }

  if (failed > 0) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm">
        <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
        <span className="flex-1">{t('sync.failed', { count: failed, s: failed === 1 ? '' : 's' })}</span>
        <button type="button" onClick={retry} className="inline-flex items-center gap-1 font-medium underline underline-offset-2">
          <RefreshCw className="h-3.5 w-3.5" /> {t('sync.retrying')}
        </button>
        <button type="button" onClick={discardFailed} className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2">
          <X className="h-3.5 w-3.5" /> Discard
        </button>
      </div>
    );
  }

  if (pending > 0 || flushing) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        {t('sync.sending', { count: pending, s: pending === 1 ? '' : 's' })}
      </p>
    );
  }

  return (
    <p role="status" className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/8 px-3 py-2 text-sm text-muted-foreground">
      <Check className="h-4 w-4 shrink-0 text-ok" />
      {t('sync.sent')}
    </p>
  );
}
