import { PackageCheck, PackagePlus, PencilLine } from 'lucide-react';
import { IMPORT_MODES } from '@/lib/importModes';

const ICONS = {
  create: PackagePlus,
  update: PencilLine,
  receive: PackageCheck,
};

/** The three spreadsheet operations, chosen before a file is picked. */
export default function ImportModePicker({ mode, onChange }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {IMPORT_MODES.map((entry) => {
        const Icon = ICONS[entry.id];
        const active = entry.id === mode;
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onChange(entry.id)}
            className={`rounded-xl border p-3 text-left transition-colors ${
              active
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card hover:border-primary/40'
            }`}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <Icon className={`h-4 w-4 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
              {entry.label}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{entry.hint}</span>
          </button>
        );
      })}
    </div>
  );
}