import { useState } from 'react';
import { FileUp, ShieldAlert } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';
import ImportModePicker from '@/components/import/ImportModePicker';
import ImportWorkbench from '@/components/import/ImportWorkbench';
import UpdateWorkbench from '@/components/import/UpdateWorkbench';
import ReceiveWorkbench from '@/components/import/ReceiveWorkbench';

const MODES = {
  create: ImportWorkbench,
  update: UpdateWorkbench,
  receive: ReceiveWorkbench,
};

export default function ImportCenter() {
  const { profile, activeId } = useBusiness();
  // The failed-rows download is an export, so it is Business-only — and the
  // copy must not promise it on Essentials. While the plan is still loading
  // the Essentials wording shows (fail closed on the promise).
  const { isEssentials, isLoading: entitlementLoading } = useEntitlements();
  const allowDownload = !isEssentials && !entitlementLoading;
  const [mode, setMode] = useState('create');
  const Workbench = MODES[mode];

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('import.eyebrow')}</p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('import.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t('import.subtitleStart')}{' '}
          <span className="font-medium text-foreground">{profile.name}</span>
          {t('import.subtitleRest')}
        </p>
      </div>

      {!activeId && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          {t('import.createBusinessFirst')}
        </p>
      )}

      <ImportModePicker mode={mode} onChange={setMode} />

      <Workbench businessId={activeId} />

      <div className="rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground sm:p-5">
        <p className="flex items-center gap-1.5 font-medium text-foreground">
          <FileUp className="h-3.5 w-3.5" /> {t('import.whatEachDoes')}
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">{t('import.createTitle')}</span>{' '}
          {t('import.createDesc')}
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">{t('import.updateTitle')}</span>{' '}
          {t('import.updateDesc')}
        </p>
        <p className="mt-2">
          <span className="font-medium text-foreground">{t('import.receiveModeTitle')}</span>{' '}
          {t('import.receiveModeDesc')}
        </p>
        <p className="mt-2">
          {t('import.excelNote')}
          {allowDownload ? t('import.excelNoteDownload') : t('import.excelNoteFix')}
        </p>
      </div>
    </div>
  );
}