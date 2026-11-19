import { useEffect, useState } from 'react';
import { Check, Download } from 'lucide-react';
import SettingsCard from './SettingsCard';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import {
  canPromptInstall,
  installPlatform,
  isStandalone,
  onInstallAvailabilityChange,
  promptInstall,
} from '@/lib/pwaInstall';

const STEP_KEYS = {
  ios: 'settings.install.iosSteps',
  android: 'settings.install.androidSteps',
  desktop: 'settings.install.desktopSteps',
};

/**
 * The permanent "Download the app" door (Nov 19, 2026) — on the
 * owner's Settings and on every member's personal Settings alike.
 * Three honest states:
 *   - already installed / running installed: says so, no button;
 *   - the browser offers its install prompt: the button fires it;
 *   - no prompt to fire (already used, dismissed, or the platform
 *     never offers one — iOS Safari): the button opens the manual
 *     add-to-home-screen steps for this platform instead. Never a
 *     dead end.
 */
export default function InstallAppCard({ showOwnerNote = false }) {
  const [standalone] = useState(isStandalone);
  const [promptReady, setPromptReady] = useState(canPromptInstall);
  const [showSteps, setShowSteps] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);

  useEffect(() => onInstallAvailabilityChange(() => setPromptReady(canPromptInstall())), []);

  const onDownload = async () => {
    if (!canPromptInstall()) {
      setShowSteps(true);
      return;
    }
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      setJustInstalled(true);
      setShowSteps(false);
    } else {
      // The browser's prompt is spent (it is single-use): fall
      // back to the manual steps rather than leaving a dead door.
      setShowSteps(true);
    }
    setPromptReady(canPromptInstall());
  };

  return (
    <SettingsCard
      title={t('settings.install.title')}
      description={t('settings.install.description')}
    >
      {standalone || justInstalled ? (
        <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground" role="status">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
          <span>{t('settings.install.installed')}</span>
        </p>
      ) : (
        <div className="space-y-3">
          <Button type="button" onClick={onDownload} className="min-h-11">
            <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('settings.install.button')}
          </Button>
          {showSteps && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm leading-relaxed">
              <p className="text-muted-foreground">{t('settings.install.manualIntro')}</p>
              <p className="mt-2">{t(STEP_KEYS[installPlatform()])}</p>
            </div>
          )}
          {!promptReady && !showSteps && (
            <p className="text-xs text-muted-foreground">{t('settings.install.manualIntro')}</p>
          )}
        </div>
      )}
      {/* The lifeline note (owner's ruling, Nov 19, 2026) renders
          ONLY in the owner's Settings: owners are the ones who
          subscribe through the stores, so the store-blocking
          scenario is theirs to know about. Staff and managers
          keep the plain door — no note, no notification; the
          store side of the subscription is not their business.
          Generic wording on purpose: "your app store", never a
          company name. */}
      {showOwnerNote && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('settings.install.ownerNote')}
        </p>
      )}
    </SettingsCard>
  );
}
