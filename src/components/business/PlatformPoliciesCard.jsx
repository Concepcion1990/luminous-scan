import { Link } from 'react-router-dom';
import SettingsCard from './SettingsCard';
import { t } from '@/lib/i18n';

/**
 * Luminous StockHaven's OWN policies (Nov 19, 2026) — the app's
 * Terms of Service, Privacy Policy and Subscription Policy.
 * They stay with the app, and EVERYONE — owner, manager, staff —
 * can pull them up from inside the app, here in Settings, beside
 * the business's own documents (BusinessPoliciesCard). The
 * boss's Settings already carried these doors inside its
 * subscription card; this card gives the team's Settings the
 * same doors. The legal texts themselves live in the legal
 * pages and are never edited from here.
 */
export default function PlatformPoliciesCard() {
  return (
    <SettingsCard
      title={t('settings.platformPolicies.title')}
      description={t('settings.platformPolicies.description')}
    >
      <p className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <Link to="/terms-of-service" className="font-medium text-link underline underline-offset-4">
          {t('settings.review.termsLink')}
        </Link>
        <Link to="/privacy-policy" className="font-medium text-link underline underline-offset-4">
          {t('settings.review.privacyLink')}
        </Link>
        <Link to="/subscription-policy" className="font-medium text-link underline underline-offset-4">
          {t('settings.review.policyLink')}
        </Link>
      </p>
    </SettingsCard>
  );
}
