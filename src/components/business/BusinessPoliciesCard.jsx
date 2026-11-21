import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Save, Trash2, Upload } from 'lucide-react';
import { apiRequest } from '@/api/client';
import SettingsCard from './SettingsCard';
import PolicyDocumentView from './PolicyDocumentView';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { t } from '@/lib/i18n';

/**
 * The owner's own store policies + terms (Nov 19, 2026) — two
 * per-business documents living in Settings:
 *
 *   - Store Policies: the house rules for how the app and the
 *     store are used in THIS business (an owner may put their
 *     entire store policy in);
 *   - Terms & Conditions: the store's own, in the owner's words.
 *
 * EACH accepts typed text OR an uploaded file — both options
 * offered, either or: saving text replaces a file, uploading a
 * file replaces the text, removing returns the document to
 * empty. Writing is the OWNER's alone (the server refuses every
 * other hand); the whole team READS — the documents show once
 * in the first-start welcome and live here, read-only, in every
 * member's Settings. Per-business: this card only ever reads
 * and writes the ACTIVE business's documents.
 *
 * Luminous StockHaven's own policies and terms are NOT here —
 * they stay with the app (the legal pages; see
 * PlatformPoliciesCard, which sits beside this one).
 */

const DOCS = [
  {
    kind: 'policies',
    headingKey: 'settings.policies.storePolicies',
    hintKey: 'settings.policies.policiesHint',
    placeholderKey: 'settings.policies.policiesPlaceholder',
  },
  {
    kind: 'terms',
    headingKey: 'settings.policies.termsConditions',
    hintKey: 'settings.policies.termsHint',
    placeholderKey: 'settings.policies.termsPlaceholder',
  },
];

/** The file rules, mirroring the server's (businessPolicyRoutes):
 *  document types only, up to 2 MB. */
const FILE_MAX_BYTES = 2 * 1024 * 1024;
const FILE_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
];
const FILE_TYPE_BY_EXTENSION = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
};
const FILE_ACCEPT = [
  '.pdf', '.txt', '.doc', '.docx', '.rtf', '.odt',
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
      // The declared type rules, not the browser's guess: some
      // browsers hand back an empty or generic type for .docx /
      // .rtf files, and the server keeps only the listed types.
      resolve(`data:${mime};base64,${result.slice(comma + 1)}`);
    };
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

export default function BusinessPoliciesCard({ businessId, editable, onVisibilityChange }) {
  const [docs, setDocs] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let mounted = true;
    setDocs(null);
    setLoadError('');
    if (!businessId) return undefined;
    apiRequest(`/api/businesses/${encodeURIComponent(businessId)}/policies`)
      .then((state) => {
        if (mounted) setDocs(state);
      })
      .catch((err) => {
        if (mounted) setLoadError(err?.message || t('settings.save.error'));
      });
    return () => {
      mounted = false;
    };
  }, [businessId]);

  // A member with nothing written for them sees nothing at all:
  // no card, no empty headings (her ruling — if the owner wrote
  // nothing, nothing shows).
  const hidden = Boolean(
    !editable && docs && docs.policies.kind === 'empty' && docs.terms.kind === 'empty',
  );
  // The Settings section ribbon (Nov 20, 2026) lists exactly the
  // sections on the viewer's page, so it follows this card's
  // visibility: while the documents load the card's shell is on
  // the page and so is its chip; if both documents are empty the
  // card leaves and the chip leaves with it.
  useEffect(() => {
    onVisibilityChange?.(!hidden);
  }, [hidden, onVisibilityChange]);
  if (hidden) {
    return null;
  }

  return (
    <SettingsCard
      title={t('settings.policies.title')}
      description={t(editable ? 'settings.policies.ownerDescription' : 'settings.policies.memberDescription')}
    >
      {loadError ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {loadError}
        </p>
      ) : !docs ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('settings.policies.title')}
        </p>
      ) : (
        <div className="space-y-6">
          {DOCS.map((doc) =>
            editable ? (
              <PolicyDocEditor
                key={doc.kind}
                businessId={businessId}
                doc={doc}
                state={docs[doc.kind]}
                onState={setDocs}
              />
            ) : docs[doc.kind].kind !== 'empty' ? (
              <PolicyDocumentView
                key={doc.kind}
                businessId={businessId}
                docKind={doc.kind}
                doc={docs[doc.kind]}
                headingKey={doc.headingKey}
              />
            ) : null,
          )}
        </div>
      )}
    </SettingsCard>
  );
}

