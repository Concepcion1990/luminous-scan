import { useEffect, useState } from 'react';
import { Check, Loader2, LogOut, Monitor, Moon, Save, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { apiRequest } from '@/api/client';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import { useAuth } from '@/lib/AuthContext';
import { memberLevelOf } from '@/lib/staff';
import { gs1LinksForLocale } from '@/lib/gs1Links';
import LanguagePicker from '@/components/LanguagePicker';
import SettingsSectionNav from './SettingsSectionNav';
import BusinessPoliciesCard from './BusinessPoliciesCard';
import ProfilePhotoCard from './ProfilePhotoCard';
import PlatformPoliciesCard from './PlatformPoliciesCard';
import SettingsCard from './SettingsCard';
import SecurityCard from './SecurityCard';
import SupportCard from './SupportCard';
import SoftwareCard from './SoftwareCard';
import InstallAppCard from './InstallAppCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { t, useLocale } from '@/lib/i18n';

const APPEARANCE_OPTIONS = [
  { value: 'light', labelKey: 'settings.appearance.light', descriptionKey: 'settings.appearance.lightDesc', icon: Sun },
  { value: 'dark', labelKey: 'settings.appearance.dark', descriptionKey: 'settings.appearance.darkDesc', icon: Moon },
  { value: 'system', labelKey: 'settings.appearance.automatic', descriptionKey: 'settings.appearance.automaticDesc', icon: Monitor },
];

/**
 * PERSONAL Settings (Nov 19, 2026) — what a non-owner member gets
 * when they open Settings. Before this page existed, staff had
 * no Settings door at all and no reachable sign out, while their
 * training assigned the Settings lessons (spare keys, lost-access
 * recovery, Report a problem) for pages they could not open.
 *
 * Scope is personal, by the owner's rulings:
 *   - their profile photo (ProfilePhotoCard — Nov 21, 2026: the
 *     member picks a photo, the OWNER approves it, and until
 *     then it shows nowhere; the decision and its wording live
 *     on this card);
 *   - account + security (SecurityCard — the same verified
 *     machinery the owner uses: backup email, spare keys,
 *     change email, signed-in change password);
 *   - appearance + language (the language control binds to the
 *     ONE live locale, applies instantly — a member's pick
 *     governs their session, exactly the release-281 semantics);
 *   - Report a problem (SupportCard — live for any signed-in
 *     role);
 *   - the business's own Store Policies + Terms & Conditions,
 *     read-only (BusinessPoliciesCard — the owner's documents,
 *     shown once at the member's first-start welcome and living
 *     here; the card renders nothing when the owner has written
 *     nothing), and Luminous StockHaven's own policies
 *     (PlatformPoliciesCard — the app's legal pages, pull-up-able
 *     by every role);
 *   - the permanent Download the app door;
 *   - any business sections the OWNER ticked for this member
 *     (tax rate / business details / GS1 / edit business name),
 *     each a working section with its own save, authorized
 *     server-side field by field.
 *
 * Money is NEVER here: no trial countdown, no plan card, no
 * subscription or billing section — those are the owner's alone
 * and are not grantable. Unticked sections do not render at all.
 */
export default function PersonalSettings() {
  const { user, profile, activeId, refresh } = useBusiness();
  const { member } = useStaffAccess();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    setThemeReady(true);
  }, []);

  const grants = new Set(Array.isArray(member?.permissions) ? member.permissions : []);
  const level = memberLevelOf(member);
  const canTaxRate = grants.has('settings.taxRate');
  const canDetails = grants.has('settings.businessDetails');
  const canGs1 = grants.has('settings.gs1');
  // The name tick only ever takes effect for a manager — the
  // server enforces the same rule; the field simply never
  // renders for staff.
  const canName = grants.has('settings.editName') && level === 'manager';
  // The contact-details tick (address + phone) likewise only
  // ever takes effect for a manager (owner ruling, Nov 19,
  // 2026); everyone else sees those details read-only on the
  // business card below.
  const canContact = grants.has('settings.contactDetails') && level === 'manager';

  // The policies card renders only when the owner has written
  // something; it reports its own visibility so the section
  // ribbon below lists exactly what is on this page. A business
  // switch starts from visible again (the card re-reads).
  const [policiesVisible, setPoliciesVisible] = useState(true);
  useEffect(() => {
    setPoliciesVisible(true);
  }, [activeId]);

  // The mobile section ribbon's chips (Nov 20, 2026): exactly
  // the sections rendered below, in render order — granted
  // sections appear under the same grants that render them,
  // and the policies chip follows the policies card itself.
  const sections = [
    { id: 'settings-sec-profile', labelKey: 'profile.title' },
    { id: 'settings-sec-security', labelKey: 'settings.security.title' },
    { id: 'settings-sec-appearance', labelKey: 'settings.appearance.title' },
    { id: 'settings-sec-business', labelKey: 'settings.businessCard.title' },
    ...(policiesVisible
      ? [{ id: 'settings-sec-policies', labelKey: 'settings.policies.title' }]
      : []),
    ...(canName || canDetails || canContact
      ? [{ id: 'settings-sec-granted-details', labelKey: 'settings.details.contactTitle' }]
      : []),
    ...(canTaxRate
      ? [{ id: 'settings-sec-granted-tax', labelKey: 'settings.details.taxRate' }]
      : []),
    ...(canGs1
      ? [{ id: 'settings-sec-granted-gs1', labelKey: 'settings.details.gs1Prefix' }]
      : []),
    { id: 'settings-sec-support', labelKey: 'support.title' },
    { id: 'settings-sec-platform-policies', labelKey: 'settings.platformPolicies.title' },
    { id: 'settings-sec-install', labelKey: 'settings.install.title' },
    { id: 'settings-sec-software', labelKey: 'settings.software.title' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('settings.eyebrow')}</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('settings.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('settings.personal.subtitle')}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => logout()}>
          <LogOut className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {t('settings.logout')}
        </Button>
      </div>

      <SettingsSectionNav sections={sections} />

      <div id="settings-sec-profile">
        <ProfilePhotoCard isOwner={false} personName={member?.full_name || ''} />
      </div>

      <div id="settings-sec-security">
        <SecurityCard />
      </div>

      <div id="settings-sec-appearance">
      <SettingsCard
        title={t('settings.appearance.title')}
        description={t('settings.appearance.description')}
      >
        <fieldset disabled={!themeReady}>
          <legend className="sr-only">{t('settings.appearance.legend')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {APPEARANCE_OPTIONS.map(({ value, labelKey, descriptionKey, icon: Icon }) => (
              <label
                key={value}
                className={[
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                  'focus-within:ring-2 focus-within:ring-ring',
                  themeReady && theme === value
                    ? 'border-ring bg-secondary'
                    : 'border-border hover:bg-muted',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="stockhaven-appearance"
                  value={value}
                  checked={themeReady && theme === value}
                  onChange={() => setTheme(value)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[#B99B6A]"
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {t(labelKey)}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{t(descriptionKey)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">{t('settings.appearance.remembered')}</p>
        <div className="space-y-2">
          <Label>{t('settings.details.language')}</Label>
          <div>
            <LanguagePicker />
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.details.moreLanguages')}</p>
        </div>
      </SettingsCard>
      </div>

      <div id="settings-sec-business">
        <BusinessCardReadOnly profile={profile} showContact={!canContact} />
      </div>

      {policiesVisible ? (
        <div id="settings-sec-policies">
          <BusinessPoliciesCard
            businessId={activeId}
            editable={false}
            onVisibilityChange={setPoliciesVisible}
          />
        </div>
      ) : null}

      {canName || canDetails || canContact ? (
        <div id="settings-sec-granted-details">
          <GrantedDetailsCard
            businessId={activeId}
            profile={profile}
            canName={canName}
            canDetails={canDetails}
            canContact={canContact}
            onSaved={refresh}
          />
        </div>
      ) : null}

      {canTaxRate ? (
        <div id="settings-sec-granted-tax">
          <GrantedTaxRateCard businessId={activeId} profile={profile} onSaved={refresh} />
        </div>
      ) : null}

      {canGs1 ? (
        <div id="settings-sec-granted-gs1">
          <GrantedGs1Card businessId={activeId} profile={profile} onSaved={refresh} />
        </div>
      ) : null}

      <div id="settings-sec-support">
        <SupportCard />
      </div>

      <div id="settings-sec-platform-policies">
        <PlatformPoliciesCard />
      </div>

      <div id="settings-sec-install">
        <InstallAppCard />
      </div>

      <div id="settings-sec-software">
        <SoftwareCard />
      </div>
    </div>
  );
}

/** One granted section's own save: PATCH only that section's fields. */
function useSectionSave(businessId, onSaved) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const save = async (fields) => {
    setSaving(true);
    setError('');
    try {
      await apiRequest(`/api/businesses/${encodeURIComponent(businessId)}`, {
        method: 'PATCH',
        body: fields,
      });
      await onSaved?.();
      setSaved(true);
      toast({ title: t('settings.save.savedToast') });
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err?.message || t('settings.save.error'));
    } finally {
      setSaving(false);
    }
  };
  return { save, saving, saved, error };
}

function SaveRow({ saving, saved }) {
  return (
    <div>
      <Button type="submit" disabled={saving}>
        {saving ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : saved ? (
          <Check className="mr-1.5 h-4 w-4" />
        ) : (
          <Save className="mr-1.5 h-4 w-4" />
        )}
        {saving ? t('settings.save.saving') : saved ? t('settings.save.saved') : t('settings.save.save')}
      </Button>
    </div>
  );
}

function SectionError({ error }) {
  if (!error) return null;
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );
}

function GrantedTaxRateCard({ businessId, profile, onSaved }) {
  const [value, setValue] = useState(profile?.tax_rate ?? '');
  useEffect(() => {
    setValue(profile?.tax_rate ?? '');
  }, [profile?.tax_rate]);
  // The tax mode rides the same card and the same tick
  // (release 347): the granted member keeps the rate AND
  // chooses Fixed vs Automatic, saved through the same door.
  const [mode, setMode] = useState(profile?.tax_mode === 'automatic' ? 'automatic' : 'fixed');
  useEffect(() => {
    setMode(profile?.tax_mode === 'automatic' ? 'automatic' : 'fixed');
  }, [profile?.tax_mode]);
  const { save, saving, saved, error } = useSectionSave(businessId, onSaved);
  return (
    <SettingsCard title={t('settings.details.taxRate')} description={t('settings.details.taxRateHint')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save({ tax_rate: value, tax_mode: mode });
        }}
        className="space-y-3"
      >
        <div className="space-y-2">
          <Label htmlFor="granted-tax-rate">{t('settings.details.taxRate')}</Label>
          <div className="relative max-w-xs">
            <Input
              id="granted-tax-rate"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="8.25"
              className="pr-8"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              %
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="granted-tax-mode">{t('settings.details.taxMode')}</Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger id="granted-tax-mode" className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">{t('settings.details.taxModeFixed')}</SelectItem>
              <SelectItem value="automatic">{t('settings.details.taxModeAutomatic')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('settings.details.taxModeHint')}</p>
        </div>
        <SectionError error={error} />
        <SaveRow saving={saving} saved={saved} />
      </form>
    </SettingsCard>
  );
}

function GrantedGs1Card({ businessId, profile, onSaved }) {
  const locale = useLocale();
  const gs1Links = gs1LinksForLocale(locale);
  const [value, setValue] = useState(profile?.gs1_prefix ?? '');
  useEffect(() => {
    setValue(profile?.gs1_prefix ?? '');
  }, [profile?.gs1_prefix]);
  const { save, saving, saved, error } = useSectionSave(businessId, onSaved);
  return (
    <SettingsCard title={t('settings.details.gs1Prefix')} description={t('settings.details.gs1PrefixHint')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save({ gs1_prefix: value });
        }}
        className="space-y-3"
      >
        <div className="space-y-2">
          <Label htmlFor="granted-gs1-prefix">{t('settings.details.gs1Prefix')}</Label>
          <Input
            id="granted-gs1-prefix"
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="123456"
            className="max-w-xs font-mono"
          />
          <p className="text-xs text-muted-foreground">
            {t(gs1Links.us ? 'settings.details.gs1LearnMore' : 'settings.details.gs1LearnMoreUs')}
          </p>
          <a
            href={gs1Links.own.url}
            target="_blank"
            rel="noreferrer"
            className="block w-fit text-xs font-medium underline underline-offset-2"
          >
            {gs1Links.own.global ? t('settings.details.gs1GlobalSite') : gs1Links.own.name}
          </a>
          {gs1Links.us && (
            <a
              href={gs1Links.us.url}
              target="_blank"
              rel="noreferrer"
              className="block w-fit text-xs font-medium underline underline-offset-2"
            >
              {gs1Links.us.name}
            </a>
          )}
        </div>
        <SectionError error={error} />
        <SaveRow saving={saving} saved={saved} />
      </form>
    </SettingsCard>
  );
}

/**
 * The read-only business card every non-owner member sees
 * (owner ruling, Nov 19, 2026): the business name, the complete
 * address as one formatted block, and the phone number —
 * plainly labeled, with NO input boxes and no edit affordance
 * of any kind. When the member holds the contact-details grant
 * (managers only), the address/phone move into the editable
 * granted section below and are not repeated here.
 */
function BusinessCardReadOnly({ profile, showContact }) {
  const address = (profile?.address ?? '').trim();
  const phone = (profile?.contact_phone ?? '').trim();
  return (
    <SettingsCard title={t('settings.businessCard.title')}>
      <div className="space-y-3">
        <p className="text-base font-semibold">{profile?.name ?? ''}</p>
        {showContact ? (
          address || phone ? (
            <div className="space-y-3">
              {address ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('settings.businessCard.address')}
                  </p>
                  <p className="whitespace-pre-line text-sm">{address}</p>
                </div>
              ) : null}
              {phone ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('settings.businessCard.phone')}
                  </p>
                  <p className="text-sm">{phone}</p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('settings.businessCard.empty')}</p>
          )
        ) : null}
      </div>
    </SettingsCard>
  );
}

function GrantedDetailsCard({ businessId, profile, canName, canDetails, canContact, onSaved }) {
  const [values, setValues] = useState({
    name: profile?.name ?? '',
    tagline: profile?.tagline ?? '',
    contact_email: profile?.contact_email ?? '',
    contact_phone: profile?.contact_phone ?? '',
    website: profile?.website ?? '',
    address: profile?.address ?? '',
  });
  useEffect(() => {
    setValues({
      name: profile?.name ?? '',
      tagline: profile?.tagline ?? '',
      contact_email: profile?.contact_email ?? '',
      contact_phone: profile?.contact_phone ?? '',
      website: profile?.website ?? '',
      address: profile?.address ?? '',
    });
  }, [profile?.id]);
  const { save, saving, saved, error } = useSectionSave(businessId, onSaved);
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const submit = (event) => {
    event.preventDefault();
    const fields = {};
    if (canName) fields.name = values.name;
    if (canDetails) {
      fields.tagline = values.tagline;
      fields.contact_email = values.contact_email;
      fields.website = values.website;
    }
    if (canContact) {
      fields.contact_phone = values.contact_phone;
      fields.address = values.address;
    }
    save(fields);
  };
  return (
    <SettingsCard
      title={t('settings.details.contactTitle')}
      description={t('settings.details.contactDescription')}
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2">
          {canName && (
            <div className="space-y-2">
              <Label htmlFor="granted-business-name">{t('settings.identity.nameLabel')}</Label>
              <Input
                id="granted-business-name"
                value={values.name}
                onChange={set('name')}
                placeholder={t('settings.identity.namePlaceholder')}
              />
            </div>
          )}
          {canDetails && (
            <>
              <div className="space-y-2">
                <Label htmlFor="granted-business-tagline">{t('settings.identity.taglineLabel')}</Label>
                <Input
                  id="granted-business-tagline"
                  value={values.tagline}
                  onChange={set('tagline')}
                  placeholder={t('settings.identity.taglinePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="granted-business-email">{t('settings.details.email')}</Label>
                <Input
                  id="granted-business-email"
                  type="email"
                  value={values.contact_email}
                  onChange={set('contact_email')}
                  placeholder={t('settings.details.emailPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="granted-business-website">{t('settings.details.website')}</Label>
                <Input
                  id="granted-business-website"
                  value={values.website}
                  onChange={set('website')}
                  placeholder={t('settings.details.websitePlaceholder')}
                />
              </div>
            </>
          )}
          {canContact && (
            <>
              <div className="space-y-2">
                <Label htmlFor="granted-business-phone">{t('settings.details.phone')}</Label>
                <Input
                  id="granted-business-phone"
                  value={values.contact_phone}
                  onChange={set('contact_phone')}
                  placeholder={t('settings.details.phonePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="granted-business-address">{t('settings.details.address')}</Label>
                <Input
                  id="granted-business-address"
                  value={values.address}
                  onChange={set('address')}
                  placeholder={t('settings.details.addressPlaceholder')}
                />
              </div>
            </>
          )}
        </div>
        <SectionError error={error} />
        <SaveRow saving={saving} saved={saved} />
      </form>
    </SettingsCard>
  );
}
