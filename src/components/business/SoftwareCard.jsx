import SettingsCard from './SettingsCard';
import { APP_NAME, APP_TAGLINE, PUBLISHER } from '@/lib/business';

/** Read-only software identity, kept separate from the merchant's own details. */
export default function SoftwareCard() {
  return (
    <SettingsCard
      title="About this software"
      description="Luminous StockHaven is the application. Your business details elsewhere on this page are your own."
    >
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Application
          </dt>
          <dd className="mt-1 font-heading text-sm font-semibold">{APP_NAME}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Tagline
          </dt>
          <dd className="mt-1 text-sm">{APP_TAGLINE}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Publisher
          </dt>
          <dd className="mt-1 text-sm">{PUBLISHER}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        These values are fixed and appear the same for every business. Renaming your business or changing
        its logo never changes the application name.
      </p>
    </SettingsCard>
  );
}