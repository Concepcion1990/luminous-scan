const PREVIEW_CHANGES = 12;

/** Old value against proposed new value, exactly as the update would write it. */
export default function UpdatePreview({ report }) {
  const changes = report.rows
    .filter((row) => row.status === 'change')
    .flatMap((row) => row.changes.map((change) => ({ ...change, row: row.index + 2, name: row.name })));

  if (!changes.length) return null;

  return (
    <div className="space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Changes to be written
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="bg-muted/40 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Row</th>
              <th className="px-2 py-1.5 font-medium">Product</th>
              <th className="px-2 py-1.5 font-medium">Field</th>
              <th className="px-2 py-1.5 font-medium">Now</th>
              <th className="px-2 py-1.5 font-medium">Becomes</th>
            </tr>
          </thead>
          <tbody>
            {changes.slice(0, PREVIEW_CHANGES).map((change) => (
              <tr key={`${change.row}-${change.field}`} className="border-t border-border align-top">
                <td className="numeric px-2 py-1.5 text-muted-foreground">{change.row}</td>
                <td className="max-w-[150px] truncate px-2 py-1.5">{change.name}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{change.label}</td>
                <td className="max-w-[120px] truncate px-2 py-1.5 text-muted-foreground line-through">
                  {change.before}
                </td>
                <td className="max-w-[140px] truncate px-2 py-1.5 font-medium text-ok">{change.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {changes.length > PREVIEW_CHANGES
          ? `Showing ${PREVIEW_CHANGES} of ${changes.length} field changes.`
          : `${changes.length} field change${changes.length === 1 ? '' : 's'} in total.`}
      </p>
    </div>
  );
}