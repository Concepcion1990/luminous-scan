import { useCallback, useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDateTime } from '@/lib/dates';
import { getLocale, t } from '@/lib/i18n';
import { listMyDocuments, myDocumentFileUrl } from '@/lib/workforce';

/**
 * My documents (the staff-documents self-door, Nov 24, 2026) —
 * the caller's OWN documents file, read-only. The owner keeps
 * this paperwork for the person (W-4s, application, ID copies);
 * the person it belongs to can open it here to look at it,
 * download it and print it — and nothing here can be changed:
 * there is no upload, no remove, no edit door in this dialog
 * at all. The server binds the file to the caller's own staff
 * row (the /mine stem names no member), so this dialog can
 * only ever show the caller's own paperwork.
 */
export default function MyDocumentsDialog({ open, onOpenChange, businessId }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setLoadError('');
    try {
      const data = await listMyDocuments(businessId);
      setDocuments(data?.documents ?? []);
    } catch {
      setLoadError(t('staff.documents.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  const formatWhen = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(getLocale(), {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    } catch {
      return formatDateTime(date);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('staff.documents.mineTitle')}</DialogTitle>
          <DialogDescription>{t('staff.documents.mineDesc')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('staff.loading')}
          </div>
        ) : loadError ? (
          <p className="py-2 text-sm text-destructive">{loadError}</p>
        ) : documents.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('staff.documents.mineEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-start gap-3 px-3 py-2.5">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.title || doc.filename}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {doc.filename}
                    {doc.filename ? ' · ' : ''}
                    {formatWhen(doc.uploaded_at)}
                  </p>
                  {doc.uploaded_by_name && (
                    <p className="text-xs text-muted-foreground">
                      {t('staff.documents.uploadedBy', { name: doc.uploaded_by_name })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={myDocumentFileUrl(businessId, doc.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('staff.documents.openFile')}
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <a href={myDocumentFileUrl(businessId, doc.id)} download={doc.filename || 'document'}>
                      <Download className="mr-1 h-3.5 w-3.5" /> {t('staff.documents.download')}
                    </a>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('staff.memberDialog.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
