import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/dates';
import { t } from '@/lib/i18n';
import {
  listStaffDocuments,
  removeStaffDocument,
  staffDocumentFileUrl,
  uploadStaffDocument,
} from '@/lib/workforce';

/**
 * One person's documents file (the staff documents build,
 * Nov 21, 2026) — opened from the Staff page's documents card.
 * The owner, or a manager holding the staff.documents tick,
 * adds paperwork here: every upload is its own kept version,
 * listed newest-first with its title, its date, and who
 * uploaded it — a newer version NEVER replaces the older ones.
 * Removing one version is the owner's deliberate act alone,
 * behind the confirm below; a ticked manager can open and add,
 * never remove. The server enforces all of it on every call;
 * this dialog only carries the doors.
 */

// The file rules mirror the server's (and the business-policy
// files'): document types plus images — an ID copy arrives as
// a photo. The 25 MB cap is the server's; the client names it
// before sending so the refusal is never a dead end.
const FILE_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
  'image/png',
  'image/jpeg',
  'image/webp',
];
const FILE_TYPE_BY_EXTENSION = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const FILE_ACCEPT = [
  '.pdf', '.txt', '.doc', '.docx', '.rtf', '.odt', '.png', '.jpg', '.jpeg', '.webp',
  ...FILE_TYPES,
].join(',');

function fileTypeOf(file) {
  if (file.type && FILE_TYPES.includes(file.type)) return file.type;
  const extension = String(file.name || '').split('.').pop()?.toLowerCase();
  return FILE_TYPE_BY_EXTENSION[extension] || null;
}

function readAsDataUrl(file, mime) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) return reject(new Error('read_failed'));
      // The declared type rules, not the browser's guess (the
      // business-policy files' lesson).
      resolve(`data:${mime};base64,${result.slice(comma + 1)}`);
    };
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

// Stored timestamps read through the house machinery
// (lib/dates formatDateTime — toLocalDate underneath), never
// a raw `new Date(...)` parse (the smalls bundle sweep,
// Nov 25, 2026 — the ClockAttentionCard lesson).
function formatWhen(iso) {
  return formatDateTime(iso);
}

export default function StaffDocumentsDialog({ open, onOpenChange, businessId, member, isOwner, onChanged }) {
  const { toast } = useToast();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    if (!businessId || !member?.id) return;
    setLoading(true);
    setLoadError('');
    try {
      const data = await listStaffDocuments(businessId, member.id);
      setDocuments(data?.documents ?? []);
    } catch {
      setLoadError(t('staff.documents.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [businessId, member?.id]);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTitle('');
    setRemoving(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    load();
  }, [open, load]);

  const upload = async () => {
    if (!file) return;
    const mime = fileTypeOf(file);
    if (!mime || file.size > 25 * 1024 * 1024) {
      toast({ title: t('staff.documents.fileInvalid'), variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file, mime);
      const data = await uploadStaffDocument(businessId, member.id, {
        title: title.trim(),
        filename: file.name,
        dataUrl,
      });
      setDocuments(data?.documents ?? []);
      setFile(null);
      setTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast({ title: t('staff.documents.uploadedToast') });
      onChanged?.();
    } catch (error) {
      toast({
        title: t('staff.documents.uploadFailed'),
        // The API client already renders the server's refusal
        // in the reader's language as the error message.
        description: error?.message || undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      const data = await removeStaffDocument(businessId, member.id, removing.id);
      setDocuments(data?.documents ?? []);
      setRemoving(null);
      toast({ title: t('staff.documents.removedToast') });
      onChanged?.();
    } catch (error) {
      toast({
        title: error?.message || t('staff.documents.loadFailed'),
        variant: 'destructive',
      });
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('staff.documents.title')} — {member?.full_name || ''}
            </DialogTitle>
            <DialogDescription>{t('staff.documents.dialogDesc')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="grid gap-1.5">
                <Label htmlFor="staff-doc-title">{t('staff.documents.titleLabel')}</Label>
                <Input
                  id="staff-doc-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t('staff.documents.titlePlaceholder')}
                  maxLength={120}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={FILE_ACCEPT}
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('staff.documents.chooseFile')}
                </Button>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {file ? file.name : t('staff.documents.noFileChosen')}
                </span>
                <Button type="button" size="sm" onClick={upload} disabled={!file || busy}>
                  {busy ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t('staff.documents.uploading')}
                    </>
                  ) : (
                    <>
                      <Upload className="mr-1.5 h-4 w-4" /> {t('staff.documents.upload')}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('staff.loading')}
              </div>
            ) : loadError ? (
              <p className="py-2 text-sm text-destructive">{loadError}</p>
            ) : documents.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{t('staff.documents.empty')}</p>
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
                          href={staffDocumentFileUrl(businessId, member.id, doc.id)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('staff.documents.openFile')}
                        </a>
                      </Button>
                      {isOwner && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRemoving(doc)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> {t('staff.documents.remove')}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('staff.memberDialog.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Removing one version is the owner's deliberate act —
          a real nested Dialog (the 326/328 lesson: never a
          window.confirm inside another dialog). */}
      <Dialog open={Boolean(removing)} onOpenChange={(next) => { if (!next) setRemoving(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('staff.documents.removeTitle')}</DialogTitle>
            <DialogDescription>
              {removing
                ? t('staff.documents.removeBody', { title: removing.title || removing.filename, name: member?.full_name || '' })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={removeBusy}>
              {t('staff.memberDialog.cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmRemove} disabled={removeBusy}>
              {removeBusy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t('staff.documents.remove')}
                </>
              ) : (
                t('staff.documents.remove')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
