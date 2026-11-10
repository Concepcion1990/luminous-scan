import { useState } from 'react';
import { ArrowLeftRight, Check, Pencil, Plus } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import RenameBusinessDialog from '@/components/business/RenameBusinessDialog';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

/** Every business on this login, with rename and switch controls. */
export default function BusinessListCard({ onRenamed }) {
  const {
    businesses, activeId, switchTo, create, canCreate, isLoading, limit,
    plansLoading, plansError, refetchPlans,
  } = useBusiness();
  const access = useStaffAccess();
  const mayCreate = !access.loading && access.unrestricted;
  const [renaming, setRenaming] = useState(null);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTagline, setNewTagline] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const openCreate = () => {
    setCreateError('');
    setCreatingOpen(true);
  };

  const saveNewBusiness = async () => {
    if (creating) return;
    if (!newName.trim()) {
      setCreateError(t('settings.businesses.nameError'));
      return;
    }
    if (!mayCreate || !canCreate) {
      setCreateError(t('settings.businesses.limitError'));
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      // Reuse the existing server-owned creation flow; it validates the plan
      // limit, records a separate workspace and switches to that workspace.
      await create({ name: newName.trim(), tagline: newTagline.trim() });
      setNewName('');
      setNewTagline('');
      setCreatingOpen(false);
    } catch (error) {
      setCreateError(error?.message || t('settings.businesses.createError'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t('settings.businesses.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('settings.businesses.description')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {plansLoading
              ? t('settings.businesses.loadingPlan')
              : plansError
                ? t('settings.businesses.planUnavailable')
                : t('settings.businesses.count', { count: businesses.length, limit })}
          </span>
          {mayCreate && (
            <Button
              type="button"
              size="sm"
              className="min-h-11"
              onClick={openCreate}
              disabled={!canCreate || isLoading || creating || plansLoading || plansError}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('settings.businesses.add')}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 divide-y divide-border">
        {isLoading && <p className="py-3 text-sm text-muted-foreground">{t('settings.businesses.loading')}</p>}
        {!isLoading && businesses.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">
            {t('settings.businesses.empty')}
          </p>
        )}

        {businesses.map((business) => {
          const active = business.id === activeId;
          return (
            <div key={business.id} className="flex flex-wrap items-center gap-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{business.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {business.tagline || t('settings.businesses.noTagline')}
                </p>
              </div>

              {active ? (
                <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-primary">
                  <Check className="h-3 w-3" /> {t('settings.businesses.inUse')}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => switchTo(business.id)}
                  className="h-7 px-2 text-xs"
                >
                  <ArrowLeftRight className="mr-1 h-3.5 w-3.5" /> {t('settings.businesses.switch')}
                </Button>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={() => setRenaming(business)}
                className="h-7 px-2 text-xs"
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> {t('settings.businesses.rename')}
              </Button>
            </div>
          );
        })}
      </div>

      {mayCreate && plansError && (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {t('settings.businesses.planLoadError')}{' '}
          <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={refetchPlans}>
            {t('settings.businesses.tryAgain')}
          </button>
        </p>
      )}

      {mayCreate && limit != null && !canCreate && !isLoading && !plansLoading && (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {limit >= 5
            ? t('settings.businesses.limitFive')
            : t('settings.businesses.limitEssentials')}
        </p>
      )}

      <RenameBusinessDialog
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        business={renaming}
        onRenamed={onRenamed}
      />

      {mayCreate && (
        <Dialog open={creatingOpen} onOpenChange={(open) => { if (!creating) setCreatingOpen(open); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('settings.businesses.createTitle', { number: businesses.length + 1, limit: limit ?? '…' })}</DialogTitle>
              <DialogDescription>
                {t('settings.businesses.createDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="settings-new-business-name">{t('settings.businesses.nameLabel')}</Label>
                <Input
                  id="settings-new-business-name"
                  value={newName}
                  maxLength={120}
                  disabled={creating}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder={t('settings.businesses.namePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-new-business-tagline">{t('settings.businesses.taglineLabel')}</Label>
                <Input
                  id="settings-new-business-tagline"
                  value={newTagline}
                  maxLength={200}
                  disabled={creating}
                  onChange={(event) => setNewTagline(event.target.value)}
                  placeholder={t('settings.businesses.taglinePlaceholder')}
                />
              </div>
              {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={creating} onClick={() => setCreatingOpen(false)}>
                {t('settings.businesses.cancel')}
              </Button>
              <Button type="button" disabled={creating || !canCreate || !newName.trim()} onClick={saveNewBusiness}>
                {creating ? t('settings.businesses.creating') : t('settings.businesses.create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}