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
import { CURRENCIES, DATE_FORMATS, timezoneOptions } from '@/lib/business';
import { localTimeZoneName } from '@/lib/dates';

const timezones = timezoneOptions();

export default function DetailsCard({ values, onChange }) {
  const set = (key) => (event) => onChange({ ...values, [key]: event.target.value });
  const pick = (key) => (value) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Contact information"
        description="Optional — used on receipts, packing slips and business documents."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="business-email">Email</Label>
            <Input
              id="business-email"
              type="email"
              value={values.contact_email}
              onChange={set('contact_email')}
              placeholder="hello@yourbusiness.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-phone">Phone</Label>
            <Input
              id="business-phone"
              value={values.contact_phone}
              onChange={set('contact_phone')}
              placeholder="(555) 123-4567"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-website">Website</Label>
            <Input
              id="business-website"
              value={values.website}
              onChange={set('website')}
              placeholder="yourbusiness.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-address">Address</Label>
            <Input
              id="business-address"
              value={values.address}
              onChange={set('address')}
              placeholder="Street, city, state, ZIP"
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Currency, dates and units"
        description="How money, dates and measurements are shown throughout the app."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Currency</Label>
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
            <Label>Timezone</Label>
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
            <Label>Date format</Label>
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
            <Label>Measurements</Label>
            <Select value={values.unit_system} onValueChange={pick('unit_system')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="imperial">Imperial (oz, in)</SelectItem>
                <SelectItem value="metric">Metric (g, cm)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Language</Label>
            <Select value={values.language} onValueChange={pick('language')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">More languages are being prepared.</p>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}