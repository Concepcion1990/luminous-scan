import { t } from '@/lib/i18n';

const PREVIEW_ROWS = 8;

/** First rows of the file with the verdict each one got. */
export default function ImportPreview({ report }) {
  if (!report.rows.length) return null;
  const rows = report.rows.slice(0, PREVIEW_ROWS);

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
              <th className="px-2 py-1.5 font-medium">{t('import.colCheck')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.index} className="border-t border-border align-top">
                <td className="numeric px-2 py-1.5 text-muted-foreground">{row.index + 2}</td>
                <td className="max-w-[190px] truncate px-2 py-1.5">{row.name || '—'}</td>
                <td className="numeric px-2 py-1.5">{row.draft?.sku || '—'}</td>
                <td className="numeric px-2 py-1.5">{row.draft ? row.quantity || 0 : '—'}</td>
                <td className="px-2 py-1.5">
                  {row.status === 'ready' ? (
                    <span className="text-ok">{t('import.ready')}</span>
                  ) : (
                    <span className="text-warn" title={row.problem}>
                      {t('import.skip')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.rows.length > PREVIEW_ROWS && (
        <p className="text-[11px] text-muted-foreground">
          {t('import.showingFirst', { first: PREVIEW_ROWS, total: report.rows.length })}
        </p>
      )}
    </div>
  );
}