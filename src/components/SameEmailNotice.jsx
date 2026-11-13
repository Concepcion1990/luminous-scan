import { Smartphone } from 'lucide-react';
import { t } from '@/lib/i18n';

/**
 * The same-email signpost (owner's decision, Nov 12, 2026): a visitor
 * who already has the phone app (Google Play / App Store) must create
 * their website account with the SAME email they sign into the app
 * with — a different email starts a totally new, empty storefront and
 * their shop and inventory do not come with them. Shown on Subscribe
 * and Register, before anyone commits to an account or a payment.
 * Calm by design (the owner's roomy, uncramped rule): a helpful
 * signpost on a soft panel, never a red warning box.
 */
export default function SameEmailNotice({ className = '' }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-border bg-muted/50 p-4 ${className}`.trim()}>
      <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm leading-relaxed text-muted-foreground">{t('auth.sameEmailNotice')}</p>
    </div>
  );
}
