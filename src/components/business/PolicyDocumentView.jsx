import { useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { apiDownload } from '@/api/client';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/**
 * One of the owner's two store documents, read-only (Nov 19,
 * 2026): Store Policies or Terms & Conditions, exactly as the
 * owner left it — typed text renders as written (owner-written
 * words are never translated or reformatted), and an uploaded
 * file is a door: its filename, and an Open that fetches the
 * bytes through the authenticated, business-scoped route (the
 * file itself never rides a public link). Shared by the
 * Settings card (every role) and the first-start welcome.
 */
export default function PolicyDocumentView({ businessId, docKind, doc, headingKey }) {
  const [opening, setOpening] = useState(false);
  if (!doc || doc.kind === 'empty') return null;

  const openFile = async () => {
    setOpening(true);
    try {
      const { blob } = await apiDownload(
        `/api/businesses/${encodeURIComponent(businessId)}/policies/${docKind}/file`,
      );
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      // The door stays quiet on failure — the filename still
      // names what the owner saved, and Settings offers it too.
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="space-y-2">
      {headingKey ? <h3 className="text-sm font-semibold">{t(headingKey)}</h3> : null}
      {doc.kind === 'text' ? (
        <p className="whitespace-pre-line text-sm leading-relaxed">{doc.text}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{doc.filename || t('settings.policies.openFile')}</span>
          </p>
          <Button type="button" size="sm" variant="outline" onClick={openFile} disabled={opening}>
            {opening ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {t('settings.policies.openFile')}
          </Button>
        </div>
      )}
    </div>
  );
}
