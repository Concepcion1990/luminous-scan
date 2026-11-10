import { useRef } from 'react';
import { Image } from '@/components/ui/image';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import SettingsCard from './SettingsCard';
import { t } from '@/lib/i18n';
import { BRAND_COLORS } from '@/lib/business';

export default function IdentityCard({ values, onChange, onLogoSelected, uploading }) {
  const fileRef = useRef(null);
  const set = (key) => (event) => onChange({ ...values, [key]: event.target.value });

  return (
    <SettingsCard
      title={t('settings.identity.title')}
      description={t('settings.identity.description')}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="business-name">{t('settings.identity.nameLabel')}</Label>
          <Input id="business-name" value={values.name} onChange={set('name')} placeholder={t('settings.identity.namePlaceholder')} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="business-tagline">{t('settings.identity.taglineLabel')}</Label>
          <Input
            id="business-tagline"
            value={values.tagline}
            onChange={set('tagline')}
            placeholder={t('settings.identity.taglinePlaceholder')}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t('settings.identity.logoLabel')}</Label>
        <div className="flex items-center gap-3">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-secondary">
            {values.logo_url ? (
              <Image
                src={values.logo_url}
                alt={t('settings.identity.logoAlt', { name: values.name || t('settings.identity.businessFallback') })}
                fittingType="fit"
                className="h-full w-full object-contain p-1"
              />
            ) : (
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onLogoSelected(file);
                event.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {values.logo_url ? t('settings.identity.replaceLogo') : t('settings.identity.uploadLogo')}
            </Button>
            {values.logo_url && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...values, logo_url: '' })}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {t('settings.identity.remove')}
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('settings.identity.logoHint')}</p>
      </div>

      <div className="space-y-2">
        <Label>{t('settings.identity.brandColor')}</Label>
        <div className="flex flex-wrap items-center gap-2">
          {BRAND_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              title={color.label}
              aria-label={color.label}
              onClick={() => onChange({ ...values, brand_color: color.value })}
              className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-105 ${
                values.brand_color?.toLowerCase() === color.value.toLowerCase()
                  ? 'border-foreground'
                  : 'border-transparent'
              }`}
              style={{ backgroundColor: color.value }}
            />
          ))}
          <label className="ml-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="color"
              value={values.brand_color || '#145042'}
              onChange={set('brand_color')}
              className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
            {t('settings.identity.custom')}
          </label>
        </div>
      </div>
    </SettingsCard>
  );
}