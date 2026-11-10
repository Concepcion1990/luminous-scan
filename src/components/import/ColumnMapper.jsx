import { TriangleAlert } from 'lucide-react';
import { IMPORT_FIELDS } from '@/lib/csvImport';
import { IGNORE } from '@/lib/importProducts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** One dropdown per spreadsheet column, pre-filled with the best guess. */
export default function ColumnMapper({
  headers,
  mapping,
  onChange,
  fields = IMPORT_FIELDS,
  requiredKeys = ['name'],
  missingMessage = 'Map one column to Product name — every imported row needs a name.',
}) {
  const missing = !requiredKeys.some((key) => mapping.includes(key));

  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Match the columns
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {headers.map((header, column) => (
          <div key={`${header}-${column}`} className="grid gap-1 rounded-lg border border-border p-2">
            <span className="numeric truncate text-[11px] text-muted-foreground" title={header}>
              {header || `Column ${column + 1}`}
            </span>
            <Select
              value={mapping[column] || IGNORE}
              onValueChange={(value) => onChange(column, value === IGNORE ? '' : value)}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Ignore this column" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={IGNORE}>Ignore this column</SelectItem>
                {fields.map((field) => (
                  <SelectItem key={field.key} value={field.key}>
                    {field.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {missing && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          {missingMessage}
        </p>
      )}
    </div>
  );
}