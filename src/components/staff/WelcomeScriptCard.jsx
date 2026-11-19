import { useEffect, useState } from 'react';
import { Check, Loader2, Save } from 'lucide-react';
import { apiRequest } from '@/api/client';
import { useBusiness } from '@/hooks/useBusiness';
import { isBoss } from '@/lib/bossAuthority';
import SettingsCard from '@/components/business/SettingsCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { t } from '@/lib/i18n';

/**
 * The owner's welcome script (Nov 19, 2026) — the words a new
 * hire reads on their one-time welcome page, rewritten by the
 * owner so it feels like THEIR store. Boss-only: this card never
 * renders for anyone else.
 *
 * The permanent line — "Welcome to Luminous StockHaven" — is
 * shown above the editor as fixed app copy: it is not in the
 * script, cannot be edited, and cannot be removed. Inside the
 * script, {name} fills in the person's first name and {store}
 * the store's name. Saving the box EMPTY restores the app's
 * standard welcome (shown under the editor) — a hire never
 * lands on a blank page.
 */
export default function WelcomeScriptCard() {
  const { user, record, profile, activeId, refresh } = useBusiness();
  const { toast } = useToast();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setValue(profile?.staff_welcome_script ?? '');
  }, [profile?.id, profile?.staff_welcome_script]);

  if (!isBoss(user, record)) return null;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await apiRequest(`/api/businesses/${encodeURIComponent(activeId)}`, {
        method: 'PATCH',
        body: { staff_welcome_script: value },
      });
      await refresh();
      setSaved(true);
      toast({ title: t('staffWelcome.editor.saved') });
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err?.message || t('settings.save.error'));
    } finally {
      setSaving(false);
    }
  };

  const defaultScript = [
    t('staffWelcome.defaultGreeting', { name: '{name}' }),
    t('staffWelcome.defaultStoreLine', { store: '{store}' }),
    t('staffWelcome.defaultTrainingLine'),
    t('staffWelcome.defaultGladLine'),
  ].join('\n');

  return (
    <SettingsCard
      title={t('staffWelcome.editor.title')}
      description={t('staffWelcome.editor.description')}
    >
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-3">
        <p className="font-heading text-base font-semibold">{t('staffWelcome.title')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('staffWelcome.editor.permanentNote')}</p>
      </div>
      <div className="space-y-2">
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={5}
          placeholder={defaultScript}
          aria-label={t('staffWelcome.editor.title')}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">{t('staffWelcome.editor.tokens')}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('staffWelcome.editor.emptyNote')}</p>
      </div>
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="mr-1.5 h-4 w-4" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          {saving ? t('settings.save.saving') : saved ? t('settings.save.saved') : t('staffWelcome.editor.save')}
        </Button>
      </div>
    </SettingsCard>
  );
}
