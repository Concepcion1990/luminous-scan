import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

export const IMPORT_PAGE_SIZE = 25;

/**
 * Pagination for the import previews (owner rulings, Nov 15,
 * 2026): every row of the file is reachable and tickable across
 * the pages, and the caption speaks in PAGES while counting
 * exactly what is rendered — the caller computes from/to in the
 * units its table shows (spreadsheet rows for Create/Receive,
 * change lines for Update). Renders nothing when the list fits
 * on one page.
 */
export default function ImportPager({ page, pages, from, to, total, onPage, changes = false }) {
  if (pages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] text-muted-foreground">
        {t('import.pageOf', { page: page + 1, pages })} ·{' '}
        {t(changes ? 'import.showingChangesRange' : 'import.showingRange', { from, to, total })}
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={page <= 0}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="mr-0.5 h-3.5 w-3.5" /> {t('import.prevPage')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          {t('import.nextPage')} <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Slice one page out of a list and describe it for the pager. */
export function pageSlice(items, page, pageSize = IMPORT_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const start = safePage * pageSize;
  return { pageItems: items.slice(start, start + pageSize), pages, page: safePage, start };
}
