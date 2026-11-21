import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Check, Pencil, Plus } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { PLANS } from '@/lib/plans';
import { isBoss } from '@/lib/bossAuthority';
import { memberLevelOf } from '@/lib/staff';
import useStaffAccess from '@/hooks/useStaffAccess';
import RenameBusinessDialog from '@/components/business/RenameBusinessDialog';
import ProfileAvatar from '@/components/business/ProfileAvatar';
import { useProfilePhotoSummary } from '@/lib/profilePhotos';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Switch between the businesses this login owns, and open a new one.
 * Sits on the dark header/sidebar in both layouts.
 */
export default function BusinessSwitcher({ compact = false }) {
  const { businesses, activeId, record, user, switchTo, create, canCreate, limit, isLoading, trialLabelFor } =
    useBusiness();
  // An owner or administrator opens another business whenever the plan allows it; a
  // staff seat never does, because a seat is not ownership.
  const access = useStaffAccess();
  const mayCreate = !access.loading && access.unrestricted;
  // Header rules (owner's rulings, Nov 19, 2026):
  //  - The trial line under the store name is money information:
  //    the boss sees it exactly as always; a non-owner member
  //    sees THEIR OWN NAME in that spot instead, on every page.
  //  - The rename pencil is the boss's, or a MANAGER's only when
  //    the owner ticked "edit business name" for them. Staff
  //    never see the pencil at all.
  const boss = isBoss(user, record);
  const member = access.member;
  const memberName = member?.full_name || null;
  // Profile photos (Nov 21, 2026): the person's APPROVED photo
  // sits beside their name in this header block — the boss's
  // display name (or "Owner" until they set one) beside theirs,
  // a member's own name beside theirs. A photo still waiting for
  // the owner's approval is not in the approved set, so it can
  // never appear here.
  const photoSummary = useProfilePhotoSummary(activeId);
  const approvedPhotoKeys = new Set(photoSummary.data?.approved_keys || []);
  const myPhotoKey = photoSummary.data?.me_key || null;
  const bossName = photoSummary.data?.owner_name || t('workforce.messages.owner');
  const canRename =
    boss ||
    (memberLevelOf(member) === 'manager' &&
      Array.isArray(member?.permissions) &&
      member.permissions.includes('settings.editName'));
  const activeTrial = activeId ? trialLabelFor(activeId) : null;
  const activeName = businesses.find((business) => business.id === activeId)?.name || null;
  const [renaming, setRenaming] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) {
      setError(t('settings.switcher.nameError'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await create({ name: name.trim(), tagline: tagline.trim() });
      setName('');
      setTagline('');
      setOpen(false);
    } catch (err) {
      setError(err?.message || t('settings.switcher.createError'));
    } finally {
      setBusy(false);
    }
  };

  // FINDING 23: the New button sits silently disabled at 1/1 with no
  // reason given and — in the compact (mobile) layout — no count at all.
  // Say why, and where to go: only once the allowance is known, and only
  // for someone who may create (a staff seat never sees the button).
  const atBusinessLimit = mayCreate && limit != null && !canCreate;

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      <div className={compact ? 'flex items-center gap-2' : 'space-y-2'}>
        <div className={compact ? 'min-w-0 flex-1' : 'space-y-1'}>
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-primary-foreground/45">
            {t('settings.switcher.businessLabel')}
          </p>
          <Select value={activeId ?? ''} onValueChange={switchTo} disabled={isLoading || businesses.length < 2}>
            <SelectTrigger className="h-8 w-full border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground">
              <SelectValue placeholder={t('settings.switcher.noBusiness')}>{activeName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {businesses.map((business) => {
                const trial = boss ? trialLabelFor(business.id) : null;
                return (
                  <SelectItem key={business.id} value={business.id}>
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className="truncate">{business.name}</span>
                      {trial && (
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                          {trial}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {boss ? (
            <div className="mt-1 flex items-center gap-1.5">
              <ProfileAvatar
                businessId={activeId}
                personKey="owner"
                name={bossName}
                hasPhoto={approvedPhotoKeys.has('owner')}
                className="h-5 w-5 text-[9px]"
              />
              <p className="truncate text-[11px] text-primary-foreground/70">{bossName}</p>
            </div>
          ) : null}
          {!boss && member ? (
            memberName ? (
              <div className="mt-1 flex items-center gap-1.5">
                <ProfileAvatar
                  businessId={activeId}
                  personKey={myPhotoKey}
                  name={memberName}
                  hasPhoto={Boolean(myPhotoKey && approvedPhotoKeys.has(myPhotoKey))}
                  className="h-5 w-5 text-[9px]"
                />
                <p className="truncate text-[11px] text-primary-foreground/70">{memberName}</p>
              </div>
            ) : null
          ) : activeTrial ? (
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-primary-foreground/60">
              {activeTrial}
            </p>
          ) : null}
        </div>

        <div className={compact ? 'flex shrink-0 items-center gap-1' : 'flex items-center justify-between gap-2'}>
          {canRename && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRenaming(true)}
              disabled={!record}
              aria-label={t('settings.switcher.renameAria')}
              className="h-8 px-2 text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {mayCreate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setError('');
                setOpen(true);
              }}
              disabled={!canCreate}
              className="h-8 px-2 text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> {t('settings.switcher.new')}
            </Button>
          )}
          {boss && (
            <span className="font-mono text-[9px] uppercase tracking-wide text-primary-foreground/40">
              {businesses.length}/{limit ?? '…'}
            </span>
          )}
        </div>
      </div>

      {atBusinessLimit && (
        <p className="text-[11px] leading-snug text-primary-foreground/60">
          {t('settings.switcher.limitNote', { max: PLANS.business.limits.businesses })}{' '}
          <Link to="/upgrade" className="font-medium text-primary-foreground underline underline-offset-2">
            {t('settings.switcher.upgrade')}
          </Link>
        </p>
      )}

      <RenameBusinessDialog
        open={renaming}
        onOpenChange={setRenaming}
        business={record}
      />

      {mayCreate && (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.switcher.newTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.switcher.newDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="biz-name">{t('settings.switcher.nameLabel')}</Label>
              <Input
                id="biz-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('settings.switcher.namePlaceholder')}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="biz-tagline">{t('settings.switcher.taglineLabel')}</Label>
              <Input
                id="biz-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder={t('settings.switcher.taglinePlaceholder')}
              />
            </div>
            <p className="flex items-start gap-2 rounded-lg bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
              <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {limit == null
                ? t('settings.switcher.allowanceLoading')
                : limit === 1
                  ? t('settings.switcher.allowanceOne', { limit })
                  : t('settings.switcher.allowanceMany', { limit })}{' '}
              {t('settings.switcher.startsEmpty')}
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('settings.switcher.cancel')}
            </Button>
            <Button onClick={save} disabled={busy}>
              <Check className="mr-1.5 h-4 w-4" />
              {busy ? t('settings.switcher.creating') : t('settings.switcher.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}
    </div>
  );
}