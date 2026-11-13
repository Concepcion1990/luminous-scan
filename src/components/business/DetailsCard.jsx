import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SettingsCard from './SettingsCard';
import { t } from '@/lib/i18n';
import { CURRENCIES, DATE_FORMATS, timezoneOptions } from '@/lib/business';
import { localTimeZoneName } from '@/lib/dates';

const timezones = timezoneOptions();

export default function DetailsCard({ values, onChange }) {
  const set = (key) => (event) => onChange({ ...values, [key]: event.target.value });
  const pick = (key) => (value) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-4">
      <SettingsCard
        title={t('settings.details.contactTitle')}
        description={t('settings.details.contactDescription')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="business-email">{t('settings.details.email')}</Label>
            <Input
              id="business-email"
              type="email"
              value={values.contact_email}
              onChange={set('contact_email')}
              placeholder={t('settings.details.emailPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-phone">{t('settings.details.phone')}</Label>
            <Input
              id="business-phone"
              value={values.contact_phone}
              onChange={set('contact_phone')}
              placeholder={t('settings.details.phonePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-website">{t('settings.details.website')}</Label>
            <Input
              id="business-website"
              value={values.website}
              onChange={set('website')}
              placeholder={t('settings.details.websitePlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-address">{t('settings.details.address')}</Label>
            <Input
              id="business-address"
              value={values.address}
              onChange={set('address')}
              placeholder={t('settings.details.addressPlaceholder')}
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title={t('settings.details.regionalTitle')}
        description={t('settings.details.regionalDescription')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('settings.details.currency')}</Label>
            <Select value={values.currency} onValueChange={pick('currency')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('settings.details.timezone')}</Label>
            <Select value={values.timezone || localTimeZoneName()} onValueChange={pick('timezone')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {timezones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('settings.details.dateFormat')}</Label>
            <Select value={values.date_format} onValueChange={pick('date_format')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_FORMATS.map((format) => (
                  <SelectItem key={format.value} value={format.value}>
                    {format.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('settings.details.measurements')}</Label>
            <Select value={values.unit_system} onValueChange={pick('unit_system')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="imperial">{t('settings.details.imperial')}</SelectItem>
                <SelectItem value="metric">{t('settings.details.metric')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('settings.details.language')}</Label>
            <Select value={values.language} onValueChange={pick('language')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="am">{t('settings.details.amharic')}</SelectItem>
                <SelectItem value="ar">{t('settings.details.arabic')}</SelectItem>
                <SelectItem value="bho">{t('settings.details.bhojpuri')}</SelectItem>
                <SelectItem value="bn">{t('settings.details.bengali')}</SelectItem>
                <SelectItem value="de">{t('settings.details.german')}</SelectItem>
                <SelectItem value="en">{t('settings.details.english')}</SelectItem>
                <SelectItem value="es-CU">{t('settings.details.spanishCuba')}</SelectItem>
                <SelectItem value="es-ES">{t('settings.details.spanishSpain')}</SelectItem>
                <SelectItem value="es-MX">{t('settings.details.spanishMexico')}</SelectItem>
                <SelectItem value="es-PR">{t('settings.details.spanishPuertoRico')}</SelectItem>
                <SelectItem value="es-US">{t('settings.details.spanishUS')}</SelectItem>
                <SelectItem value="es-VE">{t('settings.details.spanishVenezuela')}</SelectItem>
                <SelectItem value="fa">{t('settings.details.persian')}</SelectItem>
                <SelectItem value="fr-CA">{t('settings.details.frenchCanadian')}</SelectItem>
                <SelectItem value="fr-FR">{t('settings.details.french')}</SelectItem>
                <SelectItem value="gu">{t('settings.details.gujarati')}</SelectItem>
                <SelectItem value="ha">{t('settings.details.hausa')}</SelectItem>
                <SelectItem value="hi">{t('settings.details.hindi')}</SelectItem>
                <SelectItem value="id">{t('settings.details.indonesian')}</SelectItem>
                <SelectItem value="it">{t('settings.details.italian')}</SelectItem>
                <SelectItem value="ja">{t('settings.details.japanese')}</SelectItem>
                <SelectItem value="jv">{t('settings.details.javanese')}</SelectItem>
                <SelectItem value="kn">{t('settings.details.kannada')}</SelectItem>
                <SelectItem value="ko">{t('settings.details.korean')}</SelectItem>
                <SelectItem value="mr">{t('settings.details.marathi')}</SelectItem>
                <SelectItem value="ms">{t('settings.details.malay')}</SelectItem>
                <SelectItem value="pa-Arab">{t('settings.details.punjabiShahmukhi')}</SelectItem>
                <SelectItem value="pa-Guru">{t('settings.details.punjabiGurmukhi')}</SelectItem>
                <SelectItem value="pcm">{t('settings.details.nigerianPidgin')}</SelectItem>
                <SelectItem value="prs">{t('settings.details.dari')}</SelectItem>
                <SelectItem value="pt-BR">{t('settings.details.portugueseBrazil')}</SelectItem>
                <SelectItem value="pt-PT">{t('settings.details.portuguesePortugal')}</SelectItem>
                <SelectItem value="ru">{t('settings.details.russian')}</SelectItem>
                <SelectItem value="tg">{t('settings.details.tajik')}</SelectItem>
                <SelectItem value="wuu">{t('settings.details.shanghainese')}</SelectItem>
                <SelectItem value="yue">{t('settings.details.cantonese')}</SelectItem>
                <SelectItem value="zh-Hans">{t('settings.details.mandarinSimplified')}</SelectItem>
                <SelectItem value="zh-Hant">{t('settings.details.mandarinTraditional')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('settings.details.moreLanguages')}</p>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}