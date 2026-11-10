import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

/** A catalog column heading that toggles sorting on click. */
export default function SortHeader({ label, column, sort, onSort, align = 'left', className = '' }) {
  const active = sort.key === column;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`flex items-center gap-1 uppercase tracking-[0.14em] transition-colors hover:text-foreground ${
        align === 'right' ? 'justify-end' : ''
      } ${active ? 'text-foreground' : ''} ${className}`}
    >
      {label}
      <Icon className={`h-3 w-3 shrink-0 ${active ? 'opacity-100' : 'opacity-40'}`} />
    </button>
  );
}