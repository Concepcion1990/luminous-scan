import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runUpgradeDryRun } from '@/lib/upgradeDryRun';
import { t } from '@/lib/i18n';

/**
 * No API calls. Uses fictitious billing and one fictitious pajama row only.
 * Owner-guarded in parent; cannot activate or schedule customer billing.
 */
export default function UpgradeDryRunPanel() {
  const [result, setResult] = useState(null);
  return (
    <section className="rounded-xl border border-border bg-card p-4 text-sm sm:p-5" aria-label={t('billing.dryRun.ariaLabel')}>
      <h3 className="flex items-center gap-2 font-semibold">
        <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('billing.dryRun.title')}
      </h3>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        {t('billing.dryRun.body')}
      </p>
      <Button type="button" variant="outline" className="mt-3 min-h-11"
        onClick={() => setResult(runUpgradeDryRun())}>
        {t('billing.dryRun.runButton')}
      </Button>
      {result && (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-secondary/50 p-3" role="status" aria-live="polite">
          <p className="font-semibold">
            {result.passed ? t('billing.dryRun.passed') : t('billing.dryRun.blocked')}
          </p>
          {result.passed ? (
            <>
              <p>{t('billing.dryRun.example')}</p>
              <p>
                {t('billing.dryRun.preserved')}
              </p>
              <p className="text-muted-foreground">
                {t('billing.dryRun.limitations')}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">{result.reason}. {t('billing.dryRun.noRecordsChanged')}</p>
          )}
        </div>
      )}
    </section>
  );
}
