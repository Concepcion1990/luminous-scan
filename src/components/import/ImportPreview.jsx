const PREVIEW_ROWS = 8;

/** First rows of the file with the verdict each one got. */
export default function ImportPreview({ report }) {
  if (!report.rows.length) return null;
  const rows = report.rows.slice(0, PREVIEW_ROWS);

  return (
    <div className="space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Preview
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[420px] text-xs">
          <thead className="bg-muted/40 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Row</th>
              <th className="px-2 py-1.5 font-medium">Name</th>
              <th className="px-2 py-1.5 font-medium">SKU</th>
              <th className="px-2 py-1.5 font-medium">Qty</th>
              <th className="px-2 py-1.5 font-medium">Check</th>
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
                    <span className="text-ok">Ready</span>
                  ) : (
                    <span className="text-warn" title={row.problem}>
                      Skip
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
          Showing the first {PREVIEW_ROWS} of {report.rows.length} rows.
        </p>
      )}
    </div>
  );
}