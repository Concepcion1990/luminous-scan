import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import CategoryDialog from '@/components/categories/CategoryDialog';
import CategorySyncPanel from '@/components/categories/CategorySyncPanel';
import { countByField } from '@/lib/categories';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { t } from '@/lib/i18n';


export default function Categories() {
  const { user } = useAuth();
  const { activeId } = useBusiness();
  const { toast } = useToast();
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Products carry their own classification text, so the managed list can be
      // reconciled with what the catalog really uses.
      const [page, catalog] = await Promise.all([
        base44.entities.Category.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Product.filter(scoped({}, activeId), { limit: 2000 }),
      ]);
      setRows(page.items ?? []);
      setProducts(catalog.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const categories = rows.filter((row) => row.kind === 'category');
  const subcategories = rows.filter((row) => row.kind === 'subcategory');
  const tags = rows.filter((row) => row.kind === 'tag');
  const categoryCounts = countByField(products, 'category');
  const productsUsing = (name) => categoryCounts.get(String(name || '').trim().toLowerCase()) || 0;
  const orphans = subcategories.filter(
    (row) => !row.parent_id || !categories.some((c) => c.id === row.parent_id)
  );

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setDialogOpen(true);
  };

  const remove = async (row) => {
    // Deleting a category also deletes its subcategories, so name the count
    // before anything is removed — the same confirm pattern as Listings,
    // Counts and Materials. Products already filed under it keep their value.
    const childCount =
      row.kind === 'category'
        ? subcategories.filter((sub) => sub.parent_id === row.id).length
        : 0;
    const message =
      childCount > 0
        ? t('categories.deleteWithChildren', {
            name: row.name,
            count: childCount,
            suffix: childCount === 1 ? 'y' : 'ies',
          })
        : t('categories.deleteConfirm', { name: row.name });
    if (!window.confirm(message)) return;
    await base44.entities.Category.delete(row.id);
    if (row.kind === 'category') {
      const children = subcategories.filter((sub) => sub.parent_id === row.id);
      if (children.length) await base44.entities.Category.deleteMany({ parent_id: row.id });
    }
    toast({
      title: t('categories.removedTitle'),
      description: t('categories.removedDescription', { name: row.name }),
    });
    setReload((r) => r + 1);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('categories.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('categories.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('categories.subtitle')}
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('categories.newButton')}
        </Button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">{t('categories.loading')}</p>}

      {!loading && (
        <CategorySyncPanel
          activeId={activeId}
          rows={rows}
          products={products}
          onSynced={(count) => {
            toast({
              title: t('categories.syncedTitle'),
              description: t('categories.syncedDescription', { count, plural: count === 1 ? '' : 's' }),
            });
            setReload((r) => r + 1);
          }}
        />
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-12 text-center">
          <p className="text-sm font-medium">{t('categories.emptyTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('categories.emptyHint')}
          </p>
        </div>
      )}

      {!loading && categories.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <p className="border-b border-border bg-muted/50 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('categories.sectionTitle', { count: categories.length })}
          </p>
          <div className="divide-y divide-border">
            {categories.map((category) => {
              const children = subcategories.filter((sub) => sub.parent_id === category.id);
              return (
                <div key={category.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-sm font-medium">{category.name}</span>
                      <span className="numeric shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t('categories.productCount', {
                          count: productsUsing(category.name),
                          plural: productsUsing(category.name) === 1 ? '' : 's',
                        })}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(category)}
                        aria-label={t('categories.editAria', { name: category.name })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {user?.role === 'admin' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(category)}
                          aria-label={t('categories.deleteAria', { name: category.name })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </span>
                  </div>
                  {children.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {children.map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => openEdit(child)}
                          className="rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[11px] hover:bg-muted"
                        >
                          {child.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && orphans.length > 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('categories.orphansTitle')}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {orphans.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => openEdit(row)}
                className="rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
              >
                {row.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && tags.length > 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t('categories.tagsTitle', { count: tags.length })}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-0.5 text-[11px]"
              >
                #{tag.name}
                <button
                  type="button"
                  onClick={() => openEdit(tag)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t('categories.editAria', { name: tag.name })}
                >
                  <Pencil className="h-3 w-3" />
                </button>
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => remove(tag)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t('categories.deleteAria', { name: tag.name })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <CategoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entry={editing}
        rows={rows}
        onSaved={() => setReload((r) => r + 1)}
      />
    </div>
  );
}