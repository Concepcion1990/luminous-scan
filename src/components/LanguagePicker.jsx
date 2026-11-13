import { Globe } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LOCALE_LABEL_KEYS, SUPPORTED_LOCALES, setLocale, t, useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Public language picker (owner's ask, Nov 12): a visitor can switch
 * the app's language BEFORE subscribing — on the landing page, Plans,
 * Subscribe, the auth pages (via AuthLayout) and the policy pages.
 * Every locale in the registry is listed by its native label (the
 * settings.details.* keys, whose values are identical in every locale
 * file, so each language always names itself). Choosing applies
 * immediately through setLocale (RTL flip included) and persists in
 * localStorage; a business created afterwards starts in this language
 * (see createBusiness in src/lib/business.js).
 *
 * tone="onPrimary" styles the trigger for the dark primary headers;
 * the default tone is for light surfaces like AuthLayout.
 */
export default function LanguagePicker({ tone = 'light', className }) {
  const locale = useLocale();
  return (
    <Select value={locale} onValueChange={(code) => setLocale(code)}>
      <SelectTrigger
        aria-label={t('settings.details.language')}
        className={cn(
          'h-9 w-44 sm:w-52',
          tone === 'onPrimary' &&
            'border-primary-foreground/40 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20 [&_svg]:text-primary-foreground',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LOCALES.map((code) => (
          <SelectItem key={code} value={code}>
            {t(LOCALE_LABEL_KEYS[code])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
