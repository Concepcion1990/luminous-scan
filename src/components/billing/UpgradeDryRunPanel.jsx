import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runUpgradeDryRun } from '@/lib/upgradeDryRun';

/**
 * No API calls. Uses fictitious billing and one fictitious pajama row only.
 * Owner-guarded in parent; cannot activate or schedule customer billing.
 */
export default function UpgradeDryRunPanel() {
  const [result, setResult] = useState(null);
  return (
    <section className="rounded-xl border border-border bg-card p-4 text-sm sm:p-5" aria-label="Test upgrade simulation">
      <h3 className="flex items-center gap-2 font-semibold">
        <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
        Essentials → Business — practice simulation
      </h3>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        Practice the proposed upgrade rules using entirely fictional records in this browser.
        This does not read or change your real TEST — Pajama Pants sample, your current Business
        workspace, Stripe, trials, subscriptions or inventory.
      </p>
      <Button type="button" variant="outline" className="mt-3 min-h-11"
        onClick={() => setResult(runUpgradeDryRun())}>
        Run local upgrade simulation (no charge)
      </Button>
      {result && (
        <div className="mt-3 space-y-2 rounded-lg border border-border bg-secondary/50 p-3" role="status" aria-live="polite">
          <p className="font-semibold">
            {result.passed ? 'Fictional scenario passed its local checks' : 'Fictional scenario was blocked'}
          </p>
          {result.passed ? (
            <>
              <p>Example: Essentials ($14.99/month) → Business ($29.99/month), before any applicable tax.</p>
              <p>
                Same subscription retained, one original trial retained, and simulated pajama
                inventory unchanged. The example customer stays on Essentials until a real,
                provider-confirmed paid renewal would justify changing access.
              </p>
              <p className="text-muted-foreground">
                A local simulation does not test Stripe subscription changes, a payment, a webhook, a
                tax-inclusive quote, a live subscription or your actual business records.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">{result.reason}. No records were changed.</p>
          )}
        </div>
      )}
    </section>
  );
}
