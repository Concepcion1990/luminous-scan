import { useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { base44 } from '@/api/client';
import { Button } from '@/components/ui/button';
import { scoped, withBusiness } from '@/lib/scoped';
import { missingEntries } from '@/lib/categories';

/**
 * Products already carry categories as text. Rather than making the owner retype
 * them, this offers to write those words into the managed list — additively, so
 * no product classification is touched.
 */
export default function CategorySyncPanel({ activeId, rows, products, onSynced }) {
  const [saving, setSaving] = useState(false);
  const entries = missingEntries(rows, products);
  if (!entries.length) return null;

  const byKind = (kind) => entries.filter((entry) => entry.kind === kind);
  const categories = byKind('category');
  const subcategories = byKind('subcategory');
  const tags = byKind('tag');

  const sync = async () => {
    setSaving(true);
    try {
      if (categories.length) {
        await base44.entities.Category.bulkCreate(
          categories.map((entry) => withBusiness({ name: entry.name, kind: 'category' }, activeId))
        );
      }

      if (subcategories.length) {
        const page = await base44.entities.Category.filter(
          scoped({ kind: 'category' }, activeId),
          { limit: 500 }
        );
        const byName = new Map(
          (page.items ?? []).map((row) => [String(row.name || '').trim().toLowerCase(), row])
        );
        await base44.entities.Category.bulkCreate(
          subcategories.map((entry) => {
            const parent = byName.get(String(entry.parent_name || '').trim().toLowerCase());
            return withBusiness(
              {
                name: entry.name,
                kind: 'subcategory',
                parent_id: parent?.id || '',
                parent_name: parent?.name || '',
              },
              activeId
            );
          })
        );
      }

      if (tags.length) {
        await base44.entities.Category.bulkCreate(
          tags.map((entry) => withBusiness({ name: entry.name, kind: 'tag' }, activeId))
        );
      }

      onSynced?.(entries.length);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-4">
      <div className="flex items-start gap-2.5">
        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Your products use {entries.length} word{entries.length === 1 ? '' : 's'} this list does not have yet
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            These are already filed on products. Add them here so they appear as suggestions, filters and in
            reports. Products keep their current classification either way.
          </p>

          <div className="mt-2.5 space-y-2">
            {categories.length > 0 && <Row label="Categories" entries={categories} />}
            {subcategories.length > 0 && <Row label="Subcategories" entries={subcategories} />}
            {tags.length > 0 && <Row label="Tags" entries={tags} prefix="#" />}
          </div>

          <Button className="mt-3" size="sm" onClick={sync} disabled={saving || !activeId}>
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Layers className="mr-1.5 h-3.5 w-3.5" />
            )}
            {saving ? 'Adding…' : `Add ${entries.length} to this list`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, entries, prefix = '' }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {entries.map((entry) => (
          <span
            key={`${entry.kind}-${entry.name}`}
            className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px]"
          >
            {prefix}
            {entry.name}
            <span className="ml-1 text-muted-foreground">{entry.count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}