import { useState } from 'react';
import { ArrowLeftRight, Check, Pencil, Plus } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import RenameBusinessDialog from '@/components/business/RenameBusinessDialog';
import { Button } from '@/components/ui/button';
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
      setCreateError('Enter a business name.');
      return;
    }
    if (!mayCreate || !canCreate) {
      setCreateError('Your account has reached its business limit.');
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
      setCreateError(error?.message || 'Unable to create this business.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Your businesses</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each one keeps its own catalog, locations and purchasing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {plansLoading
              ? 'Loading your plan…'
              : plansError
                ? 'Plan unavailable'
                : `${businesses.length} of ${limit}`}
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
              Add business
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 divide-y divide-border">
        {isLoading && <p className="py-3 text-sm text-muted-foreground">Loading your businesses…</p>}
        {!isLoading && businesses.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">
            No businesses yet — add one here or from the sidebar switcher.
          </p>
        )}

        {businesses.map((business) => {
          const active = business.id === activeId;
          return (
            <div key={business.id} className="flex flex-wrap items-center gap-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{business.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {business.tagline || 'No tagline'}
                </p>
              </div>

              {active ? (
                <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-primary">
                  <Check className="h-3 w-3" /> In use
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => switchTo(business.id)}
                  className="h-7 px-2 text-xs"
                >
                  <ArrowLeftRight className="mr-1 h-3.5 w-3.5" /> Switch
                </Button>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={() => setRenaming(business)}
                className="h-7 px-2 text-xs"
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> Rename
              </Button>
            </div>
          );
        })}
      </div>

      {mayCreate && plansError && (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          We couldn&apos;t load your plan allowance, so the business limit is hidden rather than
          guessed.{' '}
          <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={refetchPlans}>
            Try again
          </button>
        </p>
      )}

      {mayCreate && limit != null && !canCreate && !isLoading && !plansLoading && (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          {limit >= 5
            ? 'You have reached the five-business limit for this account.'
            : 'Essentials allows one business. Business allows up to five businesses per owner.'}
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
              <DialogTitle>Add business {businesses.length + 1} of {limit ?? '…'}</DialogTitle>
              <DialogDescription>
                This creates a separate business with its own products, locations,
                suppliers and purchasing records. Existing businesses will not be changed.
                Complimentary pre-launch workspaces do not start another free trial.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="settings-new-business-name">Business name</Label>
                <Input
                  id="settings-new-business-name"
                  value={newName}
                  maxLength={120}
                  disabled={creating}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Your second business"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-new-business-tagline">Tagline (optional)</Label>
                <Input
                  id="settings-new-business-tagline"
                  value={newTagline}
                  maxLength={200}
                  disabled={creating}
                  onChange={(event) => setNewTagline(event.target.value)}
                  placeholder="A short description"
                />
              </div>
              {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={creating} onClick={() => setCreatingOpen(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={creating || !canCreate || !newName.trim()} onClick={saveNewBusiness}>
                {creating ? 'Creating…' : 'Create business'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}