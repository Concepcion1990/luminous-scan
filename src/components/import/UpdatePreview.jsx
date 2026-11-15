import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import ImportPager, { pageSlice } from '@/components/import/ImportPager';

/**
 * Old value against proposed new value, exactly as the update
 * would write it — every change in the file across the pages,
 * with a tick box on every row that carries changes (owner
 * rulings, Nov 15, 2026): rows start ALL TICKED, unticked rows
 * dim and stay unwritten, captions count exactly what renders.
 */
export default function UpdatePreview({ report, excluded, onToggleRow, resetKey }) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  const changeRows = report.rows.filter((row) => row.status === 'change');
  const lines = changeRows.flatMap((row) =>
    row.changes.map((change, i) => ({
      ...change,
      rowIndex: row.index,
      row: row.index + 2,
      name: row.name,
      firstOfRow: i === 0,
    }))
  );

  if (!lines.length) return null;

  const { pageItems, pages, page: safePage, start } = pageSlice(lines, page);
  const selected = changeRows.filter((row) => !(excluded?.has(row.index))).length;

  return (
    <div className="space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('import.changesTitle')}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="bg-muted/40 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">{t('import.colRow')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.colProduct')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.colField')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.colNow')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.colBecomes')}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((change) => {
              const ticked = !(excluded?.has(change.rowIndex));
              return (
                <tr
                  key={`${change.row}-${change.field}`}
                  className={`border-t border-border align-top ${ticked ? '' : 'opacity-50'}`}
                >
                  <td className="numeric px-2 py-1.5 text-muted-foreground">
                    <span className="flex items-center gap-2">
                      {change.firstOfRow ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-primary"
                          checked={ticked}
                          onChange={(event) => onToggleRow?.(change.rowIndex, event.target.checked)}
                          aria-label={t('import.selectRowAria', { row: change.row })}
                        />
                      ) : null}
                      {change.row}
                    </span>
                  </td>
                  <td className="max-w-[150px] truncate px-2 py-1.5">{change.name}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{change.label}</td>
                  <td className="max-w-[120px] truncate px-2 py-1.5 text-muted-foreground line-through">
                    {change.before}
                  </td>
                  <td className="max-w-[140px] truncate px-2 py-1.5 font-medium text-ok">{change.after}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t('import.rowsSelected', { selected, total: changeRows.length })} ·{' '}
        {t('import.fieldChangesTotal', {
          count: lines.length,
          s: lines.length === 1 ? '' : 's',
        })}
      </p>
      <ImportPager
        page={safePage}
        pages={pages}
        from={start + 1}
        to={start + pageItems.length}
        total={lines.length}
        onPage={setPage}
        changes
      />
    </div>
  );
}
