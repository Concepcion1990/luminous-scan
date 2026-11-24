import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import ImportPager, { pageSlice } from '@/components/import/ImportPager';

/**
 * Every row of the file, one page at a time, with the verdict
 * each one got and a tick box on every row that can be imported
 * (owner rulings, Nov 15, 2026): rows start ALL TICKED, the
 * whole file is reachable across the pages, and the captions
 * count exactly what is rendered — pages, not "first N".
 */
export default function ImportPreview({ report, excluded, onToggleRow, resetKey }) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [resetKey]);

  if (!report.rows.length) return null;
  const { pageItems, pages, page: safePage, start } = pageSlice(report.rows, page);
  const readyTotal = report.rows.filter((row) => row.status === 'ready').length;
  const selected = report.rows.filter(
    (row) => row.status === 'ready' && !(excluded?.has(row.index))
  ).length;

  return (
    <div className="space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('import.previewTitle')}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[420px] text-xs">
          <thead className="bg-muted/40 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">{t('import.colRow')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.colName')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.colSku')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.colQty')}</th>
              <th className="px-2 py-1.5 font-medium">{t('importLib.field.price')}</th>
              <th className="px-2 py-1.5 font-medium">{t('import.colCheck')}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((row) => {
              const ticked = row.status === 'ready' && !(excluded?.has(row.index));
              return (
                <tr
                  key={row.index}
                  className={`border-t border-border align-top ${row.status === 'ready' && !ticked ? 'opacity-50' : ''}`}
                >
                  <td className="numeric px-2 py-1.5 text-muted-foreground">{row.index + 2}</td>
                  <td className="max-w-[190px] truncate px-2 py-1.5">{row.name || '—'}</td>
                  <td className="numeric px-2 py-1.5">{row.sku || row.draft?.sku || '—'}</td>
                  <td className="numeric px-2 py-1.5">{row.quantity ?? '—'}</td>
                  <td className="numeric px-2 py-1.5">
                    {row.price != null ? Number(row.price).toFixed(2) : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-2">
                      {row.status === 'ready' ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-primary"
                          checked={ticked}
                          onChange={(event) => onToggleRow?.(row.index, event.target.checked)}
                          aria-label={t('import.selectRowAria', { row: row.index + 2 })}
                        />
                      ) : null}
                      {row.status === 'ready' ? (
                        <span className="text-ok">{t('import.ready')}</span>
                      ) : (
                        <span className="text-warn" title={row.problem}>
                          {t('import.skip')}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          {t('import.rowsSelected', { selected, total: readyTotal })}
        </p>
      </div>
      <ImportPager
        page={safePage}
        pages={pages}
        from={start + 2}
        to={start + pageItems.length + 1}
        total={report.rows.length + 1}
        onPage={setPage}
      />
    </div>
  );
}
