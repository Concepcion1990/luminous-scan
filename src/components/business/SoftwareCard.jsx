import SettingsCard from './SettingsCard';
import { t } from '@/lib/i18n';
import { APP_NAME, APP_TAGLINE, PUBLISHER } from '@/lib/business';

/** Read-only software identity, kept separate from the merchant's own details. */
export default function SoftwareCard() {
  return (
    <SettingsCard
      title={t('settings.software.title')}
      description={t('settings.software.description')}
    >
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('settings.software.application')}
          </dt>
          <dd className="mt-1 font-heading text-sm font-semibold">{APP_NAME}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('settings.software.tagline')}
          </dt>
          <dd className="mt-1 text-sm">{APP_TAGLINE}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('settings.software.publisher')}
          </dt>
          <dd className="mt-1 text-sm">{PUBLISHER}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {t('settings.software.fixedNote')}
      </p>
    </SettingsCard>
  );
}