function PolicyDocEditor({ businessId, doc, state, onState }) {
  const { toast } = useToast();
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(state?.kind === 'text' ? state.text : '');
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // The draft follows the saved text whenever it changes
  // (another save, a replace, a switch of business).
  const savedText = state?.kind === 'text' ? state.text : '';
  useEffect(() => {
    setDraft(savedText);
  }, [savedText]);

  const base = `/api/businesses/${encodeURIComponent(businessId)}/policies/${doc.kind}`;

  const run = async (action, request, { toastOnSuccess = true } = {}) => {
    setBusy(action);
    setError('');
    try {
      const next = await request();
      onState(next);
      if (toastOnSuccess) {
        setSaved(true);
        toast({ title: t('settings.save.savedToast') });
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      setError(err?.message || t('settings.save.error'));
    } finally {
      setBusy('');
    }
  };

  const saveText = () =>
    run('text', () => apiRequest(`${base}/text`, { method: 'PUT', body: { text: draft } }));

  const removeText = () =>
    run('removeText', () => apiRequest(`${base}/text`, { method: 'DELETE' }));

  const removeFile = () =>
    run('removeFile', () => apiRequest(`${base}/file`, { method: 'DELETE' }));

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const mime = fileTypeOf(file);
    if (!mime) {
      setError(t('settings.policies.badType'));
      return;
    }
    if (file.size > FILE_MAX_BYTES) {
      setError(t('settings.policies.tooLarge'));
      return;
    }
    setBusy('file');
    setError('');
    try {
      const dataUrl = await readAsDataUrl(file, mime);
      const next = await apiRequest(`${base}/file`, {
        method: 'POST',
        body: { dataUrl, filename: file.name || '' },
      });
      onState(next);
      setSaved(true);
      toast({ title: t('settings.save.savedToast') });
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err?.message || t('settings.save.error'));
    } finally {
      setBusy('');
    }
  };

  const isFile = state?.kind === 'file';
  const isText = state?.kind === 'text';
  const anyBusy = Boolean(busy);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t(doc.headingKey)}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{t(doc.hintKey)}</p>
      </div>

      {isFile ? (
        <PolicyDocumentView businessId={businessId} docKind={doc.kind} doc={state} headingKey={null} />
      ) : null}

      <div className="space-y-2">
        <Label htmlFor={`policy-text-${doc.kind}`} className="text-xs text-muted-foreground">
          {isFile ? t('settings.policies.orWrite') : t(doc.headingKey)}
        </Label>
        <Textarea
          id={`policy-text-${doc.kind}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t(doc.placeholderKey)}
          rows={6}
          disabled={anyBusy}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={saveText} disabled={anyBusy}>
            {busy === 'text' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : saved ? (
              <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {busy === 'text'
              ? t('settings.save.saving')
              : saved
                ? t('settings.save.saved')
                : t('settings.save.save')}
          </Button>
          {isText ? (
            <Button type="button" size="sm" variant="ghost" onClick={removeText} disabled={anyBusy}>
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('settings.policies.removeText')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {isFile ? t('settings.policies.fileTypes') : t('settings.policies.orUpload')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={anyBusy}
          >
            {busy === 'file' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {isFile ? t('settings.policies.replaceFile') : t('settings.policies.uploadFile')}
          </Button>
          {isFile ? (
            <Button type="button" size="sm" variant="ghost" onClick={removeFile} disabled={anyBusy}>
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t('settings.policies.removeFile')}
            </Button>
          ) : null}
        </div>
        {!isFile ? (
          <p className="text-xs text-muted-foreground">{t('settings.policies.fileTypes')}</p>
        ) : null}
      </div>

      <input ref={inputRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={onFile} />
      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
