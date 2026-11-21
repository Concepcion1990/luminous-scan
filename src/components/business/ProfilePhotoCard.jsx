import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Save } from 'lucide-react';
import { apiRequest } from '@/api/client';
import { useBusiness } from '@/hooks/useBusiness';
import SettingsCard from './SettingsCard';
import ProfileAvatar from './ProfileAvatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { prepareImageForUpload } from '@/lib/imagePrep';
import {
  myPendingPhotoUrl,
  profilePhotosBase,
  useMyProfilePhoto,
  useProfilePhotoSummary,
} from '@/lib/profilePhotos';
import { t } from '@/lib/i18n';

/**
 * Your profile photo (Nov 21, 2026) — and, for the owner, the
 * name the whole team knows you by.
 *
 * A team member's photo goes to the owner for approval and
 * shows nowhere until it is approved; a change follows the same
 * path and the old photo stays up while the new one waits. The
 * owner's own photo is live the moment it is set. The owner's
 * display name replaces the word "Owner" everywhere the moment
 * it is saved — until then, "Owner" is the fallback.
 */
export default function ProfilePhotoCard({ isOwner, personName }) {
  const { activeId } = useBusiness();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState(null);

  const meQuery = useMyProfilePhoto(activeId);
  const summaryQuery = useProfilePhotoSummary(activeId);
  const me = meQuery.data || null;
  const state = me?.has_approved && me?.has_pending
    ? 'approved_pending'
    : me?.has_pending
      ? 'pending'
      : me?.has_approved
        ? 'approved'
        : 'none';
  const ownerName = summaryQuery.data?.owner_name ?? null;
  const nameValue = nameDraft ?? ownerName ?? '';

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['profile-photos', activeId] });
  };

  const pickPhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !activeId) return;
    setBusy(true);
    try {
      // prepareImageForUpload returns a sized File/Blob; the
      // route takes a data URL (the product-photo pattern).
      const prepared = await prepareImageForUpload(file);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(t('profile.toastFailed')));
        reader.readAsDataURL(prepared);
      });
      await apiRequest(`${profilePhotosBase(activeId)}/me`, {
        method: 'POST',
        body: { dataUrl },
      });
      refresh();
      toast({ title: t(isOwner ? 'profile.toastOwnerLive' : 'profile.toastSent') });
    } catch (error) {
      toast({ title: error?.message || t('profile.toastFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      const saved = await apiRequest(`${profilePhotosBase(activeId)}/owner-name`, {
        method: 'PUT',
        body: { name: nameValue },
      });
      setNameDraft(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['workforce'] });
      toast({
        title: saved?.owner_name
          ? t('profile.nameSaved', { name: saved.owner_name })
          : t('profile.nameCleared'),
      });
    } catch (error) {
      toast({ title: error?.message || t('profile.toastFailed'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title={t('profile.title')}
      description={t(isOwner ? 'profile.ownerDesc' : 'profile.memberDesc')}
    >
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <ProfileAvatar
            businessId={activeId}
            personKey={me?.key}
            name={personName || (isOwner ? ownerName || t('workforce.messages.owner') : '')}
            hasPhoto={Boolean(me?.has_approved)}
            className="h-16 w-16 text-lg"
          />
          <div className="min-w-0 space-y-1">
            {state === 'approved' && (
              <p className="text-sm text-muted-foreground">{t('profile.stateApproved')}</p>
            )}
            {state === 'none' && (
              <p className="text-sm text-muted-foreground">{t('profile.stateNone')}</p>
            )}
            {state === 'pending' && (
              <p className="text-sm text-muted-foreground">{t('profile.statePending')}</p>
            )}
            {state === 'approved_pending' && (
              <p className="text-sm text-muted-foreground">{t('profile.stateChangePending')}</p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={pickPhoto}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !activeId}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              {t(me?.has_approved ? 'profile.change' : 'profile.choose')}
            </Button>
          </div>
          {me?.has_pending && activeId ? (
            <img
              src={myPendingPhotoUrl(activeId)}
              alt=""
              aria-hidden="true"
              className="h-16 w-16 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/40 object-cover opacity-80"
            />
          ) : null}
        </div>

        {me?.decision === 'declined' && !me?.has_pending ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            {t(me.decision_had_approved ? 'profile.declinedChange' : 'profile.declinedFirst')}
          </p>
        ) : null}
        {me?.decision === 'approved' && state === 'approved' ? (
          <p className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
            {t('profile.approvedNote')}
          </p>
        ) : null}

        {isOwner ? (
          <div className="space-y-2 border-t border-border pt-4">
            <Label htmlFor="profile-owner-name">{t('profile.nameLabel')}</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="profile-owner-name"
                value={nameValue}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder={t('workforce.messages.owner')}
                maxLength={80}
                className="max-w-xs"
              />
              <Button
                type="button"
                size="sm"
                disabled={busy || nameValue.trim() === (ownerName || '')}
                onClick={saveName}
              >
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('profile.nameSave')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('profile.nameHint')}</p>
          </div>
        ) : null}
      </div>
    </SettingsCard>
  );
}
