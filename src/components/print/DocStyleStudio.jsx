import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Upload, X } from 'lucide-react';
import { base44 } from '@/api/client';
import { t } from '@/lib/i18n';
import { DOC_BORDERS, docFontFamily, resolveDocStyle } from '@/lib/docStyle';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const FONT_OPTIONS = [
  { key: 'default', labelKey: 'print.style.fontDefault' },
  { key: 'serif', label: 'Georgia' },
  { key: 'sans', label: 'Arial' },
  { key: 'typewriter', label: 'Courier New' },
];

const BORDER_LABEL_KEYS = {
  none: 'print.style.borderNone',
  single: 'print.style.borderSingle',
  double: 'print.style.borderDouble',
  dashed: 'print.style.borderDashed',
  dotted: 'print.style.borderDotted',
};

const BORDER_SWATCH = {
  none: 'border border-transparent',
  single: 'border border-foreground/70',
  double: 'border-[3px] border-double border-foreground/70',
  dashed: 'border border-dashed border-foreground/70',
  dotted: 'border-2 border-dotted border-foreground/70',
};

/**
 * The Document Style Studio (Nov 14, 2026) — a small corner of
 * the Print page where a business dresses its own documents:
 * its logo at the top, color or black-and-white, a font, a page
 * frame, and its own pictures at the top and bottom. The choices
 * are the business's, remembered on its record, and they dress
 * the FRAME only — prices, totals, addresses and the honest
 * footers always print exactly as they are.
 *
 * Editing is a boss door (owner / legacy admin — the one shared
 * definition); the Print Center only renders this card for a
 * boss. The logo itself is managed in Settings; here it is only
 * ever shown, never re-uploaded.
 */
export default function DocStyleStudio({ business, style, onChange, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [error, setError] = useState('');
  const [imageBusy, setImageBusy] = useState('');
  const headerInput = useRef(null);
  const footerInput = useRef(null);

  const saved = resolveDocStyle(business);
  const dirty = JSON.stringify(style) !== JSON.stringify(saved);

  const set = (patch) => {
    setSavedNote(false);
    onChange({ ...style, ...patch });
  };

  const uploadImage = async (slot, file) => {
    if (!file || imageBusy) return;
    setImageBusy(slot);
    setError('');
    try {
      const { file_url } = await base44.integrations.Core.UploadPublicFile({ file });
      set({ [slot]: file_url });
    } catch {
      setError(t('print.style.saveFailed'));
    } finally {
      setImageBusy('');
    }
  };

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError('');
    try {
      await base44.entities.Business.update(business.id, { doc_style: style });
      setSavedNote(true);
      onSaved?.();
    } catch {
      setError(t('print.style.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const imageSlot = (slot, labelKey, inputRef) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{t(labelKey)}</Label>
      {style[slot] ? (
        <div className="flex items-center gap-2">
          <img
            src={style[slot]}
            alt=""
            className="h-10 max-w-[120px] border border-border bg-white object-contain"
          />
          <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={imageBusy === slot}>
            {imageBusy === slot ? <Loader2 className="h-4 w-4 animate-spin" /> : t('print.style.replaceImage')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => set({ [slot]: '' })}>
            <X className="mr-1 h-4 w-4" /> {t('print.style.removeImage')}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={imageBusy === slot}>
          {imageBusy === slot ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-4 w-4" />
          )}
          {t('print.style.uploadImage')}
        </Button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) uploadImage(slot, file);
        }}
      />
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Label className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('print.style.title')}
      </Label>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t('print.style.desc')}</p>

      <div className="mt-3 space-y-1.5">
        <Label className="text-xs">{t('print.style.logoLabel')}</Label>
        {business?.logo_url ? (
          <div className="flex items-center gap-2">
            <img
              src={business.logo_url}
              alt=""
              className="h-10 max-w-[120px] border border-border bg-white object-contain"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">{t('print.style.logoOn')}</p>
          </div>
        ) : (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('print.style.logoOff')}{' '}
            <Link to="/settings" className="font-medium text-foreground underline underline-offset-2">
              {t('nav.settings')}
            </Link>
          </p>
        )}
      </div>

      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <Label htmlFor="doc-style-color" className="text-xs">
            {t('print.style.color')}
          </Label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {t('print.style.colorHint')}
          </p>
        </div>
        <Switch
          id="doc-style-color"
          checked={style.color === true}
          onCheckedChange={(checked) => set({ color: checked === true })}
        />
      </div>

      <div className="mt-4 space-y-1.5">
        <Label className="text-xs">{t('print.style.font')}</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {FONT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => set({ font: option.key })}
              className={`rounded-lg border px-2 py-1.5 text-sm transition-colors ${
                style.font === option.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-muted'
              }`}
              style={{ fontFamily: docFontFamily({ font: option.key }) || undefined }}
            >
              {option.labelKey ? t(option.labelKey) : option.label}
            </button>
          ))}
        </div>
        <p
          className="rounded-lg bg-muted/40 px-3 py-2 text-sm leading-relaxed"
          style={{ fontFamily: docFontFamily(style) || undefined }}
        >
          {t('print.style.previewText')}
        </p>
      </div>

      <div className="mt-4 space-y-1.5">
        <Label className="text-xs">{t('print.style.border')}</Label>
        <div className="flex flex-wrap gap-1.5">
          {DOC_BORDERS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => set({ border: key })}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                style.border === key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-muted'
              }`}
            >
              <span className={`mb-1 block h-4 w-full ${BORDER_SWATCH[key]}`} aria-hidden="true" />
              {t(BORDER_LABEL_KEYS[key])}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {imageSlot('headerImage', 'print.style.headerImage', headerInput)}
        {imageSlot('footerImage', 'print.style.footerImage', footerInput)}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {t('print.style.save')}
        </Button>
        {savedNote && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs text-ok">
            <Check className="h-3.5 w-3.5" /> {t('print.style.saved')}
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
