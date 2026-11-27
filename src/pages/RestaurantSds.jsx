import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, FlaskConical, Loader2, Trash2, Upload } from 'lucide-react';
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
import { useBusiness } from '@/hooks/useBusiness';
import { formatDateTime } from '@/lib/dates';
import { addSdsSheet, listSdsSheets, removeSdsSheet, sdsSheetFileUrl } from '@/lib/foodSafety';
import { getWorkforceContext } from '@/lib/workforce';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * The SDS shelf (plan release 370's round-2 rider, Nov 26,
 * 2026): safety data sheets for the chemicals the kitchen
 * uses — degreasers, sanitizers, oven cleaner — stored via
 * the documents machinery and READABLE BY ANYONE ON THE
 * TEAM with no tick (the sheets must be accessible to the
 * staff who use them). Adding a sheet rides the
 * staff.documents tick pattern; removing one is the owner's
 * alone. The server enforces all of it; this page only
 * carries the doors.
 */
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
const FILE_ACCEPT = ['.pdf', '.txt', '.doc', '.docx', '.rtf', '.odt', '.png', '.jpg', '.jpeg', '.webp', ...FILE_TYPES].join(',');

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
      resolve(`data:${mime};base64,${result.slice(comma + 1)}`);
    };
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

export default function RestaurantSds() {
  const { activeId } = useBusiness();
  const [ctx, setCtx] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    try {
      const [context, data] = await Promise.all([
        getWorkforceContext(activeId).catch(() => null),
        listSdsSheets(activeId),
      ]);
      setCtx(context);
      setSheets(data?.sheets ?? []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => { load(); }, [load]);

  const canAdd = Boolean(ctx?.documents_admin);
  const isOwner = Boolean(ctx?.is_owner);

  const upload = async () => {
    if (!file) return;
    const mime = fileTypeOf(file);
    if (!mime || file.size > 25 * 1024 * 1024) {
      setError(t('staff.documents.fileInvalid'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const dataUrl = await readAsDataUrl(file, mime);
      const data = await addSdsSheet(activeId, { title: title.trim(), filename: file.name, dataUrl });
      setSheets(data?.sheets ?? []);
      setFile(null);
      setTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e) {
      setError(e.message || t('foodSafety.sds.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      const data = await removeSdsSheet(activeId, removing.id);
      setSheets(data?.sheets ?? []);
    } catch {
      // The list simply stays as it was.
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/sds" />
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('restaurant.eyebrow')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('foodSafety.sds.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('foodSafety.sds.subtitle')}</p>
      </div>

      {canAdd && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="grid gap-1.5">
            <Label htmlFor="sds-title">{t('staff.documents.titleLabel')}</Label>
            <Input
              id="sds-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('foodSafety.sds.titlePlaceholder')}
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
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              {t('staff.documents.chooseFile')}
            </Button>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {file ? file.name : t('staff.documents.noFileChosen')}
            </span>
            <Button type="button" size="sm" onClick={upload} disabled={!file || busy}>
              {busy ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t('staff.documents.uploading')}</>
              ) : (
                <><Upload className="mr-1.5 h-4 w-4" /> {t('foodSafety.sds.uploadButton')}</>
              )}
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      )}
      {!canAdd && !loading && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('foodSafety.sds.gatedNote')}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : loadFailed ? (
        <p className="text-sm text-destructive">{t('foodSafety.sds.loadFailed')}</p>
      ) : sheets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <FlaskConical className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('foodSafety.sds.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('foodSafety.sds.emptyBody')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {sheets.map((sheet) => (
            <li key={sheet.id} className="flex items-start gap-3 px-3 py-2.5">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{sheet.title || sheet.filename}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {sheet.filename}
                  {sheet.filename ? ' · ' : ''}
                  {sheet.uploaded_at ? formatDateTime(sheet.uploaded_at) : ''}
                </p>
                {sheet.uploaded_by_name && (
                  <p className="text-xs text-muted-foreground">
                    {t('staff.documents.uploadedBy', { name: sheet.uploaded_by_name })}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button asChild variant="outline" size="sm">
                  <a href={sdsSheetFileUrl(activeId, sheet.id)} target="_blank" rel="noreferrer">
                    {t('staff.documents.openFile')}
                  </a>
                </Button>
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRemoving(sheet)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> {t('staff.documents.remove')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={Boolean(removing)} onOpenChange={(next) => { if (!next) setRemoving(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('foodSafety.sds.removeTitle')}</DialogTitle>
            <DialogDescription>{t('foodSafety.sds.removeBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>{t('recipes.cancel')}</Button>
            <Button variant="destructive" onClick={confirmRemove}>{t('staff.documents.remove')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
