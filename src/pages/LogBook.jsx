import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, NotebookPen, Pencil, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped, withBusiness } from '@/lib/scoped';
import { formatDateTime } from '@/lib/dates';
import { t } from '@/lib/i18n';

/**
 * The manager log book (release 378, Nov 25, 2026): the
 * official shift record for EVERY business — the owner's Q2
 * ruling made it a general feature on both plans, not a
 * restaurant extra, because the small shoe store and the
 * small bookshop hand over shifts too. Entries are plain
 * words about what happened, what was handed over and what
 * the next person needs to know, each one named by the
 * server with its writer (never an email, never anonymous)
 * and stamped with its time. Any trusted member of the
 * business reads and writes it — a log dies when writing it
 * needs permission — and the book is searchable, so last
 * month's note about the freezer or the regular who pays on
 * Fridays is findable in seconds.
 */
export default function LogBook() {
  const { activeId } = useBusiness();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [flash, setFlash] = useState(null);
  const [search, setSearch] = useState('');
  const [shiftLabel, setShiftLabel] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [editShift, setEditShift] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    (async () => {
      const page = await base44.entities.LogBookEntry.filter(scoped({}, activeId), {
        sort: '-created_date',
        limit: 300,
      });
      setEntries(page.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.body, entry.shift_label, entry.author_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [entries, search]);

  const add = async () => {
    setError('');
    if (!body.trim()) {
      setError(t('logBook.needBody'));
      return;
    }
    setSaving(true);
    try {
      await base44.entities.LogBookEntry.create(
        withBusiness({ body: body.trim(), shift_label: shiftLabel.trim() }, activeId),
      );
      setBody('');
      setShiftLabel('');
      setFlash(t('logBook.saved'));
      setReload((n) => n + 1);
    } catch {
      setError(t('logBook.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (entry) => {
    setEditing(entry);
    setEditBody(entry.body || '');
    setEditShift(entry.shift_label || '');
    setEditError('');
  };

  const saveEdit = async () => {
    setEditError('');
    if (!editBody.trim()) {
      setEditError(t('logBook.needBody'));
      return;
    }
    setEditSaving(true);
    try {
      await base44.entities.LogBookEntry.update(editing.id, {
        body: editBody.trim(),
        shift_label: editShift.trim(),
      });
      setEditing(null);
      setFlash(t('logBook.saved'));
      setReload((n) => n + 1);
    } catch {
      setEditError(t('logBook.saveFailed'));
    } finally {
      setEditSaving(false);
    }
  };

  const remove = async (entry) => {
    if (!window.confirm(t('logBook.deleteConfirm'))) return;
    try {
      await base44.entities.LogBookEntry.delete(entry.id);
      setFlash(t('logBook.deleted'));
      setReload((n) => n + 1);
    } catch {
      setError(t('logBook.saveFailed'));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold sm:text-[28px]">{t('logBook.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('logBook.subtitle')}</p>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      <div className="space-y-3 rounded-xl border border-border p-4">
        <div className="space-y-1.5">
          <Label htmlFor="logbook-shift">{t('logBook.shiftLabel')}</Label>
          <Input
            id="logbook-shift"
            value={shiftLabel}
            onChange={(event) => setShiftLabel(event.target.value)}
            placeholder={t('logBook.shiftPlaceholder')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="logbook-body">{t('logBook.bodyLabel')}</Label>
          <Textarea
            id="logbook-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={t('logBook.bodyPlaceholder')}
            rows={4}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={add} disabled={saving}>
            {saving ? t('recipes.saving') : t('logBook.addButton')}
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('logBook.searchPlaceholder')}
          className="pl-9"
        />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <NotebookPen className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('logBook.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('logBook.emptyBody')}</p>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('logBook.noResults')}</p>
      ) : (
        <div className="space-y-3">
          {visible.map((entry) => (
            <article key={entry.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {entry.shift_label && (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                      {entry.shift_label}
                    </span>
                  )}
                  <span>{entry.author_name || ''}</span>
                  {entry.created_date && <span>{formatDateTime(entry.created_date)}</span>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(entry)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> {t('recipes.editButton')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(entry)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> {t('recipes.deleteButton')}
                  </Button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{entry.body}</p>
            </article>
          ))}
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('logBook.editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="logbook-edit-shift">{t('logBook.shiftLabel')}</Label>
              <Input
                id="logbook-edit-shift"
                value={editShift}
                onChange={(event) => setEditShift(event.target.value)}
                placeholder={t('logBook.shiftPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logbook-edit-body">{t('logBook.bodyLabel')}</Label>
              <Textarea
                id="logbook-edit-body"
                value={editBody}
                onChange={(event) => setEditBody(event.target.value)}
                rows={5}
              />
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('recipes.cancel')}
            </Button>
            <Button onClick={saveEdit} disabled={editSaving}>
              {editSaving ? t('recipes.saving') : t('logBook.saveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
